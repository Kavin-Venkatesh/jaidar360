// Public pages for Location Link nodes: the token in the URL is the only credential.
//   GET  /flow-location/:token  -> mobile page that asks the browser for GPS
//   POST /flow-location/:token  -> { latitude, longitude, accuracy } resumes the agent's WhatsApp flow
const express = require("express");
const links = require("./location-link.service");
const engine = require("../engine/engine");
const { logError } = require("../utils/logger");

const router = express.Router();

// Browser GPS worse than this is saved but flagged for review.
const FLAG_ACCURACY_METERS = 100;

function page(title, body, { script = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #f5f7fa; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; color: #0f172a; }
  .card { width: 100%; max-width: 420px; background: #fff; padding: 28px 24px; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #475569; line-height: 1.5; margin: 0 0 20px; }
  button { width: 100%; padding: 14px; border: 0; border-radius: 10px; background: #128c7e; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  #status { min-height: 24px; margin-top: 16px; }
  .ok { color: #15803d; } .err { color: #dc2626; }
</style>
</head>
<body><div class="card">${body}</div>${script}</body>
</html>`;
}

const expiredPage = () =>
  page("Link expired", `<h1>This link has expired</h1><p>It was already used or is too old. Go back to WhatsApp and say <b>hi</b> to start again.</p>`);

router.get("/:token", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  const request = await links.findUsable(req.params.token);
  if (!request) return res.status(404).type("html").send(expiredPage());

  // The script posts back to its own URL, so the token never has to be embedded in the page.
  const script = `<script>
  const button = document.getElementById("share");
  const status = document.getElementById("status");
  const show = (text, cls) => { status.textContent = text; status.className = cls || ""; };
  button.addEventListener("click", () => {
    if (!navigator.geolocation) return show("This browser can't share location.", "err");
    button.disabled = true;
    show("Getting your location…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      show("Sending…");
      try {
        const res = await fetch(location.pathname, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Couldn't save your location.");
        show("✅ Location shared. You can go back to WhatsApp.", "ok");
        button.textContent = "Shared";
      } catch (e) {
        show(e.message, "err");
        button.disabled = false;
      }
    }, (err) => {
      const messages = { 1: "Location permission was denied. Allow location access for this site and try again.", 2: "Your location couldn't be determined. Move to an open area and try again.", 3: "Getting your location took too long. Try again." };
      show(messages[err.code] || "Couldn't get your location.", "err");
      button.disabled = false;
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
</script>`;

  res.type("html").send(
    page(
      "Share your location",
      `<h1>📍 Share your location</h1><p>Tap the button and allow location access. Your location is sent back to your WhatsApp conversation.</p><button id="share">Share my location</button><div id="status"></div>`,
      { script },
    ),
  );
});

router.post("/:token", express.json({ limit: "4kb" }), async (req, res) => {
  res.set("Cache-Control", "no-store");
  // Check the coordinates before burning the token, so a bad request doesn't waste the link.
  const coords = links.parseCoordinates(req.body);
  if (!coords) return res.status(400).json({ message: "Invalid coordinates." });

  const request = await links.findUsable(req.params.token);
  if (!request || !(await links.consume(request))) {
    return res.status(410).json({ message: "This link has expired or was already used. Say hi on WhatsApp to start again." });
  }

  try {
    const result = await engine.resumeWithInput(request, {
      kind: "browser_location",
      location: {
        ...coords,
        source: "browser",
        capturedAt: new Date().toISOString(),
        flagged: coords.accuracy === null || coords.accuracy > FLAG_ACCURACY_METERS,
      },
    });
    if (!result.ok) return res.status(409).json({ message: result.message });
    return res.json({ success: true });
  } catch (error) {
    logError("FLOW_LOCATION_LINK_FAILED", error, { requestId: request.id });
    return res.status(500).json({ message: "Something went wrong. Please try again from WhatsApp." });
  }
});

module.exports = router;
