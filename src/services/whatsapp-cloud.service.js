// Meta WhatsApp Cloud API sender. Same function names as twilio.service.js so messaging.service.js can swap them.
// Interactive messages (buttons / list / CTA URL) are sent natively, no pre-created templates needed,
// as long as the user messaged us in the last 24 hours (true for this reply-driven bot).
//
// Docs:
//   Send:    https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
//            https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
//            https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-cta-url-messages
//   Media:   https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media

const env = require("../config/env");

// Meta limits (from the docs above).
const LIMITS = {
  buttonBody: 1024,
  listBody: 4096,
  textBody: 4096,
  buttonTitle: 20,
  maxButtons: 3,
  rowTitle: 24,
  rowDescription: 72,
  maxRows: 10,
  listButton: 20,
};

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function assertConfigured() {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WhatsApp Cloud API is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.");
  }
}

function graphUrl(path) {
  return `https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}/${path}`;
}

// Cloud API wants the number as digits only, e.g. "919876543210".
function toRecipient(to) {
  const digits = String(to || "").replace(/^whatsapp:/i, "").replace(/\D/g, "");
  if (!digits) throw new Error("WhatsApp recipient is required.");
  return digits;
}

async function postMessage(to, payload) {
  assertConfigured();
  const recipient = toRecipient(to);

  const response = await fetch(graphUrl(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, ...payload }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(`WhatsApp Cloud API error ${response.status}: ${data.error?.message || "unknown error"}`);
    err.status = response.status;
    err.code = data.error?.code;
    console.error("WhatsApp Cloud send failed:", { to: recipient, type: payload.type, status: err.status, code: err.code, message: err.message });
    throw err;
  }

  const sid = data.messages?.[0]?.id || null;
  console.log("Sent WhatsApp Cloud message:", { id: sid, type: payload.type, to: recipient });
  return { sid, status: "accepted", to: recipient };
}

async function sendText(to, body) {
  return postMessage(to, {
    type: "text",
    text: { body: truncate(body, LIMITS.textBody), preview_url: true },
  });
}

async function sendList(to, { title = "Choose", button = "Choose", items = [] } = {}) {
  if (!items.length) return sendText(to, title);

  return postMessage(to, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: truncate(title, LIMITS.listBody) },
      action: {
        button: truncate(button, LIMITS.listButton),
        sections: [
          {
            rows: items.slice(0, LIMITS.maxRows).map((item) => ({
              id: String(item.id),
              title: truncate(item.label || item.item || item.id, LIMITS.rowTitle),
              ...(item.description ? { description: truncate(item.description, LIMITS.rowDescription) } : {}),
            })),
          },
        ],
      },
    },
  });
}

async function sendQuickReply(to, { title = "Choose", buttons = [] } = {}) {
  if (!buttons.length) return sendText(to, title);
  // Reply buttons are capped at 3; anything longer becomes a list.
  if (buttons.length > LIMITS.maxButtons) {
    return sendList(to, { title, items: buttons.map((b) => ({ id: b.id, label: b.title })) });
  }

  return postMessage(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: truncate(title, LIMITS.buttonBody) },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: String(b.id), title: truncate(b.title, LIMITS.buttonTitle) },
        })),
      },
    },
  });
}

// Card = image header + body + one URL button (interactive cta_url). `contentSid` is Twilio-only and ignored here.
async function sendCard(to, { title, body, mediaUrl, ctaTitle, actionUrl } = {}) {
  if (!actionUrl) throw new Error(`Missing actionUrl for WhatsApp card: ${title}`);
  const image = mediaUrl || env.LOCATION_IMAGE_URL;

  return postMessage(to, {
    type: "interactive",
    interactive: {
      type: "cta_url",
      ...(image ? { header: { type: "image", image: { link: image } } } : {}),
      body: { text: truncate([title && `*${title}*`, body].filter(Boolean).join("\n\n"), LIMITS.buttonBody) },
      action: {
        name: "cta_url",
        parameters: { display_text: truncate(ctaTitle || "Open", LIMITS.buttonTitle), url: actionUrl },
      },
    },
  });
}

// Twilio Content SIDs (HX...) mean nothing to Meta. messaging.service.js never calls this for this provider.
async function sendTemplate(to, templateName) {
  throw new Error(`Twilio Content templates are not supported by the WhatsApp Cloud provider (${templateName}).`);
}

// Media IDs from webhooks resolve to a URL that expires after 5 minutes, so resolve right before downloading.
async function downloadMedia(mediaId) {
  assertConfigured();
  const auth = { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` };

  const metaRes = await fetch(graphUrl(`${mediaId}?phone_number_id=${env.WHATSAPP_PHONE_NUMBER_ID}`), {
    headers: auth,
    signal: AbortSignal.timeout(15000),
  });
  if (!metaRes.ok) throw new Error(`Failed to look up WhatsApp media ${mediaId}: HTTP ${metaRes.status}`);
  const { url } = await metaRes.json();

  const fileRes = await fetch(url, { headers: auth, signal: AbortSignal.timeout(30000) });
  if (!fileRes.ok) throw new Error(`Failed to download WhatsApp media ${mediaId}: HTTP ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

module.exports = {
  sendText,
  sendList,
  sendQuickReply,
  sendCard,
  sendTemplate,
  downloadMedia,
  LIMITS,
};
