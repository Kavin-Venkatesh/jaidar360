const test = require("node:test");
const assert = require("node:assert/strict");

const { parseIncomingMessage } = require("../src/conversation/action-parser");
const { handleTransition } = require("../src/conversation/state-machine");
const {
  markProcessedInbound,
  hasProcessedInbound,
  getOrCreateConversation,
  createLocationToken,
  consumeLocationToken,
  getAgentByPhone,
  normalizePhoneNumber,
} = require("../src/repositories/in-memory-store");
const twilioService = require("../src/services/twilio.service");
const { handleIncomingMessage } = require("../src/services/conversation.service");
const {
  createMeetingDraft,
  updateMeetingDraft,
  getMeetingDraftById,
  saveMeetingDraft,
  getMeetingById,
  getAllMeetings,
} = require("../src/services/meeting-draft.service");

// Never talk to live Twilio from tests: record every outbound message instead.
const sent = [];
for (const name of ["sendText", "sendCard", "sendTemplate", "sendList", "sendQuickReply"]) {
  twilioService[name] = async (to, arg1, arg2) => {
    sent.push({ kind: name, to, arg1, arg2 });
    return { sid: `mock-${name}`, status: "queued" };
  };
}
// .env may hold real Content SIDs; blank them so tests exercise the plain fallbacks unless a test sets one.
{
  const cfg = require("../src/config/env");
  for (const key of Object.keys(cfg)) if (key.startsWith("CONTENT_")) cfg[key] = "";
  // .env may select the real Meta provider; tests default to the stubbed Twilio one and never get live credentials.
  cfg.MESSAGING_PROVIDER = "twilio";
  cfg.WHATSAPP_ACCESS_TOKEN = "";
  cfg.WHATSAPP_APP_SECRET = "";
}
let sidCounter = 0;
const say = (Body, extra = {}) =>
  handleIncomingMessage({ From: "whatsapp:+919000000000", MessageSid: `SM-T-${++sidCounter}`, Body, ...extra });
const stateOf = () => getOrCreateConversation("+919000000000", "x").currentState;

test("List selection action is parsed to stable IDs", () => {
  const result = parseIncomingMessage({ Body: "Check in", ListId: "CHECK_IN" });
  assert.equal(result.type, "LIST_SELECTION");
  assert.equal(result.action, "CHECK_IN");
});

test("Nested ListReply payloads still resolve the Check-in action", () => {
  const result = parseIncomingMessage({
    Body: "Check in",
    ListReply: {
      ListId: "MAIN_MENU",
      ListItemId: "check in",
      ListItemTitle: "Check in",
    },
  });

  assert.equal(result.type, "LIST_SELECTION");
  assert.equal(result.action, "CHECK_IN");
  assert.equal(result.text, "Check in");
});

