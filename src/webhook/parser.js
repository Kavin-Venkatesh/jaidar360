// Flattens a Meta WhatsApp Cloud API webhook (entry[].changes[].value) into flow-engine events.
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components

function toMessageEvent(msg, value) {
  const contact = (value.contacts || []).find((c) => c.wa_id === msg.from) || value.contacts?.[0] || {};
  const event = {
    type: "message",
    waMessageId: msg.id,
    phoneNumberId: value.metadata?.phone_number_id,
    from: msg.from || contact.wa_id || null,
    // Business-scoped user ID, sent once usernames roll out; stored so agents can be matched without a phone.
    fromUserId: msg.from_user_id || contact.user_id || null,
    profileName: contact.profile?.name || null,
    // WhatsApp sets context.id when the user taps a button on (or replies to) an older message.
    contextMessageId: msg.context?.id || null,
    kind: "unsupported",
    rawType: msg.type,
    text: "",
  };

  switch (msg.type) {
    case "text":
      return { ...event, kind: "text", text: msg.text?.body || "" };
    case "interactive": {
      const i = msg.interactive || {};
      if (i.type === "button_reply" || i.button_reply) {
        return { ...event, kind: "button_reply", replyId: i.button_reply?.id, text: i.button_reply?.title || "" };
      }
      if (i.type === "list_reply" || i.list_reply) {
        return { ...event, kind: "list_reply", replyId: i.list_reply?.id, text: i.list_reply?.title || "" };
      }
      return event;
    }
    case "button": // quick reply on a template message
      return { ...event, kind: "button_reply", replyId: msg.button?.payload, text: msg.button?.text || "" };
    case "location":
      return {
        ...event,
        kind: "location",
        location: {
          latitude: msg.location?.latitude,
          longitude: msg.location?.longitude,
          name: msg.location?.name || null,
          address: msg.location?.address || null,
        },
      };
    case "image":
    case "document":
      return {
        ...event,
        kind: msg.type,
        text: msg[msg.type]?.caption || "",
        media: {
          id: msg[msg.type]?.id,
          mimeType: msg[msg.type]?.mime_type,
          filename: msg[msg.type]?.filename || null,
          caption: msg[msg.type]?.caption || null,
        },
      };
    default:
      return event;
  }
}

function toStatusEvent(status, value) {
  return {
    type: "status",
    phoneNumberId: value.metadata?.phone_number_id,
    waMessageId: status.id,
    status: status.status, // sent | delivered | read | failed
    recipient: status.recipient_id,
    errors: (status.errors || []).map((e) => `${e.code}: ${e.title || e.message || ""}${e.error_data?.details ? ` (${e.error_data.details})` : ""}`),
  };
}

function parseWebhook(body = {}) {
  if (body.object !== "whatsapp_business_account") return [];
  const events = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const msg of value.messages || []) events.push(toMessageEvent(msg, value));
      for (const status of value.statuses || []) events.push(toStatusEvent(status, value));
    }
  }
  return events;
}

module.exports = { parseWebhook };
