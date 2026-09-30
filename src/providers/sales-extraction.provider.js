const env = require("../config/env");
const { matchOption, optionIds } = require("../utils/visit-options");

class SalesExtractionProvider {
  async extractMeeting() {
    throw new Error("SalesExtractionProvider.extractMeeting must be implemented by a concrete provider.");
  }
  async applyEdit() {
    throw new Error("SalesExtractionProvider.applyEdit must be implemented by a concrete provider.");
  }
}

const anyOf = (field) => optionIds(field).map((id) => `"${id}"`).join(" | ");

const SCHEMA_EXAMPLE = `{
  "company": {
    "mentioned_name": string|null,
    "industry_group": ${anyOf("industryGroup")} | null,
    "industry": ${anyOf("industry")} | null,
    "resolved_customer_id": null,
    "confidence": number 0-1
  },
  "contact": {
    "mentioned_name": string|null,
    "mobile": string|null (digits only, e.g. "9876543210"),
    "resolved_contact_id": null,
    "confidence": number 0-1
  },
  "meeting": {
    "summary": string (1-2 sentence English summary),
    "discussion_type": ${anyOf("discussion")} | null,
    "outcome": ${anyOf("outcome")} | null,
    "prospect_temperature": ${anyOf("temperature")} | null,
    "topics_discussed": string[],
    "customer_needs": string[],
    "customer_feedback": string|null,
    "customer_objections": string|null,
    "competitors_mentioned": string|null,
    "confidence": number 0-1
  },
  "requirements": [
    { "mentioned_product": string|null, "resolved_product_id": null, "quantity": number|null,
      "unit": string|null, "requested_price": number|null, "confidence": number 0-1 }
  ],
  "follow_up": {
    "required": boolean, "date": "YYYY-MM-DD"|null, "action": string|null,
    "owner": string|null, "reason": string|null, "confidence": number 0-1
  },
  "notes": string|null
}`;

const FIELD_RULES = `- contact.mobile: the customer contact's phone number as digits only. Convert spoken digits ("seven nine zero four...") to numerals. Null if not stated.
- company.industry_group, company.industry, meeting.discussion_type, meeting.outcome, meeting.prospect_temperature: use ONLY the exact allowed values shown in the schema. Pick one only if the agent says it or clearly implies it (e.g. "hot lead", "they want a quotation, I need to follow up"). If unclear or nothing fits, use null. Never guess.
- meeting.outcome is FOLLOW_UP_REQUIRED whenever a follow-up, quotation, callback or next visit is promised.`;

const EXTRACT_SYSTEM = `You extract structured CRM data from a field sales agent's spoken visit notes (transcribed from a voice note, so expect filler words, minor transcription errors, and possible Hindi/Tamil/English mixing).

Rules:
- Only use information actually stated. Never invent company names, contacts, products, quantities or prices. Use null (or empty arrays) when something isn't mentioned.
- Resolve relative dates ("Friday", "next week", "tomorrow") to an ISO date (YYYY-MM-DD) using the current date and timezone provided. If ambiguous, use null.
- Normalise units to singular lowercase (bag, kg, ton, unit).
- One entry in "requirements" per distinct product.
- follow_up.required is true only if a follow-up, quotation, callback or next step is mentioned.
- Write meeting.summary in English, concise and factual.
${FIELD_RULES}
- Respond with ONLY a single JSON object in exactly this shape, no extra text:
${SCHEMA_EXAMPLE}`;

const EDIT_SYSTEM = `You update an existing sales visit draft based on a correction from the sales agent.

Rules:
- Return the COMPLETE updated draft.
- Change only what the correction touches. Keep every other field exactly as in the current draft.
- Do not invent data. Resolve relative dates to ISO (YYYY-MM-DD) using the current date and timezone provided.
${FIELD_RULES}
- Respond with ONLY a single JSON object in exactly this shape, no extra text:
${SCHEMA_EXAMPLE}`;

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp01(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

const DIGIT_WORDS = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };

function normalizeMobile(value) {
  if (value === null || value === undefined) return null;
  const withDigits = String(value)
    .toLowerCase()
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => DIGIT_WORDS[w]);
  const digits = withDigits.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

// Accept only values that match your configured option lists; otherwise null.
function pickOptionId(field, value) {
  const match = matchOption(field, value);
  return match ? match.id : null;
}

