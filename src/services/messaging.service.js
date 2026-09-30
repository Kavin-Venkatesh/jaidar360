// Picks the outbound WhatsApp provider from MESSAGING_PROVIDER ("twilio" | "whatsapp").
// Every function looks the provider up at call time, so tests can stub twilio.service methods directly.

const env = require("../config/env");
const twilioService = require("./twilio.service");
const whatsappCloudService = require("./whatsapp-cloud.service");

const PROVIDERS = {
  twilio: twilioService,
  whatsapp: whatsappCloudService,
};

function providerName() {
  const name = String(env.MESSAGING_PROVIDER || "twilio").toLowerCase();
  if (!PROVIDERS[name]) throw new Error(`Unknown MESSAGING_PROVIDER: ${name} (use "twilio" or "whatsapp")`);
  return name;
}

function provider() {
  return PROVIDERS[providerName()];
}

// Only Twilio has pre-created Content templates (HX... SIDs). Meta gets native interactive messages instead.
function supportsContentTemplates() {
  return providerName() === "twilio";
}

/**
 * Send a Twilio Content template when running on Twilio and the SID is set; otherwise (or if Twilio rejects it)
 * run `fallback()`, which sends the native interactive / plain-text equivalent.
 */
async function sendContentOr(to, templateSid, variables, fallback) {
  if (templateSid && supportsContentTemplates()) {
    try {
      await provider().sendTemplate(to, templateSid, variables);
      return;
    } catch (err) {
      console.error(`Template ${templateSid} failed, falling back:`, err.message);
    }
  }
  await fallback();
}

module.exports = {
  providerName,
  supportsContentTemplates,
  sendContentOr,
  sendText: (...args) => provider().sendText(...args),
  sendList: (...args) => provider().sendList(...args),
  sendQuickReply: (...args) => provider().sendQuickReply(...args),
  sendCard: (...args) => provider().sendCard(...args),
  sendTemplate: (...args) => provider().sendTemplate(...args),
};
