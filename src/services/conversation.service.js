const env = require("../config/env");
const { parseIncomingMessage } = require("../conversation/action-parser");
const { handleTransition } = require("../conversation/state-machine");
const messaging = require("./messaging.service");
const store = require("../repositories/in-memory-store");
const {
  getAgentByPhone,
  getOrCreateConversation,
  getConversationByPhone,
  updateConversation,
  createVisit,
  addAuditLog,
  hasProcessedInbound,
  markProcessedInbound,
  normalizePhoneNumber,
} = store;
const { VISIT_OPTIONS, matchOption, optionLabel } = require("../utils/visit-options");
const { createLocationTokenForType } = require("./location.service");
const {
  isVoiceMessage,
  processVoiceMeetingSubmission,
  handleMeetingDraftAction,
  resumeMeetingDraftPrompt,
} = require("./meeting-workflow.service");

function normalizePhone(from) {
  return normalizePhoneNumber(from);
}

function ensureMenuState(conversation) {
  console.log(`ensureMenuState: currentState=${conversation.currentState}`);
  if (!conversation.currentState || conversation.currentState === "START") {
    conversation.currentState = "MAIN_MENU";
  }
}


function normalizeActionValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function getActionText(action) {
  return action && action.text ? String(action.text).trim() : "";
}

const GREETINGS = ["hi", "hii", "hello", "hey", "start"];
const MENU_COMMANDS = ["menu", "main menu", "cancel"];

function textKey(action) {
  return action && action.type === "TEXT" ? getActionText(action).toLowerCase().replace(/[^a-z ]/g, "").trim() : "";
}

function isGreeting(action) {
  return GREETINGS.includes(textKey(action));
}

// Explicit "leave this flow" commands. A greeting is NOT one of these.
function isMenuCommand(action) {
  return MENU_COMMANDS.includes(textKey(action));
}

function isBackAction(action) {
  return normalizeActionValue(action && action.action) === "BACK" || getActionText(action).toLowerCase() === "back";
}

function isSkipAction(action) {
  return normalizeActionValue(action && action.action) === "SKIP" || getActionText(action).toLowerCase() === "skip";
}

async function sendMenu(to, conversation) {
  await messaging.sendContentOr(to, env.CONTENT_MAIN_MENU, {}, () =>
    messaging.sendList(to, {
      title: "What would you like to do?",
      items: [
        { id: "CHECK_IN", label: "Check in" },
        { id: "NEW_CUSTOMER_VISIT", label: "New customer visit" },
      ],
    }),
  );

  conversation.currentState = "MAIN_MENU";
  updateConversation(to, conversation);
}

function buildLocationUrl(token) {
  return `${env.PUBLIC_BASE_URL}/geo/capture?token=${encodeURIComponent(token)}`;
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

  await messaging.sendCard(from, {
    title: "Check in",
    body: "Share your current location to record your field visit.",
    ctaTitle: "Share location",
    actionUrl: buildLocationUrl(token),
    contentSid: env.CONTENT_CHECK_IN_LOCATION,
  });
}

const VISIT_FLOW = [
  {
    state: "NEW_VISIT_COMPANY",
    kind: "text",
    field: "companyName",
    templateEnv: "CONTENT_COMPANY_NAME",
    prompt: "What is the customer company name?",
  },
  {
    state: "NEW_VISIT_CONTACT",
    kind: "text",
    field: "contactName",
    templateEnv: "CONTENT_CONTACT_NAME",
    prompt: "Who did you meet? Type their name.",
  },
  {
    state: "NEW_VISIT_PHONE",
    kind: "phone",
    field: "contactMobile",
    templateEnv: "CONTENT_PHONE",
    prompt: "What is their mobile number?",
    buttons: [
      { id: "SKIP", title: "Skip" },
      { id: "BACK", title: "Back" },
    ],
  },
  {
    state: "NEW_VISIT_LOCATION",
    kind: "location",
    templateEnv: "CONTENT_VISIT_LOCATION",
  },
  {
    state: "NEW_VISIT_INDUSTRY_GROUP",
    kind: "choice",
    field: "industryGroup",
    templateEnv: "CONTENT_INDUSTRY_GROUP",
    prompt: "Which industry group is this customer in?",
  },
  {
    state: "NEW_VISIT_INDUSTRY",
    kind: "choice",
    field: "industry",
    templateEnv: "CONTENT_INDUSTRY",
    prompt: "Which industry?",
  },
  {
    state: "NEW_VISIT_DISCUSSION",
    kind: "choice",
    field: "discussion",
    templateEnv: "CONTENT_DISCUSSION",
    prompt: "What did you discuss?",
  },
  {
    state: "NEW_VISIT_OUTCOME",
    kind: "choice",
    field: "outcome",
    templateEnv: "CONTENT_MEETING_OUTCOME",
    prompt: "How did the meeting end?",
  },
  {
    state: "NEW_VISIT_TEMPERATURE",
    kind: "choice",
    field: "temperature",
    templateEnv: "CONTENT_PROSPECT_TEMPERATURE",
    prompt: "How warm is this prospect?",
  },
];

