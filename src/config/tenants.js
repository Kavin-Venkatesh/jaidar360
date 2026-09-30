// Dummy tenants for the canvas flow builder. Webhooks are routed by phoneNumberId (Meta sends it as
// metadata.phone_number_id), not by the display number. A tenant with no phoneNumberId never receives messages.
//
// Which tenant owns a number is chosen in .env: set ACME_PHONE_NUMBER_ID or FRESHMART_PHONE_NUMBER_ID
// (e.g. to the same value as WHATSAPP_PHONE_NUMBER_ID). Access tokens fall back to WHATSAPP_ACCESS_TOKEN,
// since one Meta app token can send from every number in the WABA.
//
// Agent phones are the agents' personal WhatsApp numbers; set them in .env (e.g. ACME_AGENT_RAVI_PHONE=+9198...).
require("dotenv").config();

const env = process.env;

const tenants = [
  {
    id: "tnt_acme",
    name: "Acme Pharma",
    country: "IN",
    whatsapp: {
      displayNumber: env.ACME_DISPLAY_NUMBER || "+919876543210",
      phoneNumberId: env.ACME_PHONE_NUMBER_ID || "",
      accessToken: env.ACME_ACCESS_TOKEN || env.WHATSAPP_ACCESS_TOKEN || "",
    },
    defaultLanguage: "en",
    agents: [
      { id: "agt_ravi", name: "Ravi Kumar", phone: env.ACME_AGENT_RAVI_PHONE || "", team: "North" },
      { id: "agt_priya", name: "Priya S", phone: env.ACME_AGENT_PRIYA_PHONE || "", team: "South" },
    ],
  },
  {
    id: "tnt_freshmart",
    name: "FreshMart Retail",
    country: "IN",
    whatsapp: {
      displayNumber: env.FRESHMART_DISPLAY_NUMBER || "+918765432190",
      phoneNumberId: env.FRESHMART_PHONE_NUMBER_ID || "",
      accessToken: env.FRESHMART_ACCESS_TOKEN || env.WHATSAPP_ACCESS_TOKEN || "",
    },
    defaultLanguage: "en",
    agents: [{ id: "agt_arun", name: "Arun M", phone: env.FRESHMART_AGENT_ARUN_PHONE || "", team: "Chennai" }],
  },
];

// Webhooks are routed by phone number ID, so two tenants can't share one.
{
  const seen = new Map();
  for (const t of tenants) {
    const id = t.whatsapp.phoneNumberId;
    if (!id) continue;
    if (seen.has(id)) throw new Error(`${seen.get(id)} and ${t.name} both use WhatsApp phone number ID ${id}. Give the number to one tenant in .env.`);
    seen.set(id, t.name);
  }
}

const digits = (phone) => String(phone || "").replace(/\D/g, "");

function byId(id) {
  return tenants.find((t) => t.id === id) || null;
}

function byPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  return tenants.find((t) => t.whatsapp.phoneNumberId && t.whatsapp.phoneNumberId === String(phoneNumberId)) || null;
}

function agentByPhone(tenant, phone) {
  const wanted = digits(phone);
  if (!wanted) return null;
  return tenant.agents.find((a) => digits(a.phone) && digits(a.phone) === wanted) || null;
}

function agentById(tenant, agentId) {
  return tenant?.agents.find((a) => a.id === agentId) || null;
}

module.exports = {
  tenants,
  byId,
  byPhoneNumberId,
  agentByPhone,
  agentById,
  digits,
};
