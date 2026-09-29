function normalizeActionId(value) {
  if (value === null || value === undefined) return "";
  const cleaned = String(value).trim();
  if (!cleaned) return "";
  return cleaned.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function resolveListMenuAction(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, " ");

  if (["check in", "checkin"].includes(normalized)) return "CHECK_IN";
  if (["new customer visit"].includes(normalized)) return "NEW_CUSTOMER_VISIT";

  return null;
}

function parseIncomingMessage(message = {}) {
  const body = String(message.Body || "").trim();
  const listReply = message.ListReply || message.list_reply || null;
  const listPayload = message.ListId || message.ListResponse || message.list_response || message.listId
    || (listReply && (listReply.ListId || listReply.listId || listReply.list_id))
    || message.ListItemId || message.listItemId || message.ListItemResponse || message.listItemResponse;

  if (listPayload || listReply || message.ListItemId || message.listItemId) {
    let actionId = listPayload;
    let text = body;

    if (listReply && typeof listReply === "object") {
      actionId = listReply.ListItemId || listReply.listItemId || listReply.list_item_id || listReply.id || actionId;
      text = listReply.ListItemTitle || listReply.listItemTitle || listReply.title || text;
    }

    if (typeof listPayload === "string") {
      try {
        const parsed = JSON.parse(listPayload);
        actionId = parsed.id || parsed.listId || parsed.list_id || parsed.ListItemId || parsed.listItemId || actionId;
        text = parsed.title || parsed.listTitle || parsed.ListItemTitle || parsed.listItemTitle || text;
      } catch (error) {
        // no-op: preserve raw signals
      }
    } else if (typeof listPayload === "object") {
      actionId = listPayload.id || listPayload.listId || listPayload.list_id || listPayload.ListItemId || listPayload.listItemId || actionId;
      text = listPayload.title || listPayload.listTitle || listPayload.ListItemTitle || listPayload.listItemTitle || text;
    }

    if (actionId) {
      const normalizedAction = normalizeActionId(actionId);
      return {
        type: "LIST_SELECTION",
        action: normalizedAction || String(actionId).trim(),
        text: text || body,
      };
    }
  }

  const buttonPayload = message.ButtonPayload || message.ButtonResponse || message.button_response || message.buttonPayload;
  if (buttonPayload) {
    let actionId = buttonPayload;
    let text = message.ButtonText || body;

    if (typeof buttonPayload === "string") {
      try {
        const parsed = JSON.parse(buttonPayload);
        actionId = parsed.payload || parsed.id || actionId;
        text = parsed.text || text;
      } catch (error) {
        // no-op: preserve raw signals
      }
    } else if (typeof buttonPayload === "object") {
      actionId = buttonPayload.payload || buttonPayload.id || actionId;
      text = buttonPayload.text || text;
    }

    return {
      type: "BUTTON_SELECTION",
      action: normalizeActionId(actionId) || String(actionId),
      text,
    };
  }

  const menuAction = resolveListMenuAction(body);
  if (menuAction) {
    return {
      type: "LIST_SELECTION",
      action: menuAction,
      text: body,
    };
  }

  if (body) {
    return {
      type: "TEXT",
      text: body,
    };
  }

  return {
    type: "UNKNOWN",
    text: "",
  };
}

module.exports = {
  parseIncomingMessage,
};
