const env = require("../config/env");
const { parseIncomingMessage } = require("../conversation/action-parser");
const { handleTransition } = require("../conversation/state-machine");
const twilioService = require("./twilio.service");
const {
  getAgentByPhone,
  getOrCreateConversation,
  updateConversation,
  createVisit,
  countPendingFollowUps,
  addAuditLog,
  hasProcessedInbound,
  markProcessedInbound,
  normalizePhoneNumber,
} = require("../repositories/in-memory-store");
const { createLocationTokenForType } = require("./location.service");

function normalizePhone(from) {
  return normalizePhoneNumber(from);
}

function ensureMenuState(conversation) {

  console.log(`ensureMenuState: currentState=${conversation.currentState}`);
  if (!conversation.currentState || conversation.currentState === "START") {
    conversation.currentState = "MAIN_MENU";
  }
}

async function sendPromptTemplate(to, templateSid, fallbackText, variables = {}) {
  if (templateSid) {
    await twilioService.sendTemplate(to, templateSid, variables);
    return;
  }

  await twilioService.sendText(to, fallbackText);
}

async function sendMenu(to, conversation) {
  if (env.CONTENT_MAIN_MENU) {
    await twilioService.sendTemplate(to, env.CONTENT_MAIN_MENU, {});
  } else {
    await twilioService.sendList(to, {
      title: "What would you like to do?",
      button: "Choose",
      items: [
        { id: "CHECK_IN", label: "Check in" },
        { id: "NEW_CUSTOMER_VISIT", label: "New customer visit" },
      ],
    });
  }

  conversation.currentState = "MAIN_MENU";
  updateConversation(to, conversation);
}

async function startCheckIn(conversation, from) {
  const token = createLocationTokenForType({
    type: "CHECK_IN",
    whatsappNumber: from,
    conversationId: conversation.id,
  });

  conversation.currentState = "CHECK_IN";
  conversation.data.locationToken = token;
  conversation.data.pendingAction = "CHECK_IN";
  updateConversation(from, conversation);

  const locationUrl =
    `${env.PUBLIC_BASE_URL}/geo/capture?token=${encodeURIComponent(token)}`;

  await twilioService.sendText(
    from,
    [
      "📍 Check in",
      "",
      "Please open the link below to share your current location:",
      locationUrl,
    ].join("\n"),
  );
}

async function startNewVisit(conversation, from) {
  const visit = createVisit({
    agentId: conversation.agentId,
    companyName: null,
    contactName: null,
    contactMobile: null,
    status: "DRAFT",
  });

  conversation.currentState = "NEW_VISIT_COMPANY";
  conversation.activeVisitId = visit.id;
  conversation.data.activeVisitId = visit.id;
  updateConversation(from, conversation);

  await sendPromptTemplate(from, env.CONTENT_COMPANY_NAME, "What is the customer company name?");
}

async function processCompanyAnswer(conversation, from, text) {
  conversation.data.companyName = text.trim();
  conversation.currentState = "NEW_VISIT_CONTACT";
  updateConversation(from, conversation);
  await sendPromptTemplate(from, env.CONTENT_CONTACT_NAME, "Who did you meet? Type their name.");
}

async function processContactAnswer(conversation, from, text) {
  conversation.data.contactName = text.trim();
  conversation.currentState = "NEW_VISIT_PHONE";
  updateConversation(from, conversation);
  await sendPromptTemplate(from, env.CONTENT_PHONE, "What is their mobile number?");
}

async function processPhoneAnswer(conversation, from, text, action) {
  if (action === "SKIP") {
    conversation.data.contactMobile = null;
    conversation.currentState = "NEW_VISIT_LOCATION";
    updateConversation(from, conversation);
    await sendLocationCardForVisit(from, conversation);
    return;
  }

  const cleaned = String(text || "").replace(/[^\d+]/g, "").trim();
  if (!cleaned || cleaned.length < 8) {
    await twilioService.sendText(from, "Please provide a valid mobile number or choose Skip.");
    return;
  }

  conversation.data.contactMobile = cleaned;
  conversation.currentState = "NEW_VISIT_LOCATION";
  updateConversation(from, conversation);
  await sendLocationCardForVisit(from, conversation);
}

