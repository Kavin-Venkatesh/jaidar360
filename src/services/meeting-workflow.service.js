const env = require("../config/env");
const messaging = require("./messaging.service");
const { optionLabel } = require("../utils/visit-options");
const { updateConversation } = require("../repositories/in-memory-store");
const { createSpeechToTextProvider } = require("../providers/speech-to-text.provider");
const { createSalesExtractionProvider } = require("../providers/sales-extraction.provider");
const {
  createMeetingSubmission,
  createMeetingTranscription,
  createMeetingDraft,
  getMeetingDraftById,
  updateMeetingDraft,
  saveMeetingDraft,
  cancelMeetingDraft,
} = require("./meeting-draft.service");

function isVoiceMessage(message = {}) {
  const mediaUrl = message.MediaUrl0 || message.mediaUrl0;
  const mediaType = String(message.MediaContentType0 || message.mediaContentType0 || "").toLowerCase();
  const messageType = String(message.MessageType || message.messageType || "").toLowerCase();
  if (!mediaUrl) return false;
  // Don't treat images/documents as voice notes
  return mediaType.startsWith("audio/") || messageType.includes("audio") || messageType.includes("voice") || !mediaType;
}

function normalizeDraftAction(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["save", "save draft", "confirm", "submit", "finalize"].includes(normalized)) return "SAVE";
  if (["edit", "change", "update"].includes(normalized)) return "EDIT";
  if (["cancel", "discard", "delete draft"].includes(normalized)) return "CANCEL";
  return normalized.toUpperCase();
}

const DRAFT_BUTTONS = [
  { id: "SAVE", title: "Save" },
  { id: "EDIT", title: "Edit" },
  { id: "CANCEL", title: "Cancel" },
];

// WhatsApp quick-reply body is limited to 1,024 chars and the Content template adds a header/footer around {{1}}.
const MAX_SUMMARY_CHARS = 850;

