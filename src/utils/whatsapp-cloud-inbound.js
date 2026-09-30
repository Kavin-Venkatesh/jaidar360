// Converts a Meta WhatsApp Cloud API webhook body into the Twilio-style fields that action-parser.js,
// meeting-workflow.service.js and conversation.service.js already understand (From, Body, ButtonPayload, ListId, MediaUrl0...).
// Payload shape: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components

// Voice notes carry a media ID, not a URL. speech-to-text.provider.js resolves this prefix through the Cloud API.
const MEDIA_REF_PREFIX = "whatsapp-media:";

function toInboundMessage(msg) {
  const base = {
    From: `+${msg.from}`,
    MessageSid: msg.id,
    MessageType: msg.type,
    Body: "",
  };

  switch (msg.type) {
    case "text":
      return { ...base, Body: msg.text?.body || "" };

    case "interactive": {
      const button = msg.interactive?.button_reply;
      if (button) return { ...base, Body: button.title, ButtonPayload: button.id, ButtonText: button.title };
      const row = msg.interactive?.list_reply;
      if (row) return { ...base, Body: row.title, ListId: row.id };
      return base;
    }

    // Quick-reply button on an approved template message.
    case "button":
      return { ...base, Body: msg.button?.text || "", ButtonPayload: msg.button?.payload, ButtonText: msg.button?.text };

    case "audio":
      return {
        ...base,
        MediaUrl0: `${MEDIA_REF_PREFIX}${msg.audio?.id}`,
        MediaContentType0: msg.audio?.mime_type || "audio/ogg",
      };

    // Images, stickers, shared locations etc. are not used by the bot; they parse as UNKNOWN.
    default:
      return base;
  }
}

// Returns every user message in the webhook. Delivery/read `statuses` events are ignored.
function extractInboundMessages(body = {}) {
  if (body.object !== "whatsapp_business_account") return [];

  const messages = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) {
        messages.push(toInboundMessage(msg));
      }
    }
  }
  return messages;
}

module.exports = {
  MEDIA_REF_PREFIX,
  extractInboundMessages,
  toInboundMessage,
};
