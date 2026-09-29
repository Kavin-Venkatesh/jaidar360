const twilio = require("twilio");
const env = require("../config/env");

const client =
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
    ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
    : null;

function formatWhatsAppNumber(value) {
  if (value === null || value === undefined) {
    return value;
  }

  const trimmed = String(value).trim();

  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith("whatsapp:")) {
    return trimmed;
  }

  const compact = trimmed.replace(/\s+/g, "");

  if (compact.startsWith("+")) {
    return `whatsapp:${compact}`;
  }

  return `whatsapp:+${compact.replace(/^\+/, "")}`;
}

const from = formatWhatsAppNumber(env.TWILIO_WHATSAPP_NUMBER);

function normalizeOutboundRecipient(value) {
  return formatWhatsAppNumber(value);
}

function shouldSkipOutbound(to) {
  return normalizeOutboundRecipient(to) === from;
}

function assertTwilioConfigured() {
  if (!client || !from) {
    throw new Error(
      "Twilio client is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER.",
    );
  }
}

function buildCardContentVariables(actionUrl) {
  const fullUrl = String(actionUrl || "").trim();

  if (!fullUrl) {
    throw new Error("Location action URL is required.");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(fullUrl);
  } catch (error) {
    throw new Error(`Invalid location action URL: ${fullUrl}`);
  }

  const token = parsedUrl.searchParams.get("token");

  if (!token) {
    throw new Error(
      `Location action URL must contain a token query parameter: ${fullUrl}`,
    );
  }

  return {
    "1": token,
  };
}

function safeFallbackMessage({
  title,
  body,
  items = [],
  ctaTitle,
  actionUrl,
}) {
  const parts = [];

  if (title) {
    parts.push(title);
  }

  if (body) {
    parts.push(body);
  }

  if (items.length > 0) {
    parts.push(
      items
        .map((item) => `- ${item.label || item.item || item.id}`)
        .join("\n"),
    );
  }

  if (ctaTitle && actionUrl) {
    parts.push(`${ctaTitle}: ${actionUrl}`);
  }

  return parts.join("\n\n");
}

/**
 * Send a normal WhatsApp text message.
 */
async function sendText(to, body) {
  assertTwilioConfigured();

  const recipient = normalizeOutboundRecipient(to);

  if (!recipient) {
    throw new Error("WhatsApp recipient is required.");
  }

  if (shouldSkipOutbound(recipient)) {
    console.warn(
      "Skipping outbound Twilio message because sender and recipient are the same WhatsApp channel.",
    );

    return {
      sid: "mock-same-channel",
      status: "skipped",
      to: recipient,
      body,
    };
  }

  try {
    const message = await client.messages.create({
      from,
      to: recipient,
      body: String(body || ""),
    });

    console.log("Sent WhatsApp message:", {
      sid: message.sid,
      to: recipient,
    });

    return message;
  } catch (error) {
    console.error("Twilio sendText failed:", {
      message: error.message,
      code: error.code,
      status: error.status,
    });

    throw error;
  }
}


async function sendList(
  to,
  {
    title = "Choose",
    button = "Choose",
    items = [],
    contentSid = null,
    variables = {},
  } = {},
) {
  assertTwilioConfigured();

  const recipient = normalizeOutboundRecipient(to);

  if (!recipient) {
    throw new Error("WhatsApp recipient is required.");
  }

  if (shouldSkipOutbound(recipient)) {
    console.warn(
      "Skipping outbound list because sender and recipient are the same WhatsApp channel.",
    );

    return {
      sid: "mock-same-channel",
      status: "skipped",
      to: recipient,
    };
  }

  const templateSid = contentSid || env.CONTENT_MAIN_MENU;

  try {
    if (templateSid) {
      const message = await client.messages.create({
        from,
        to: recipient,
        contentSid: templateSid,
        contentVariables: JSON.stringify(variables || {}),
      });

      console.log("Sent WhatsApp list template:", {
        sid: message.sid,
        contentSid: templateSid,
        to: recipient,
      });

      return message;
    }

    const fallbackBody = safeFallbackMessage({
      title,
      body: button,
      items,
    });

    return await sendText(recipient, fallbackBody);
  } catch (error) {
    console.error("Twilio sendList failed:", {
      message: error.message,
      code: error.code,
      status: error.status,
    });

    throw error;
  }
}

