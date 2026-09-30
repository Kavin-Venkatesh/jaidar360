// Single source of truth for the New Customer Visit choice lists.
// Keep `id` identical to the ids in your Twilio Content templates (the value the bot receives when a list item is tapped).
//
// CONFIRMED from your test chat: SERVICE, IT_SERVICES, PRODUCT_REQUIREMENT, FOLLOW_UP_REQUIRED, HOT.
// Everything else below is a PLACEHOLDER GUESS. Replace with the real items from your templates.

const VISIT_OPTIONS = {
  industryGroup: [
    { id: "SERVICE", label: "Service", aliases: ["service industry"] },
    { id: "MANUFACTURING", label: "Manufacturing" }, // TODO confirm
    { id: "TRADING", label: "Trading" }, // TODO confirm
  ],
  industry: [
    { id: "IT_SERVICES", label: "IT Services" },
    { id: "E_COMMERCE", label: "E-commerce" }, // TODO confirm
    { id: "LOGISTICS", label: "Logistics" }, // TODO confirm
  ],
  discussion: [
    { id: "PRODUCT_REQUIREMENT", label: "Product requirement" },
    { id: "PRICING", label: "Pricing" }, // TODO confirm
    { id: "PRODUCT_DEMO", label: "Product demo" }, // TODO confirm
  ],
  outcome: [
    { id: "FOLLOW_UP_REQUIRED", label: "Follow-up required" },
    { id: "ORDER_CONFIRMED", label: "Order confirmed" }, // TODO confirm
    { id: "NOT_INTERESTED", label: "Not interested" }, // TODO confirm
  ],
  temperature: [
    { id: "HOT", label: "Hot" },
    { id: "WARM", label: "Warm" },
    { id: "COLD", label: "Cold" },
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

function optionIds(field) {
  return (VISIT_OPTIONS[field] || []).map((o) => o.id);
}

module.exports = { VISIT_OPTIONS, matchOption, optionLabel, optionIds };