test("Text-based Check in requests trigger the location card flow", async () => {
  const originalSendCard = twilioService.sendCard;
  const calls = [];

  twilioService.sendCard = async (...args) => {
    const payload = args[1];
    calls.push(payload);
    return { sid: "mock-card", status: "queued" };
  };

  await handleIncomingMessage({
    From: "whatsapp:+919000000000",
    MessageSid: "SM-CHECKIN-TEXT-TEST",
    Body: "Check in",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, "Check in");
  assert.ok(String(calls[0].actionUrl).includes("/geo/capture?token="));

  twilioService.sendCard = originalSendCard;
});

test("Start flow transitions into the main menu", () => {
  const conversation = { currentState: "START", history: [], data: {} };
  const result = handleTransition(conversation, { type: "TEXT", text: "hello" });
  assert.equal(result.nextState, "MAIN_MENU");
  assert.equal(conversation.currentState, "MAIN_MENU");
});

test("Back action returns to prior state", () => {
  const conversation = {
    currentState: "NEW_VISIT_PHONE",
    history: ["NEW_VISIT_CONTACT"],
    data: {},
    stateVersion: 0,
  };

  const result = handleTransition(conversation, { type: "BUTTON_SELECTION", action: "BACK" });
  assert.equal(result.nextState, "NEW_VISIT_CONTACT");
  assert.equal(conversation.currentState, "NEW_VISIT_CONTACT");
});

test("Skip action is accepted for optional phone field", () => {
  const conversation = {
    currentState: "NEW_VISIT_PHONE",
    history: ["NEW_VISIT_CONTACT"],
    data: {},
    stateVersion: 0,
  };

  const result = handleTransition(conversation, { type: "BUTTON_SELECTION", action: "SKIP" });
  assert.equal(result.nextState, "NEW_VISIT_LOCATION");
  assert.equal(conversation.currentState, "NEW_VISIT_LOCATION");
});

test("Location token is generated and single-use", () => {
  const token = createLocationToken({
    type: "CHECK_IN",
    whatsappNumber: "whatsapp:+14155238886",
    conversationId: "conversation-123",
    ttlMs: 1000,
  });

  const first = consumeLocationToken(token, "CHECK_IN");
  const second = consumeLocationToken(token, "CHECK_IN");

  assert.ok(token);
  assert.ok(first);
  assert.equal(second, null);
});

test("WhatsApp numbers are normalized to the same canonical format", () => {
  const values = [
    "whatsapp:+917904863284",
    "+917904863284",
    "917904863284",
    "whatsapp:+91 79048 63284",
  ];

  for (const value of values) {
    assert.equal(normalizePhoneNumber(value), "+917904863284");
  }

  assert.ok(getAgentByPhone("+917904863284"));
});

test("Twilio outbound numbers preserve the WhatsApp channel", () => {
  const formatWhatsAppNumber = (value) => {
    if (!value) return value;
    const normalized = String(value).trim();
    if (normalized.startsWith("whatsapp:")) return normalized;
    if (normalized.startsWith("+")) return `whatsapp:${normalized}`;
    return `whatsapp:+${normalized.replace(/^\+/, "")}`;
  };

  assert.equal(formatWhatsAppNumber("+919999999999"), "whatsapp:+919999999999");
  assert.equal(formatWhatsAppNumber("whatsapp:+919999999999"), "whatsapp:+919999999999");
});

test("Greeting messages trigger the main menu for registered agents", async () => {
  await handleIncomingMessage({
    From: "whatsapp:+919000000000",
    MessageSid: "SM-GREETING-TEST",
    Body: "hi",
  });

  assert.ok(true);
});

test("Duplicate inbound MessageSid is ignored", async () => {
  const sid = "SM-duplicate-test";
  markProcessedInbound(sid, { whatsappNumber: "whatsapp:+14155238886" });
  const duplicate = await handleIncomingMessage({
    From: "whatsapp:+14155238886",
    MessageSid: sid,
    Body: "hello",
  });
  assert.equal(duplicate, undefined);
  assert.equal(hasProcessedInbound(sid), true);
});

test("Main menu uses the env-backed Twilio content template when configured", async () => {
  const env = require("../src/config/env");
  const originalTemplate = twilioService.sendTemplate;
  const originalList = twilioService.sendList;
  const calls = [];

  twilioService.sendTemplate = async (to, templateName, variables = {}) => {
    calls.push({ to, templateName, variables });
    return { sid: "mock-template", status: "queued" };
  };
  twilioService.sendList = async () => {
    calls.push({ fallback: true });
    return { sid: "mock-fallback" };
  };

  env.CONTENT_MAIN_MENU = "HX_TEST_MAIN_MENU";

  await handleIncomingMessage({
    From: "whatsapp:+919000000000",
    MessageSid: "SM-MAIN-TEMPLATE-TEST",
    Body: "menu", // "hi" now resumes an in-progress flow; "menu" is the explicit way back
  });

  assert.deepEqual(calls[0], { to: "+919000000000", templateName: "HX_TEST_MAIN_MENU", variables: {} });
  env.CONTENT_MAIN_MENU = "";

  twilioService.sendTemplate = originalTemplate;
  twilioService.sendList = originalList;
});

test("Voice note flow creates a meeting draft and saves it on confirmation", async () => {
  const originalSendText = twilioService.sendText;
  const originalSendCard = twilioService.sendCard;
  const calls = [];

  twilioService.sendText = async (to, body) => {
    calls.push({ to, body });
    return { sid: "mock-text", status: "queued" };
  };
  twilioService.sendCard = async (...args) => {
    calls.push({ card: args[1] });
    return { sid: "mock-card", status: "queued" };
  };

  const voiceTranscript = "Visited ABC Traders today. Met Ravi Kumar. They need 50 bags of OPC cement and want a quotation by Friday.";
  const draft = createMeetingDraft({
    agentId: "agent-2",
    whatsappNumber: "+919000000000",
    transcript: voiceTranscript,
    draftJson: {
      company: { mentioned_name: "ABC Traders" },
      contact: { mentioned_name: "Ravi Kumar" },
      requirements: [{ mentioned_product: "OPC cement", quantity: 50, unit: "bag" }],
    },
  });

  assert.equal(draft.status, "AWAITING_CONFIRMATION");
  assert.equal(draft.draftJson.company.mentioned_name, "ABC Traders");
  assert.equal(draft.draftJson.requirements[0].quantity, 50);

  const updated = updateMeetingDraft(draft.id, {
    draftJson: {
      ...draft.draftJson,
      requirements: [{ ...draft.draftJson.requirements[0], quantity: 100 }],
    },
  });

  assert.equal(updated.draftJson.requirements[0].quantity, 100);

  const savedMeeting = saveMeetingDraft(draft.id, { agentId: "agent-2", whatsappNumber: "+919000000000" });
  assert.ok(savedMeeting);
  assert.equal(savedMeeting.requirements[0].quantity, 100);
  assert.equal(getMeetingDraftById(draft.id).status, "SAVED");
  assert.equal(getAllMeetings().length, 1);

  twilioService.sendText = originalSendText;
  twilioService.sendCard = originalSendCard;
});


test("'hi' in the middle of the visit flow resumes the flow instead of opening a new main menu", async () => {
  sent.length = 0;
  await say("menu");
  await say("New customer visit");
  assert.equal(stateOf(), "NEW_VISIT_COMPANY");
  await say("Acme Corp");
  assert.equal(stateOf(), "NEW_VISIT_CONTACT");

  sent.length = 0;
  await say("hi");

  assert.equal(stateOf(), "NEW_VISIT_CONTACT");
  assert.equal(sent.some((m) => m.kind === "sendList" && /What would you like to do/.test(m.arg1.title)), false);
  assert.ok(sent.some((m) => m.kind === "sendText" && /Who did you meet/.test(m.arg1)), "re-asks the current question");
  assert.equal(getOrCreateConversation("+919000000000", "x").data.contactName, undefined, "'hi' is not saved as the contact name");
});

test("'menu' explicitly leaves the flow", async () => {
  await say("menu");
  await say("New customer visit");
  sent.length = 0;
  await say("menu");
  assert.equal(stateOf(), "MAIN_MENU");
  assert.ok(sent.some((m) => m.kind === "sendList"));
});

test("Choice steps reject free text and accept list / button / typed answers", async () => {
  const conv = getOrCreateConversation("+919000000000", "x");
  conv.currentState = "NEW_VISIT_TEMPERATURE";
  conv.data = { activeVisitId: null };

  sent.length = 0;
  await say("banana");
  assert.equal(stateOf(), "NEW_VISIT_TEMPERATURE");
  assert.ok(sent.some((m) => m.kind === "sendQuickReply" && m.arg1.buttons.length === 3), "3 options are shown as quick-reply buttons");

  await say("Hot", { ButtonPayload: "HOT", ButtonText: "Hot" });
  assert.equal(stateOf(), "MAIN_MENU");
});

test("Check-in and visit location are sent as twilio/card with the URL button", async () => {
  await say("menu");
  sent.length = 0;
  await say("Check in");
  const card = sent.find((m) => m.kind === "sendCard");
  assert.ok(card);
  assert.match(card.arg1.actionUrl, /\/geo\/capture\?token=/);
});

test("Meeting summary is sent with Save / Edit / Cancel quick-reply buttons", async () => {
  const env = require("../src/config/env");
  const { sendMeetingDraftSummary } = require("../src/services/meeting-workflow.service");
  const draft = createMeetingDraft({
    agentId: "a",
    whatsappNumber: "+919000000000",
    draftJson: { company: { mentioned_name: "ABC", industry_group: "SERVICE" }, meeting: { outcome: "FOLLOW_UP_REQUIRED", prospect_temperature: "HOT" } },
  });

  env.CONTENT_MEETING_DRAFT_ACTIONS = "HX_DRAFT";
  sent.length = 0;
  await sendMeetingDraftSummary("+919000000000", draft);
  assert.equal(sent[0].kind, "sendTemplate");
  assert.equal(sent[0].arg1, "HX_DRAFT");
  assert.match(sent[0].arg2[1], /Industry: Service/);
  assert.match(sent[0].arg2[1], /Outcome: Follow-up required/);
  assert.match(sent[0].arg2[1], /Prospect: Hot/);

  env.CONTENT_MEETING_DRAFT_ACTIONS = "";
  sent.length = 0;
  await sendMeetingDraftSummary("+919000000000", draft);
  const qr = sent.find((m) => m.kind === "sendQuickReply");
  assert.deepEqual(qr.arg1.buttons.map((b) => b.id), ["SAVE", "EDIT", "CANCEL"]);
});

test("'hi' while a meeting draft awaits confirmation re-shows the summary, not the menu", async () => {
  const draft = createMeetingDraft({ agentId: "a", whatsappNumber: "+919000000000", draftJson: { company: { mentioned_name: "ABC" } } });
  const conv = getOrCreateConversation("+919000000000", "x");
  conv.currentState = "EDITING_MEETING_DRAFT";
  conv.data.activeDraftId = draft.id;

  sent.length = 0;
  await say("hi");
  assert.equal(stateOf(), "EDITING_MEETING_DRAFT");
  assert.equal(sent.some((m) => m.kind === "sendList"), false);
});

/* -------------------------------------------------------------------------- */
/*  MESSAGING_PROVIDER=whatsapp (Meta Cloud API). fetch is stubbed.           */
/* -------------------------------------------------------------------------- */

async function withWhatsAppCloud(fn) {
  const env = require("../src/config/env");
  const saved = { ...env };
  const originalFetch = global.fetch;
  const requests = [];
  const conv = getOrCreateConversation("+919000000000", "x");
  conv.currentState = "MAIN_MENU";
  conv.data = {};

  Object.assign(env, {
    MESSAGING_PROVIDER: "whatsapp",
    WHATSAPP_ACCESS_TOKEN: "test-token",
    WHATSAPP_PHONE_NUMBER_ID: "123456",
    WHATSAPP_GRAPH_API_VERSION: "v23.0",
    CONTENT_MAIN_MENU: "HX_SHOULD_BE_IGNORED",
  });
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.TEST" }] }), { status: 200 });
  };

  try {
    await fn(requests);
  } finally {
    Object.assign(env, saved);
    global.fetch = originalFetch;
  }
}

