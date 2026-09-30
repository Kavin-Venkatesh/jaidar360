const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const env = require("./config/env");
const whatsappRoutes = require("./routes/whatsapp.routes");
const locationRoutes = require("./routes/location.routes");
const apiRoutes = require("./api.routes");

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: "2mb", verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.static("public"));

app.use("/webhooks", whatsappRoutes);
app.use("/api", apiRoutes);

// Canvas flow builder UI (built with `npm run web:build`). In development use the Vite dev server instead.
const builderDist = path.join(__dirname, "..", "web", "dist");
if (fs.existsSync(builderDist)) {
  app.use("/builder", express.static(builderDist, { index: false }));
  app.get(["/builder", "/builder/*rest"], (req, res) => res.sendFile(path.join(builderDist, "index.html")));
}

app.use("/", locationRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "UP" });
});

app.get("/health/ready", (req, res) => {
  const providerReady =
    env.MESSAGING_PROVIDER === "whatsapp"
      ? Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID)
      : Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_NUMBER);
  const ready = Boolean(providerReady && env.PUBLIC_BASE_URL);
  res.status(ready ? 200 : 503).json({
    status: ready ? "READY" : "NOT_READY",
    provider: env.MESSAGING_PROVIDER,
    checks: {
      config: ready,
    },
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "JAIDAR WhatsApp Sales Bot",
    status: "running",
  });
});

module.exports = app;
