const crypto = require("crypto");
const env = require("../config/env");

// Meta signs each webhook POST: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret).
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
function validateWhatsAppCloudRequest(req, res, next) {
  if (env.DISABLE_WHATSAPP_VALIDATION || !env.WHATSAPP_APP_SECRET) {
    return next();
  }

  const header = String(req.headers["x-hub-signature-256"] || "");
  if (!header.startsWith("sha256=") || !req.rawBody) {
    return res.status(403).json({ message: "Missing WhatsApp signature" });
  }

  const expected = crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(req.rawBody).digest("hex");
  const received = header.slice("sha256=".length);

  const valid =
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expected, "utf8"));

  if (!valid) {
    return res.status(403).json({ message: "Invalid WhatsApp signature" });
  }

  return next();
}

module.exports = {
  validateWhatsAppCloudRequest,
};
