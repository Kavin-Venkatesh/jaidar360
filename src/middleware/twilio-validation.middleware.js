const twilio = require("twilio");
const env = require("../config/env");

function validateTwilioRequest(req, res, next) {
  if (env.DISABLE_TWILIO_VALIDATION || process.env.NODE_ENV !== "production") {
    return next();
  }

  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const signature = req.headers["x-twilio-signature"];

  if (!signature) {
    return res.status(403).json({ message: "Missing Twilio signature" });
  }

  const valid = twilio.validateRequest(
    env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body || {}
  );

  if (!valid) {
    return res.status(403).json({ message: "Invalid Twilio signature" });
  }

  return next();
}

module.exports = {
  validateTwilioRequest,
};
