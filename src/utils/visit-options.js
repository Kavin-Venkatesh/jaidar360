// Single source of truth for the New Customer Visit choice lists.
// Used by (1) the conversation flow, (2) scripts/create-content-templates.js and (3) the LLM extraction prompt,
// so the three can never drift apart. `id` is what WhatsApp sends back (ListId / ButtonPayload).
// Twilio limits: list-picker item title <= 24 chars, max 10 items; in-session quick-reply max 3 buttons, title <= 20 chars.

const VISIT_OPTIONS = {
  industryGroup: [
    { id: "SERVICE", label: "Service", description: "Service industry", aliases: ["service industry"] },
    { id: "MANUFACTURING", label: "Manufacturing", description: "Manufacturing" },
    { id: "RETAIL", label: "Retail", description: "Retail" },
    { id: "CONSTRUCTION", label: "Construction", description: "Construction" },
    { id: "HEALTHCARE", label: "Healthcare", description: "Healthcare" },
    { id: "EDUCATION", label: "Education", description: "Education" },
    { id: "FINANCE", label: "Finance", description: "Finance" },
    { id: "TECHNOLOGY", label: "Technology", description: "Technology" },
    { id: "OTHER", label: "Other", description: "Other" },
  ],
  industry: [
    { id: "ECOMMERCE", label: "E-commerce", description: "E-commerce", aliases: ["e commerce"] },
    { id: "CONSULTING", label: "Consulting", description: "Consulting" },
    { id: "IT_SERVICES", label: "IT Services", description: "IT Services" },
    { id: "LOGISTICS", label: "Logistics", description: "Logistics" },
    { id: "PROFESSIONAL_SERVICES", label: "Professional Services", description: "Professional Services" },
    { id: "OTHER", label: "Other", description: "Other" },
  ],
  discussion: [
    { id: "PRODUCT_REQUIREMENT", label: "Product requirement", description: "Product requirement" },
    { id: "PRICING", label: "Pricing", description: "Pricing" },
    { id: "TECHNICAL_DISCUSSION", label: "Technical discussion", description: "Technical discussion" },
    { id: "DEMO", label: "Demo", description: "Demo", aliases: ["product demo"] },
    { id: "PROCUREMENT", label: "Procurement", description: "Procurement" },
    { id: "CUSTOMER_REQUIREMENT", label: "Customer requirement", description: "Customer requirement" },
    { id: "OTHER", label: "Other", description: "Other" },
  ],
  outcome: [
    { id: "FOLLOW_UP_REQUIRED", label: "Follow-up required", description: "Follow-up required", aliases: ["need follow up"] },
    { id: "PROPOSAL_REQUESTED", label: "Proposal requested", description: "Proposal requested" },
    { id: "DEMO_REQUIRED", label: "Demo required", description: "Demo required" },
    { id: "NEGOTIATION", label: "Negotiation", description: "Negotiation" },
    { id: "NO_REQUIREMENT", label: "No requirement", description: "No requirement" },
    { id: "NOT_INTERESTED", label: "Not interested", description: "Not interested" },
    { id: "CONVERTED", label: "Converted", description: "Converted", aliases: ["order confirmed"] },
  ],
  temperature: [
    { id: "HOT", label: "Hot", description: "Hot" },
    { id: "WARM", label: "Warm", description: "Warm" },
    { id: "COLD", label: "Cold", description: "Cold" },
  ],
};

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Returns the option object whose id, label or alias matches `value`, else null.
function matchOption(field, value) {
  const key = normalizeKey(value);
  if (!key) return null;
  const list = VISIT_OPTIONS[field] || [];
  return (
    list.find(
      (o) =>
        normalizeKey(o.id) === key ||
        normalizeKey(o.label) === key ||
        (o.aliases || []).some((a) => normalizeKey(a) === key),
    ) || null
  );
}

// "IT_SERVICES" -> "IT Services". Falls back to a tidied version of the raw value.
function optionLabel(field, value) {
  if (value === null || value === undefined || value === "") return null;
  const match = matchOption(field, value);
  if (match) return match.label;
  const tidy = String(value).replace(/_/g, " ").trim().toLowerCase();
  return tidy.charAt(0).toUpperCase() + tidy.slice(1);
}

// "MANUFACTURING (Manufacturing)" style lines for the LLM prompt.
function optionGuide(field) {
  return (VISIT_OPTIONS[field] || []).map((o) => `${o.id} = ${o.label}`).join("; ");
}

function optionIds(field) {
  return (VISIT_OPTIONS[field] || []).map((o) => o.id);
}

module.exports = { VISIT_OPTIONS, matchOption, optionLabel, optionIds, optionGuide, normalizeKey };