const VISIT_FIELDS = ["companyName", "contactName", "contactMobile", "industryGroup", "industry", "discussion", "outcome", "temperature"];

function getVisitStepIndex(state) {
  return VISIT_FLOW.findIndex((step) => step.state === state);
}

function isVisitState(state) {
  return getVisitStepIndex(state) !== -1;
}


async function sendVisitLocationPrompt(from, conversation) {
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

  await messaging.sendCard(from, {
    title: "Visit location",
    body: "Share your location to start the visit.",
    ctaTitle: "Share location",
    actionUrl: buildLocationUrl(token),
    contentSid: env.CONTENT_VISIT_LOCATION,
  });
}

async function sendChoicePrompt(from, step) {
  const options = VISIT_OPTIONS[step.field];
  const templateSid = env[step.templateEnv];

  if (options.length <= 3) {
    await messaging.sendContentOr(from, templateSid, {}, () =>
      messaging.sendQuickReply(from, {
        title: step.prompt,
        buttons: options.map((o) => ({ id: o.id, title: o.label })),
      }),
    );
    return;
  }

  await messaging.sendContentOr(from, templateSid, {}, () =>
    messaging.sendList(from, {
      title: step.prompt,
      items: options.map((o) => ({ id: o.id, label: o.label })),
    }),
  );
}

async function sendPhonePrompt(from, step) {
  await messaging.sendContentOr(from, env[step.templateEnv], {}, () =>
    messaging.sendQuickReply(from, {
      title: `${step.prompt} Type the number, or tap Skip.`,
      buttons: step.buttons,
    }),
  );
}

async function promptVisitStep(from, conversation, step) {
  conversation.currentState = step.state;
  updateConversation(from, conversation);

  if (step.kind === "location") {
    await sendVisitLocationPrompt(from, conversation);
    return;
  }

  if (step.kind === "choice") {
    await sendChoicePrompt(from, step);
    return;
  }

  if (step.kind === "phone") {
    await sendPhonePrompt(from, step);
    return;
  }

  await messaging.sendContentOr(from, env[step.templateEnv], {}, () => messaging.sendText(from, step.prompt));
}

async function startNewVisit(conversation, from) {
  const visit = createVisit({
    agentId: conversation.agentId,
    companyName: null,
    contactName: null,
    contactMobile: null,
    status: "DRAFT",
  });

  conversation.data = conversation.data || {};
  for (const field of VISIT_FIELDS) {
    delete conversation.data[field];
    delete conversation.data[`${field}Id`];
  }
  conversation.activeVisitId = visit.id;
  conversation.data.activeVisitId = visit.id;

  await promptVisitStep(from, conversation, VISIT_FLOW[0]);
}

/* -------------------------------------------------------------------------- */
/*  New customer visit: handling answers                                      */
/* -------------------------------------------------------------------------- */

async function advanceVisit(from, conversation, currentIndex) {
  const next = VISIT_FLOW[currentIndex + 1];
  if (next) {
    await promptVisitStep(from, conversation, next);
    return;
  }
  await finishVisit(from, conversation);
}

async function goBackInVisit(from, conversation) {
  const index = getVisitStepIndex(conversation.currentState);
  if (index <= 0) {
    await sendMenu(from, conversation);
    return;
  }

  let previous = index - 1;
  // Location is a one-off web step; going "back" from the industry question should land on the phone step.
  if (VISIT_FLOW[previous].kind === "location") previous -= 1;
  await promptVisitStep(from, conversation, VISIT_FLOW[previous]);
}

