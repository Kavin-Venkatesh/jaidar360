const express = require("express");
const helmet = require("helmet");
const env = require("./config/env");
const { logInfo } = require("./utils/logger");
const whatsappRoutes = require("./routes/whatsapp.routes");
const locationRoutes = require("./routes/location.routes");

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: "1mb", verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.static("public"));

app.use("/webhooks", whatsappRoutes);
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

const server = app.listen(env.PORT, () => {
  logInfo("SERVER_STARTED", { port: env.PORT });
});

process.on("SIGTERM", () => {
  logInfo("SERVER_SIGTERM");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  logInfo("SERVER_SIGINT");
  server.close(() => process.exit(0));
});

module.exports = app;