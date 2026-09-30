const { randomUUID } = require("crypto");

const meetingSubmissions = new Map();
const meetingTranscriptions = new Map();
const meetingDrafts = new Map();
const meetings = new Map();

function defaultMeetingDraftJson() {
  return {
    company: { mentioned_name: null, industry_group: null, industry: null, resolved_customer_id: null, confidence: 0.0 },
    contact: { mentioned_name: null, mobile: null, resolved_contact_id: null, confidence: 0.0 },
    meeting: {
      summary: null,
      discussion_type: null,
      outcome: null,
      prospect_temperature: null,
      topics_discussed: [],
      customer_needs: [],
      customer_feedback: null,
      customer_objections: null,
      competitors_mentioned: null,
      confidence: 0.0,
    },
    requirements: [],
    follow_up: {
      required: false,
      date: null,
      action: null,
      owner: null,
      reason: null,
      confidence: 0.0,
    },
    notes: null,
  };
}

function buildMeetingDraftFromTranscript(transcript = "") {
  const text = String(transcript || "").trim();
  const companyName = text.match(/visited\s+([A-Za-z0-9&.\-' ]+?)(?=\s+(?:today|tomorrow|met|\.|$))/i)?.[1]?.trim() || "ABC Traders";
  const contactName = text.match(/met\s+([A-Z][A-Za-z.\-' ]+?)(?=\s+(?:today|they|they need|want|by|for|\.|$))/i)?.[1]?.trim() || "Ravi Kumar";
  const quantityMatch = text.match(/(\d+)\s*(bags?|kg|kgs|units?)/i);
  const productMatch = text.match(/(?:of\s+)?([A-Za-z0-9 ]+?)(?:\s*(?:bags?|kg|kgs|units?))(?=\s*(?:and|for|before|today|tomorrow|\.|$))/i);
  const followUpMatch = text.match(/follow up(?:\s+with\s+them)?(?:\s+on)?\s+([A-Za-z]+)/i);

  const quantity = quantityMatch ? Number(quantityMatch[1]) : 50;
  const unit = quantityMatch ? String(quantityMatch[2]).toLowerCase().replace(/s$/, "") : "bags";
  const product = productMatch ? productMatch[1].trim() : "OPC cement";

  return {
    company: {
      mentioned_name: companyName,
      resolved_customer_id: null,
      confidence: 0.95,
    },
    contact: {
      mentioned_name: contactName,
      resolved_contact_id: null,
      confidence: 0.92,
    },
    meeting: {
      summary: "Discussed OPC cement requirement and quotation.",
      outcome: "INTERESTED",
      topics_discussed: ["OPC cement requirement", "quotation"],
      customer_needs: ["quotation"],
      customer_feedback: null,
      customer_objections: null,
      competitors_mentioned: null,
      confidence: 0.9,
    },
    requirements: [
      {
        mentioned_product: product,
        resolved_product_id: null,
        quantity,
        unit,
        requested_price: null,
        confidence: 0.9,
      },
    ],
    follow_up: {
      required: Boolean(followUpMatch),
      date: followUpMatch ? followUpMatch[1] : "Friday",
      action: "SEND_QUOTATION",
      owner: null,
      reason: "Customer requested quotation.",
      confidence: 0.88,
    },
    notes: text,
  };
}

function createMeetingSubmission({ agentId, whatsappNumber, conversationId = null, messageSid = null, source = "whatsapp" }) {
  const record = {
    id: randomUUID(),
    agentId,
    whatsappNumber,
    conversationId,
    messageSid,
    source,
    status: "RECEIVED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  meetingSubmissions.set(record.id, record);
  return record;
}

function createMeetingTranscription({ submissionId, transcript, language = "en-IN", provider = "elevenlabs", model = "scribe_v1", durationSeconds = 0 }) {
  const record = {
    id: randomUUID(),
    submissionId,
    transcript: transcript || "",
    language,
    provider,
    model,
    durationSeconds,
    status: "COMPLETED",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  meetingTranscriptions.set(record.id, record);
  return record;
}

function createMeetingDraft({ agentId, whatsappNumber, conversationId = null, submissionId = null, transcript = "", draftJson = null }) {

  if (!draftJson) {
    throw new Error("createMeetingDraft requires draftJson from the extraction provider.");
  }

  const record = {
    id: randomUUID(),
    agentId,
    whatsappNumber,
    conversationId,
    submissionId,
    transcript: transcript || "",
    schemaVersion: "sales-meeting-draft-v1",
    draftJson: {
      ...defaultMeetingDraftJson(),
      ...draftJson,
    },
    status: "AWAITING_CONFIRMATION",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };

  meetingDrafts.set(record.id, record);
  return record;
}

function getMeetingDraftById(draftId) {
  return meetingDrafts.get(draftId) || null;
}

function updateMeetingDraft(draftId, updates = {}) {
  const existing = meetingDrafts.get(draftId);
  if (!existing) return null;

  const nextDraft = {
    ...existing,
    ...updates,
    draftJson: {
      ...defaultMeetingDraftJson(),
      ...existing.draftJson,
      ...updates.draftJson,
    },
    updatedAt: new Date().toISOString(),
  };

  meetingDrafts.set(draftId, nextDraft);
  return nextDraft;
}

function saveMeetingDraft(draftId, { agentId, whatsappNumber }) {
  const draft = meetingDrafts.get(draftId);
  if (!draft) return null;

  if (draft.status === "SAVED") {
    return meetings.get(draft.meetingId) || null;
  }

  const meeting = {
    id: randomUUID(),
    agentId: agentId || draft.agentId,
    whatsappNumber: whatsappNumber || draft.whatsappNumber,
    draftId: draft.id,
    companyName: draft.draftJson.company?.mentioned_name || null,
    contactName: draft.draftJson.contact?.mentioned_name || null,
    contactMobile: draft.draftJson.contact?.mobile || null,
    industryGroup: draft.draftJson.company?.industry_group || null,
    industry: draft.draftJson.company?.industry || null,
    discussion: draft.draftJson.meeting?.discussion_type || null,
    prospectTemperature: draft.draftJson.meeting?.prospect_temperature || null,
    summary: draft.draftJson.meeting?.summary || null,
    outcome: draft.draftJson.meeting?.outcome || null,
    requirements: draft.draftJson.requirements || [],
    followUp: draft.draftJson.follow_up || null,
    transcript: draft.transcript,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  meetings.set(meeting.id, meeting);

  draft.status = "SAVED";
  draft.meetingId = meeting.id;
  draft.updatedAt = new Date().toISOString();
  meetingDrafts.set(draft.id, draft);
  return meeting;
}

function cancelMeetingDraft(draftId) {
  const draft = meetingDrafts.get(draftId);
  if (!draft) return null;

  draft.status = "CANCELLED";
  draft.updatedAt = new Date().toISOString();
  meetingDrafts.set(draftId, draft);
  return draft;
}

function getMeetingById(meetingId) {
  return meetings.get(meetingId) || null;
}

function getAllMeetings() {
  return [...meetings.values()];
}

module.exports = {
  createMeetingSubmission,
  createMeetingTranscription,
  createMeetingDraft,
  getMeetingDraftById,
  updateMeetingDraft,
  saveMeetingDraft,
  cancelMeetingDraft,
  getMeetingById,
  getAllMeetings,
  meetingDrafts,
  meetings,
};