async function processVisitAnswer(conversation, from, action) {
  const index = getVisitStepIndex(conversation.currentState);
  const step = VISIT_FLOW[index];
  const text = getActionText(action);
  conversation.data = conversation.data || {};

  if (isBackAction(action)) {
    await goBackInVisit(from, conversation);
    return;
  }

  if (step.kind === "text") {
    if (!text) {
      await messaging.sendText(from, "Please type your answer.");
      return;
    }
    conversation.data[step.field] = text;
    updateConversation(from, conversation);
    await advanceVisit(from, conversation, index);
    return;
  }

  if (step.kind === "phone") {
    if (isSkipAction(action)) {
      conversation.data[step.field] = null;
      updateConversation(from, conversation);
      await advanceVisit(from, conversation, index);
      return;
    }

    const cleaned = text.replace(/[^\d+]/g, "").trim();
    if (!cleaned || cleaned.length < 8) {
      await messaging.sendText(from, "That doesn't look like a valid mobile number.");
      await sendPhonePrompt(from, step);
      return;
    }
    conversation.data[step.field] = cleaned;
    updateConversation(from, conversation);
    await advanceVisit(from, conversation, index);
    return;
  }

  if (step.kind === "location") {
    // Location is captured through the web link, not by chat. Re-send the link.
    await messaging.sendText(from, "Please open the link below and allow location access to continue.");
    await sendVisitLocationPrompt(from, conversation);
    return;
  }

  if (step.kind === "choice") {
    // Only accept a real option (list tap, button tap, or its label typed out). Anything else, e.g. "hi", is not an answer.
    const option = matchOption(step.field, action && action.action) || matchOption(step.field, text);
    if (!option) {
      await messaging.sendText(from, "Please choose one of the options below.");
      await sendChoicePrompt(from, step);
      return;
    }
    conversation.data[step.field] = option.label;
    conversation.data[`${step.field}Id`] = option.id;
    updateConversation(from, conversation);
    await advanceVisit(from, conversation, index);
  }
}

async function continueVisitAfterLocation(whatsappNumber) {
  const from = normalizePhone(whatsappNumber);
  const conversation = getConversationByPhone(from);
  if (!conversation) return false;

  conversation.data = conversation.data || {};
  conversation.data.pendingAction = null;

  const nextStep = VISIT_FLOW[getVisitStepIndex("NEW_VISIT_LOCATION") + 1];
  await promptVisitStep(from, conversation, nextStep);
  return true;
}

async function finishVisit(from, conversation) {
  const d = conversation.data || {};
  const visitId = d.activeVisitId || conversation.activeVisitId;

  const summary = {
    companyName: d.companyName || null,
    contactName: d.contactName || null,
    contactMobile: d.contactMobile || null,
    industryGroup: d.industryGroup || null,
    industry: d.industry || null,
    discussion: d.discussion || null,
    outcome: d.outcome || null,
    temperature: d.temperature || null,
  };

  // Persist on the visit record.
  try {
    const visitFields = {
      companyName: summary.companyName,
      contactName: summary.contactName,
      contactMobile: summary.contactMobile,
      industryGroup: summary.industryGroup,
      industry: summary.industry,
      discussion: summary.discussion,
      outcome: summary.outcome,
      prospectTemperature: summary.temperature,
      status: "COMPLETED",
      updatedAt: new Date().toISOString(),
    };

    if (visitId && typeof store.updateVisit === "function") {
      store.updateVisit(visitId, visitFields);
    } else if (visitId && typeof store.getVisitById === "function") {
      // location.service.js mutates the visit object in place, so do the same here.
      const visit = store.getVisitById(visitId);
      if (visit) Object.assign(visit, visitFields);
    }
  } catch (err) {
    console.error("Saving visit failed:", err.message);
  }

  await messaging.sendText(
    from,
    [
      "✅ Visit recorded",
      "",
      `🏢 Company: ${summary.companyName || "Not provided"}`,
      `👤 Contact: ${summary.contactName || "Not provided"}`,
      `📞 Mobile: ${summary.contactMobile || "Not provided"}`,
      `🏭 Industry: ${[summary.industryGroup, summary.industry].filter(Boolean).join(" / ") || "Not provided"}`,
      `💬 Discussion: ${summary.discussion || "Not provided"}`,
      `🏁 Outcome: ${summary.outcome || "Not provided"}`,
      `🌡️ Prospect: ${summary.temperature || "Not provided"}`,
    ].join("\n"),
  );

  clearVisitData(conversation);

  await sendMenu(from, conversation);
}


function resolveMenuActionFromText(text = "") {
  const normalized = String(text || "").trim().toLowerCase().replace(/[-_\s]+/g, " ");

  if (["check in", "checkin"].includes(normalized)) return "CHECK_IN";
  if (["new customer visit"].includes(normalized)) return "NEW_CUSTOMER_VISIT";

  return null;
}