// Details only (no header / buttons): this is the {{1}} variable of the CONTENT_MEETING_DRAFT_ACTIONS template.
function renderMeetingDraftSummary(draft) {
  const d = draft.draftJson || {};
  const NP = "Not provided";
  const company = d.company || {};
  const contact = d.contact || {};
  const meeting = d.meeting || {};

  const industry = [optionLabel("industryGroup", company.industry_group), optionLabel("industry", company.industry)]
    .filter(Boolean)
    .join(" / ");
  const requirements = (d.requirements || [])
    .map((item) => `• ${item.mentioned_product || "Product"} — ${item.quantity ?? "?"} ${item.unit || "units"}`)
    .join("\n");
  const followUp = d.follow_up?.required
    ? [d.follow_up.date, d.follow_up.action].filter(Boolean).join(" — ") || "Required"
    : "Not required";

  const text = [
    `🏢 Company: ${company.mentioned_name || NP}`,
    `🏭 Industry: ${industry || NP}`,
    `👤 Contact: ${contact.mentioned_name || NP}`,
    `📞 Mobile: ${contact.mobile || NP}`,
    `💬 Discussion: ${optionLabel("discussion", meeting.discussion_type) || NP}`,
    `🏁 Outcome: ${optionLabel("outcome", meeting.outcome) || NP}`,
    `🌡️ Prospect: ${optionLabel("temperature", meeting.prospect_temperature) || NP}`,
    `📝 Summary: ${meeting.summary || NP}`,
    `📦 Requirement:${requirements ? `\n${requirements}` : " None captured"}`,
    `📅 Follow-up: ${followUp}`,
  ].join("\n");

  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…` : text;
}

// Meeting summary with Save / Edit / Cancel buttons in ONE message:
// Twilio -> CONTENT_MEETING_DRAFT_ACTIONS quick-reply template; WhatsApp Cloud -> native reply buttons (max 3, body <= 1,024).
async function sendMeetingDraftSummary(from, draft) {
  const details = renderMeetingDraftSummary(draft);

  await messaging.sendContentOr(from, env.CONTENT_MEETING_DRAFT_ACTIONS, { 1: details }, () =>
    messaging.sendQuickReply(from, {
      title: `📋 Meeting Summary\n\n${details}\n\nPlease confirm these details.`,
      buttons: DRAFT_BUTTONS,
    }),
  );
}

// Called when the agent says "hi" (etc.) mid-draft: re-show where they are instead of restarting.
async function resumeMeetingDraftPrompt({ conversation, from }) {
  const draftId = conversation.data?.activeDraftId || conversation.activeDraftId;
  const draft = draftId && getMeetingDraftById(draftId);
  if (!draft) return false;

  await messaging.sendText(from, "👋 Let's continue with your meeting draft.");
  if (conversation.currentState === "EDITING_MEETING_DRAFT") {
    await messaging.sendText(from, EDIT_PROMPT);
  } else {
    await sendMeetingDraftSummary(from, draft);
  }
  return true;
}

const EDIT_PROMPT =
  '✏️ What would you like to change? Send a text or voice note, e.g. "Change the quantity to 100 bags" or "Mark as hot lead". Reply Cancel to discard.';

async function transcribeMessage(message) {
  const transcriptionProvider = createSpeechToTextProvider();
  return transcriptionProvider.transcribe({
    url: message.MediaUrl0 || message.mediaUrl0,
    mimeType: message.MediaContentType0 || message.mediaContentType0 || "audio/ogg",
    // language intentionally omitted -> ElevenLabs auto-detects (English / Hindi / Tamil etc.)
  });
}

async function applyEditAndReply({ conversation, from, draftId, instruction }) {
  const draft = getMeetingDraftById(draftId);
  const extractionProvider = createSalesExtractionProvider();

  const updatedJson = await extractionProvider.applyEdit(draft.draftJson, instruction, {
    currentDate: new Date().toISOString(),
    agentId: conversation.agentId,
  });

  // Replace whole draftJson (LLM returns the complete updated draft)
  updateMeetingDraft(draftId, { draftJson: updatedJson, status: "AWAITING_CONFIRMATION" });
  conversation.currentState = "AWAITING_MEETING_DRAFT_CONFIRMATION";
  updateConversation(from, conversation);

  await sendMeetingDraftSummary(from, getMeetingDraftById(draftId));
}

async function processVoiceMeetingSubmission({ conversation, from, message }) {
  if (!conversation) return false;
  if (!isVoiceMessage(message)) return false;

  try {
    await messaging.sendText(from, "🎙️ Got your voice note, processing...");
    const transcription = await transcribeMessage(message);

    // Voice note while editing => treat as the correction, not a new meeting
    if (conversation.currentState === "EDITING_MEETING_DRAFT") {
      const draftId = conversation.data?.activeDraftId;
      if (draftId && getMeetingDraftById(draftId)) {
        await applyEditAndReply({ conversation, from, draftId, instruction: transcription.text });
        return true;
      }
    }

    const submission = createMeetingSubmission({
      agentId: conversation.agentId,
      whatsappNumber: from,
      conversationId: conversation.id,
      messageSid: message.MessageSid || message.messageSid || null,
      source: "whatsapp",
    });

    createMeetingTranscription({
      submissionId: submission.id,
      transcript: transcription.text,
      language: transcription.language,
      provider: transcription.provider,
      model: transcription.model,
      durationSeconds: transcription.duration_seconds || 0,
    });

    const extractionProvider = createSalesExtractionProvider();
    const extracted = await extractionProvider.extractMeeting(transcription.text, {
      currentDate: new Date().toISOString(),
      agentId: conversation.agentId,
    });

    const draft = createMeetingDraft({
      agentId: conversation.agentId,
      whatsappNumber: from,
      conversationId: conversation.id,
      submissionId: submission.id,
      transcript: transcription.text,
      draftJson: extracted,
    });

    conversation.currentState = "AWAITING_MEETING_DRAFT_CONFIRMATION";
    conversation.data = conversation.data || {};
    conversation.data.activeDraftId = draft.id;
    updateConversation(from, conversation);

    await sendMeetingDraftSummary(from, draft);
    return true;
  } catch (error) {
    console.error("[voice-meeting] failed:", error);
    await messaging.sendText(
      from,
      "⚠️ Sorry, I couldn't process that voice note. Please try again, or send it as a shorter recording.",
    );
    return true; // handled (with an error), don't fall through to the menu logic
  }
}

async function handleMeetingDraftAction({ conversation, from, action }) {
  if (!conversation) return false;
  const draftId = conversation.data?.activeDraftId || conversation.activeDraftId;
  if (!draftId) return false;

  const draft = getMeetingDraftById(draftId);
  if (!draft) return false;

  const text = String(action?.text || action?.Body || "").trim();
  const actionKey = normalizeDraftAction(action?.action || text);
  const isEditing = conversation.currentState === "EDITING_MEETING_DRAFT";

  if (actionKey === "SAVE") {
    const savedMeeting = saveMeetingDraft(draftId, { agentId: conversation.agentId, whatsappNumber: from });
    conversation.currentState = "MAIN_MENU";
    conversation.data = conversation.data || {};
    conversation.data.activeDraftId = null;
    updateConversation(from, conversation);
    await messaging.sendText(
      from,
      `✅ Meeting saved successfully.\nCompany: ${savedMeeting?.companyName || "Not provided"}\nContact: ${savedMeeting?.contactName || "Not provided"}`,
    );
    return true;
  }

  if (actionKey === "CANCEL") {
    cancelMeetingDraft(draftId);
    conversation.currentState = "MAIN_MENU";
    conversation.data = conversation.data || {};
    conversation.data.activeDraftId = null;
    updateConversation(from, conversation);
    await messaging.sendText(from, "❌ Meeting draft cancelled.");
    return true;
  }

  // User tapped/typed EDIT: ask what to change
  if (actionKey === "EDIT" && !isEditing) {
    conversation.currentState = "EDITING_MEETING_DRAFT";
    updateConversation(from, conversation);
    await messaging.sendText(from, EDIT_PROMPT);
    return true;
  }

  // In editing state: the message itself is the correction
  if (isEditing) {
    if (!text) {
      await messaging.sendText(from, "Please tell me what to change (text or voice note), or reply Cancel.");
      return true;
    }
    try {
      await applyEditAndReply({ conversation, from, draftId, instruction: text });
    } catch (error) {
      console.error("[meeting-edit] failed:", error);
      await messaging.sendText(from, "⚠️ Sorry, I couldn't apply that change. Please try rephrasing it.");
    }
    return true;
  }

  // Awaiting confirmation but unrecognised reply
  await messaging.sendText(from, "Please tap Save, Edit or Cancel.");
  await sendMeetingDraftSummary(from, draft);
  return true;
}

module.exports = {
  isVoiceMessage,
  processVoiceMeetingSubmission,
  handleMeetingDraftAction,
  renderMeetingDraftSummary,
  sendMeetingDraftSummary,
  resumeMeetingDraftPrompt,
};