function parseIncomingMessage(message) {
  const body = (message.Body || "").trim();

  // WhatsApp List Picker - accept several possible payload shapes
  const listPayload = message.ListId || message.ListResponse || message.list_response || message.listId;
  if (listPayload) {
    let actionId = listPayload;
    let title = body;

    if (typeof listPayload === "string") {
      // Sometimes ListResponse may be a JSON string
      try {
        const parsed = JSON.parse(listPayload);
        actionId = parsed.id || parsed.listId || parsed.list_id || actionId;
        title = parsed.title || parsed.listTitle || title;
      } catch (e) {
        // not JSON, keep as-is
      }
    } else if (typeof listPayload === "object") {
      actionId = listPayload.id || listPayload.listId || listPayload.list_id || actionId;
      title = listPayload.title || listPayload.listTitle || title;
    }

    return {
      type: "LIST_SELECTION",
      action: actionId,
      text: title
    };
  }

  // Quick Reply / Button - accept multiple shapes
  const buttonPayload = message.ButtonPayload || message.ButtonResponse || message.button_response || message.buttonPayload;
  if (buttonPayload) {
    let actionId = buttonPayload;
    let text = message.ButtonText || body;

    if (typeof buttonPayload === "string") {
      try {
        const parsed = JSON.parse(buttonPayload);
        actionId = parsed.payload || parsed.id || actionId;
        text = parsed.text || text;
      } catch (e) {
        // keep as-is
      }
    } else if (typeof buttonPayload === "object") {
      actionId = buttonPayload.payload || buttonPayload.id || actionId;
      text = buttonPayload.text || text;
    }

    return {
      type: "BUTTON_SELECTION",
      action: actionId,
      text
    };
  }

  // Normal text
  if (body) {
    return {
      type: "TEXT",
      text: body
    };
  }

  return {
    type: "UNKNOWN"
  };
}

module.exports = {
  parseIncomingMessage
};