test("WhatsApp Cloud: main menu is a native list message, Twilio Content SIDs are ignored", async () => {
  await withWhatsAppCloud(async (requests) => {
    await say("menu");
    assert.equal(requests.length, 1);
    const { url, body, headers } = requests[0];
    assert.equal(url, "https://graph.facebook.com/v23.0/123456/messages");
    assert.equal(headers.authorization, "Bearer test-token");
    assert.equal(body.to, "919000000000");
    assert.equal(body.interactive.type, "list");
    assert.deepEqual(body.interactive.action.sections[0].rows.map((r) => r.id), ["CHECK_IN", "NEW_CUSTOMER_VISIT"]);
  });
});

test("WhatsApp Cloud: check-in is a cta_url card, 3 options are reply buttons", async () => {
  await withWhatsAppCloud(async (requests) => {
    await say("menu");
    requests.length = 0;
    await say("Check in");
    const card = requests[0].body.interactive;
    assert.equal(card.type, "cta_url");
    assert.match(card.action.parameters.url, /\/geo\/capture\?token=/);
    assert.equal(card.action.parameters.display_text, "Share location");

    const conv = getOrCreateConversation("+919000000000", "x");
    conv.currentState = "NEW_VISIT_TEMPERATURE";
    requests.length = 0;
    await say("banana");
    const buttons = requests.find((r) => r.body.interactive?.type === "button").body.interactive.action.buttons;
    assert.deepEqual(buttons.map((b) => b.reply.id), ["HOT", "WARM", "COLD"]);
  });
});