async function sendQuickReply(
  to,
  {
    title = "Choose",
    contentSid = null,
    variables = {},
  } = {},
) {
  assertTwilioConfigured();

  const recipient = normalizeOutboundRecipient(to);

  if (!recipient) {
    throw new Error("WhatsApp recipient is required.");
  }

  if (shouldSkipOutbound(recipient)) {
    return {
      sid: "mock-same-channel",
      status: "skipped",
      to: recipient,
      title,
    };
  }

  try {
    if (contentSid) {
      return await client.messages.create({
        from,
        to: recipient,
        contentSid,
        contentVariables: JSON.stringify(variables || {}),
      });
    }

    return await sendText(recipient, title);
  } catch (error) {
    console.error("Twilio sendQuickReply failed:", {
      message: error.message,
      code: error.code,
      status: error.status,
    });

    throw error;
  }
}

async function sendCard(
  to,
  {
    title,
    body,
    mediaUrl,
    ctaTitle,
    actionUrl,
    contentSid: explicitContentSid = null,
  },
) {
  assertTwilioConfigured();

  const recipient = normalizeOutboundRecipient(to);

  if (!recipient) {
    throw new Error("WhatsApp recipient is required.");
  }

  if (shouldSkipOutbound(recipient)) {
    console.warn(
      "Skipping outbound card because sender and recipient are the same WhatsApp channel.",
    );

    return {
      sid: "mock-same-channel",
      status: "skipped",
      to: recipient,
      title,
    };
  }

  /**
   * Prefer an explicitly supplied SID.
   *
   * Otherwise select your existing location template
   * based on the card type.
   */
  const templateSid =
    explicitContentSid ||
    (title === "Visit location"
      ? env.CONTENT_VISIT_LOCATION
      : env.CONTENT_CHECK_IN_LOCATION);

  try {
    if (templateSid) {
      if (!actionUrl) {
        throw new Error(
          `Missing actionUrl for WhatsApp location card: ${title}`,
        );
      }

      const contentVariables =
        buildCardContentVariables(actionUrl);

      console.log("Sending WhatsApp location card:", {
        templateSid,
        to: recipient,
        actionUrl,
        contentVariables,
      });

      const message = await client.messages.create({
        from,
        to: recipient,
        contentSid: templateSid,
        contentVariables: JSON.stringify(contentVariables),
      });

      console.log("WhatsApp location card sent:", {
        sid: message.sid,
        contentSid: templateSid,
        to: recipient,
      });

      return message;
    }

    /**
     * Development fallback when the Content Template
     * has not been configured.
     */
    const fallbackBody = safeFallbackMessage({
      title,
      body,
      ctaTitle,
      actionUrl,
    });

    return await sendText(recipient, fallbackBody);
  } catch (error) {
    console.error("Twilio sendCard failed:", {
      message: error.message,
      code: error.code,
      status: error.status,
      templateSid,
      to: recipient,
    });

    throw error;
  }
}

/**
 * Generic Content Template sender.
 */
async function sendTemplate(to, templateName, variables = {}) {
  assertTwilioConfigured();

  if (!templateName) {
    throw new Error("Template Content SID is required.");
  }

  const recipient = normalizeOutboundRecipient(to);

  if (!recipient) {
    throw new Error("WhatsApp recipient is required.");
  }

  if (shouldSkipOutbound(recipient)) {
    console.warn(
      "Skipping outbound template because sender and recipient are the same WhatsApp channel.",
    );

    return {
      sid: "mock-same-channel",
      status: "skipped",
      to: recipient,
      templateName,
    };
  }

  try {
    const message = await client.messages.create({
      from,
      to: recipient,
      contentSid: templateName,
      contentVariables: JSON.stringify(variables || {}),
    });

    console.log("Sent WhatsApp template:", {
      sid: message.sid,
      contentSid: templateName,
      to: recipient,
    });

    return message;
  } catch (error) {
    console.error("Twilio sendTemplate failed:", {
      message: error.message,
      code: error.code,
      status: error.status,
      contentSid: templateName,
    });

    throw error;
  }
}

module.exports = {
  sendText,
  sendList,
  sendQuickReply,
  sendCard,
  sendTemplate,
  buildCardContentVariables,
  formatWhatsAppNumber,
  normalizeOutboundRecipient,
};