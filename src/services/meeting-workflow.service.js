const twilioService = require("./twilio.service");
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

function renderMeetingDraftSummary(draft) {
  const draftJson = draft.draftJson || {};
  const company = draftJson.company?.mentioned_name || "Not provided";
  const contact = draftJson.contact?.mentioned_name || "Not provided";
  const summary = draftJson.meeting?.summary || "Not provided";
  const requirements =
    draftJson.requirements && draftJson.requirements.length
      ? draftJson.requirements
          .map((item) => `${item.mentioned_product || "Product"} — ${item.quantity ?? "?"} ${item.unit || "units"}`)
          .join("\n")
      : "No product details captured.";
  const followUp = draftJson.follow_up?.required
    ? [draftJson.follow_up.date, draftJson.follow_up.action].filter(Boolean).join(" — ") || "Required"
    : "Not required";

  return [
    "📋 Meeting Summary",
    "",
    "🏢 Company",
    String(company),
    "",
    "👤 Contact",
    String(contact),
    "",
    "📝 Meeting",
    String(summary),
    "",
    "📦 Requirement",
    String(requirements),
    "",
    "📅 Follow-up",
    String(followUp),
    "",
    "Please confirm these details.",
    "",
    "[ Save ] [ Edit ] [ Cancel ]",
  ].join("\n");
}

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

  await twilioService.sendText(from, renderMeetingDraftSummary(getMeetingDraftById(draftId)));
  await twilioService.sendText(from, "Reply SAVE, EDIT, or CANCEL to continue.");
}

async function processVoiceMeetingSubmission({ conversation, from, message }) {
  if (!conversation) return false;
  if (!isVoiceMessage(message)) return false;

  try {
    await twilioService.sendText(from, "🎙️ Got your voice note, processing...");
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

    await twilioService.sendText(from, renderMeetingDraftSummary(draft));
    await twilioService.sendText(from, "Reply SAVE, EDIT, or CANCEL to continue.");
    return true;
  } catch (error) {
    console.error("[voice-meeting] failed:", error);
    await twilioService.sendText(
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
    await twilioService.sendText(
      from,
      `✅ Meeting saved successfully.\nCompany: ${savedMeeting.companyName || "Not provided"}\nContact: ${savedMeeting.contactName || "Not provided"}`,
    );
    return true;
  }

  if (actionKey === "CANCEL") {
    cancelMeetingDraft(draftId);
    conversation.currentState = "MAIN_MENU";
    conversation.data = conversation.data || {};
    conversation.data.activeDraftId = null;
    updateConversation(from, conversation);
    await twilioService.sendText(from, "❌ Meeting draft cancelled.");
    return true;
  }

  // User tapped/typed EDIT: ask what to change
  if (actionKey === "EDIT" && !isEditing) {
    conversation.currentState = "EDITING_MEETING_DRAFT";
    updateConversation(from, conversation);
    await twilioService.sendText(
      from,
      "✏️ What would you like to change? Send a text or voice note, e.g. \"Change the quantity to 100 bags\".",
    );
    return true;
  }

  // In editing state: the message itself is the correction
  if (isEditing) {
    if (!text) {
      await twilioService.sendText(from, "Please tell me what to change (text or voice note), or reply CANCEL.");
      return true;
    }
    try {
      await applyEditAndReply({ conversation, from, draftId, instruction: text });
    } catch (error) {
      console.error("[meeting-edit] failed:", error);
      await twilioService.sendText(from, "⚠️ Sorry, I couldn't apply that change. Please try rephrasing it.");
    }
    return true;
  }

  // Awaiting confirmation but unrecognised reply
  await twilioService.sendText(from, "Please reply SAVE, EDIT, or CANCEL.");
  return true;
}

module.exports = {
  isVoiceMessage,
  processVoiceMeetingSubmission,
  handleMeetingDraftAction,
  renderMeetingDraftSummary,
};