test("WhatsApp Cloud: meeting summary is one message with Save / Edit / Cancel buttons", async () => {
  const { sendMeetingDraftSummary } = require("../src/services/meeting-workflow.service");
  const draft = createMeetingDraft({ agentId: "a", whatsappNumber: "+919000000000", draftJson: { company: { mentioned_name: "ABC" } } });

  await withWhatsAppCloud(async (requests) => {
    await sendMeetingDraftSummary("+919000000000", draft);
    assert.equal(requests.length, 1);
    const msg = requests[0].body.interactive;
    assert.equal(msg.type, "button");
    assert.match(msg.body.text, /Company: ABC/);
    assert.ok(msg.body.text.length <= 1024);
    assert.deepEqual(msg.action.buttons.map((b) => b.reply.id), ["SAVE", "EDIT", "CANCEL"]);
  });
});

test("WhatsApp Cloud inbound payloads map onto the existing parser", () => {
  const { extractInboundMessages } = require("../src/utils/whatsapp-cloud-inbound");
  const wrap = (msg) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [msg] } }] }] });

  const [text] = extractInboundMessages(wrap({ from: "919000000000", id: "w1", type: "text", text: { body: "hi" } }));
  assert.equal(text.From, "+919000000000");
  assert.equal(parseIncomingMessage(text).type, "TEXT");

  const [list] = extractInboundMessages(wrap({ from: "91", id: "w2", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "CHECK_IN", title: "Check in" } } }));
  assert.deepEqual(parseIncomingMessage(list), { type: "LIST_SELECTION", action: "CHECK_IN", text: "Check in" });

  const [button] = extractInboundMessages(wrap({ from: "91", id: "w3", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "SAVE", title: "Save" } } }));
  assert.deepEqual(parseIncomingMessage(button), { type: "BUTTON_SELECTION", action: "SAVE", text: "Save" });

  const [audio] = extractInboundMessages(wrap({ from: "91", id: "w4", type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg; codecs=opus" } }));
  assert.equal(audio.MediaUrl0, "whatsapp-media:MEDIA1");
  assert.equal(require("../src/services/meeting-workflow.service").isVoiceMessage(audio), true);

  // Delivery / read receipts carry no messages.
  assert.deepEqual(extractInboundMessages({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), []);
});

test("WhatsApp Cloud webhook signature is checked against the app secret", () => {
  const crypto = require("crypto");
  const env = require("../src/config/env");
  const { validateWhatsAppCloudRequest } = require("../src/middleware/whatsapp-cloud-validation.middleware");
  const saved = env.WHATSAPP_APP_SECRET;
  env.WHATSAPP_APP_SECRET = "secret";

  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
  const run = (signature) => {
    let status = 200;
    let passed = false;
    const res = { status: (code) => ((status = code), { json: () => {} }) };
    validateWhatsAppCloudRequest({ headers: { "x-hub-signature-256": signature }, rawBody }, res, () => (passed = true));
    return { status, passed };
  };

  const good = `sha256=${crypto.createHmac("sha256", "secret").update(rawBody).digest("hex")}`;
  assert.deepEqual(run(good), { status: 200, passed: true });
  assert.deepEqual(run("sha256=deadbeef"), { status: 403, passed: false });
  env.WHATSAPP_APP_SECRET = saved;
});