// JSON mode guarantees valid JSON, not the right shape, so coerce to our schema.
function normalizeDraft(raw = {}) {
  const company = raw.company || {};
  const contact = raw.contact || {};
  const meeting = raw.meeting || {};
  const followUp = raw.follow_up || {};

  return {
    company: {
      mentioned_name: company.mentioned_name || null,
      industry_group: pickOptionId("industryGroup", company.industry_group),
      industry: pickOptionId("industry", company.industry),
      resolved_customer_id: null,
      confidence: clamp01(company.confidence),
    },
    contact: {
      mentioned_name: contact.mentioned_name || null,
      mobile: normalizeMobile(contact.mobile),
      resolved_contact_id: null,
      confidence: clamp01(contact.confidence),
    },
    meeting: {
      summary: meeting.summary || null,
      discussion_type: pickOptionId("discussion", meeting.discussion_type),
      outcome: pickOptionId("outcome", meeting.outcome),
      prospect_temperature: pickOptionId("temperature", meeting.prospect_temperature),
      topics_discussed: Array.isArray(meeting.topics_discussed) ? meeting.topics_discussed : [],
      customer_needs: Array.isArray(meeting.customer_needs) ? meeting.customer_needs : [],
      customer_feedback: meeting.customer_feedback || null,
      customer_objections: meeting.customer_objections || null,
      competitors_mentioned: meeting.competitors_mentioned || null,
      confidence: clamp01(meeting.confidence),
    },
    requirements: (Array.isArray(raw.requirements) ? raw.requirements : []).map((r) => ({
      mentioned_product: r.mentioned_product || null,
      resolved_product_id: null,
      quantity: toNumberOrNull(r.quantity),
      unit: r.unit ? String(r.unit).toLowerCase() : null,
      requested_price: toNumberOrNull(r.requested_price),
      confidence: clamp01(r.confidence),
    })),
    follow_up: {
      required: Boolean(followUp.required),
      date: followUp.date || null,
      action: followUp.action || null,
      owner: followUp.owner || null,
      reason: followUp.reason || null,
      confidence: clamp01(followUp.confidence),
    },
    notes: raw.notes || null,
  };
}

class GroqSalesExtractionProvider extends SalesExtractionProvider {
  async _call({ system, userContent }, attempt = 1) {
    if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set.");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0,
        max_tokens: 5000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    // One retry on rate limit / transient server errors
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      return this._call({ system, userContent }, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Groq API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned an empty response.");

    try {
      return JSON.parse(content);
    } catch (err) {
      throw new Error(`Groq returned invalid JSON: ${content.slice(0, 200)}`);
    }
  }

  _contextLine(context = {}) {
    const tz = env.BUSINESS_TIMEZONE || "Asia/Kolkata";
    const now = context.currentDate ? new Date(context.currentDate) : new Date();
    const local = now.toLocaleString("en-IN", { timeZone: tz, dateStyle: "full", timeStyle: "short" });
    const iso = now.toLocaleDateString("en-CA", { timeZone: tz });
    return `Current date: ${local} (${iso}), timezone ${tz}.`;
  }

  async extractMeeting(transcript = "", context = {}) {
    const text = String(transcript || "").trim();
    if (!text) throw new Error("Empty transcript.");

    const raw = await this._call({
      system: EXTRACT_SYSTEM,
      userContent: `${this._contextLine(context)}\n\nTranscript:\n"""\n${text}\n"""`,
    });

    const draft = normalizeDraft(raw);
    draft.notes = draft.notes || text;
    draft.extraction_context = {
      current_date: context.currentDate || new Date().toISOString(),
      agent_id: context.agentId || null,
      provider: "groq",
      model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
    };
    return draft;
  }

  async applyEdit(currentDraft = {}, instruction = "", context = {}) {
    const text = String(instruction || "").trim();
    if (!text) throw new Error("Empty edit instruction.");

    const { extraction_context, ...clean } = currentDraft;

    const raw = await this._call({
      system: EDIT_SYSTEM,
      userContent:
        `${this._contextLine(context)}\n\nCurrent draft:\n${JSON.stringify(clean, null, 2)}` +
        `\n\nAgent's correction:\n"""\n${text}\n"""`,
    });

    const updated = normalizeDraft(raw);
    updated.notes = updated.notes || clean.notes || null;
    updated.extraction_context = extraction_context || {
      current_date: context.currentDate || new Date().toISOString(),
      agent_id: context.agentId || null,
      provider: "groq",
    };
    return updated;
  }
}

// Only for local tests (LLM_PROVIDER=mock). No regex; returns a blank draft.
class MockSalesExtractionProvider extends SalesExtractionProvider {
  async extractMeeting(transcript = "") {
    return normalizeDraft({ meeting: { summary: String(transcript).slice(0, 200) }, notes: String(transcript) });
  }
  async applyEdit(currentDraft) {
    return currentDraft;
  }
}

function createSalesExtractionProvider() {
  const name = String(env.LLM_PROVIDER || "groq").toLowerCase();
  if (name === "mock") return new MockSalesExtractionProvider();
  if (name === "groq") return new GroqSalesExtractionProvider();
  throw new Error(`Unknown LLM_PROVIDER: ${name}`);
}

module.exports = {
  SalesExtractionProvider,
  GroqSalesExtractionProvider,
  MockSalesExtractionProvider,
  createSalesExtractionProvider,
  normalizeDraft,
};