async function sendLocationCardForVisit(from, conversation) {
  const visitId = conversation.data.activeVisitId || conversation.activeVisitId;
  const token = createLocationTokenForType({
    type: "VISIT_LOCATION",
    whatsappNumber: from,
    conversationId: conversation.id,
    visitId,
  });

  conversation.data.visitLocationToken = token;
  conversation.data.pendingAction = "VISIT_LOCATION";
  updateConversation(from, conversation);

  const locationUrl =
    `${env.PUBLIC_BASE_URL}/geo/capture?token=${encodeURIComponent(token)}`;

  await twilioService.sendText(
    from,
    [
      "📍 Visit location",
      "",
      "Please open the link below to share your location:",
      locationUrl,
    ].join("\n"),
  );
}

function normalizeActionValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function resolveMenuActionFromText(text = "") {
  const normalized = String(text || "").trim().toLowerCase().replace(/[-_\s]+/g, " ");

  if (["check in", "checkin"].includes(normalized)) return "CHECK_IN";
  if (["new customer visit"].includes(normalized)) return "NEW_CUSTOMER_VISIT";

  return null;
}

async function processKnownMessage(conversation, from, action) {
  const text = action && action.text ? String(action.text).trim() : "";

  if (conversation.currentState === "MAIN_MENU") {
    if (action.type === "TEXT") {
      const normalizedText = text.toLowerCase();
      if (["hi", "hello", "hey", "start", "menu"].includes(normalizedText)) {
        await sendMenu(from, conversation);
        return;
      }

      const textAction = resolveMenuActionFromText(text);
      if (textAction === "CHECK_IN") {
        await startCheckIn(conversation, from);
        return;
      }
      if (textAction === "NEW_CUSTOMER_VISIT") {
        await startNewVisit(conversation, from);
        return;
      }
    }

    const normalizedAction = normalizeActionValue(action && action.action);
    if (action.type === "LIST_SELECTION" && normalizedAction === "CHECK_IN") {
      await startCheckIn(conversation, from);
      return;
    }

    if (action.type === "LIST_SELECTION" && normalizedAction === "NEW_CUSTOMER_VISIT") {
      await startNewVisit(conversation, from);
      return;
    }

    await twilioService.sendText(from, "Please select one of the available options.");
    return;
  }

  if (conversation.currentState === "START") {
    ensureMenuState(conversation);
    await sendMenu(from, conversation);
    return;
  }

  if (conversation.currentState === "NEW_VISIT_COMPANY") {
    await processCompanyAnswer(conversation, from, text);
    return;
  }

  if (conversation.currentState === "NEW_VISIT_CONTACT") {
    await processContactAnswer(conversation, from, text);
    return;
  }

  if (conversation.currentState === "NEW_VISIT_PHONE") {
    await processPhoneAnswer(conversation, from, text, action.action || "");
    return;
  }

  if (action.type === "BUTTON_SELECTION" && action.action === "BACK") {
    const transition = handleTransition(conversation, action);
    if (transition && Array.isArray(transition.messages)) {
      for (const message of transition.messages) {
        if (message.type === "TEXT") await twilioService.sendText(from, message.text);
      }
    }
    return;
  }

  if (action.type === "TEXT") {
    const normalizedText = text.toLowerCase();
    if (["hi", "hello", "hey", "start", "menu"].includes(normalizedText)) {
      await sendMenu(from, conversation);
      return;
    }
  }

  await twilioService.sendText(from, "Please select one of the available options.");
}

async function handleIncomingMessage(message) {
  const from = normalizePhone(message.From || message.from || "");
  const messageSid = String(message.MessageSid || message.messageSid || `local-${Date.now()}`);

  if (!from) {
    return;
  }

  if (hasProcessedInbound(messageSid)) {
    return;
  }

  markProcessedInbound(messageSid, {
    whatsappNumber: from,
    receivedAt: new Date().toISOString(),
  });

  const action = parseIncomingMessage(message);
  const agent = getAgentByPhone(from);

  if (!agent) {
    await twilioService.sendText(from, "This number is not registered with JAIDAR.\nSomeone will call you back shortly.");
    return;
  }

  const conversation = getOrCreateConversation(from, agent.id);
  conversation.lastInboundMessageAt = new Date().toISOString();
  ensureMenuState(conversation);

  if (conversation.currentState === "START") {
    await sendMenu(from, conversation);
    return;
  }

  await processKnownMessage(conversation, from, action);

  addAuditLog("CONVERSATION_MESSAGE", agent.id, "conversation", conversation.id, {
    state: conversation.currentState,
    action: action.action || action.type,
  });
}

module.exports = {
  handleIncomingMessage,
};
