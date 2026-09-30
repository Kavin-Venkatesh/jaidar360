const env = require("./config/env");
const app = require("./app");
const { logInfo, logError } = require("./utils/logger");
const { expireIdleSessions } = require("./engine/engine");

const server = app.listen(env.PORT, () => {
  logInfo("SERVER_STARTED", { port: env.PORT });
});

// Canvas flow sessions idle longer than FLOW_SESSION_IDLE_MINUTES become expired.
const expiryTimer = setInterval(() => {
  expireIdleSessions({ notify: env.FLOW_SESSION_TIMEOUT_NOTICE }).catch((error) => logError("FLOW_EXPIRY_FAILED", error));
}, 60 * 1000);
expiryTimer.unref();

process.on("SIGTERM", () => {
  logInfo("SERVER_SIGTERM");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  logInfo("SERVER_SIGINT");
  server.close(() => process.exit(0));
});

module.exports = app;