function clearVisitData(conversation) {
  for (const field of VISIT_FIELDS) {
    delete conversation.data[field];
    delete conversation.data[`${field}Id`];
  }
  conversation.data.activeVisitId = null;
  conversation.activeVisitId = null;
}

// "hi" in the middle of a flow: keep the flow and repeat the current question.
async function resumeFlow(from, conversation) {
  await messaging.sendText(from, "👋 Welcome back! Let's continue where you left off.");

  if (conversation.currentState === "CHECK_IN") {
    await startCheckIn(conversation, from);
    return;
  }

  const step = VISIT_FLOW[getVisitStepIndex(conversation.currentState)];
  await promptVisitStep(from, conversation, step);
}

async function processKnownMessage(conversation, from, action) {
  const text = getActionText(action);

  const inFlow = isVisitState(conversation.currentState) || conversation.currentState === "CHECK_IN";

  if (inFlow && isGreeting(action)) {
    await resumeFlow(from, conversation);
    return;
  }

  if (inFlow && isMenuCommand(action)) {
    clearVisitData(conversation);
    await messaging.sendText(from, "Okay, cancelled. Back to the main menu.");
    await sendMenu(from, conversation);
    return;
  }

  // Inside the visit flow every message is an answer to the current question.
  if (isVisitState(conversation.currentState)) {
    await processVisitAnswer(conversation, from, action);
    return;
  }

  const textAction = resolveMenuActionFromText(text);
  const normalizedAction = normalizeActionValue(action && action.action);
  if (textAction === "CHECK_IN" || normalizedAction === "CHECK_IN") {
    await startCheckIn(conversation, from);
    return;
  }

  if (textAction === "NEW_CUSTOMER_VISIT" || normalizedAction === "NEW_CUSTOMER_VISIT") {
    await startNewVisit(conversation, from);
    return;
  }

  if (conversation.currentState === "MAIN_MENU") {
    if (action.type === "TEXT") {
      const normalizedText = text.toLowerCase();
      if (["hi", "hello", "hey", "start", "menu"].includes(normalizedText)) {
        await sendMenu(from, conversation);
        return;
      }
    }

    await messaging.sendText(from, "Please select one of the available options.");
    return;
  }

  if (conversation.currentState === "START") {
    ensureMenuState(conversation);
    await sendMenu(from, conversation);
    return;
  }

  if (action.type === "BUTTON_SELECTION" && action.action === "BACK") {
    const transition = handleTransition(conversation, action);
    if (transition && Array.isArray(transition.messages)) {
      for (const message of transition.messages) {
        if (message.type === "TEXT") await messaging.sendText(from, message.text);
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

  await messaging.sendText(from, "Please select one of the available options.");
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
    await messaging.sendText(from, "This number is not registered with JAIDAR.\nSomeone will call you back shortly.");
    return;
  }

  const conversation = getOrCreateConversation(from, agent.id);
  conversation.data = conversation.data || {};
  conversation.lastInboundMessageAt = new Date().toISOString();
  ensureMenuState(conversation);

  if (isVoiceMessage(message)) {
    const handled = await processVoiceMeetingSubmission({ conversation, from, message });
    if (handled) {
      addAuditLog("MEETING_VOICE_SUBMISSION", agent.id, "meeting_submission", conversation.id, {
        state: conversation.currentState,
      });
      return;
    }
  }

  if (conversation.currentState === "AWAITING_MEETING_DRAFT_CONFIRMATION" || conversation.currentState === "EDITING_MEETING_DRAFT") {
    if (isGreeting(action) && (await resumeMeetingDraftPrompt({ conversation, from }))) return;

    const handledDraftAction = await handleMeetingDraftAction({ conversation, from, action });
    if (handledDraftAction) {
      addAuditLog("MEETING_DRAFT_ACTION", agent.id, "meeting_draft", conversation.data?.activeDraftId || conversation.activeDraftId || conversation.id, {
        state: conversation.currentState,
        action: action && (action.action || action.text),
      });
      // Saved or cancelled: the draft flow is over, so offer the main menu again.
      if (conversation.currentState === "MAIN_MENU") await sendMenu(from, conversation);
      return;
    }
  }

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

async function continueAfterCheckIn(whatsappNumber) {
  const from = normalizePhone(whatsappNumber);
  const conversation = getConversationByPhone(from);
  if (!conversation) return false;
  await sendMenu(from, conversation);
  return true;
}

module.exports = {
  handleIncomingMessage,
  continueVisitAfterLocation,
  continueAfterCheckIn,
};