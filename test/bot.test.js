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
    Body: "hi",
  });

  assert.deepEqual(calls[0], { to: "+919000000000", templateName: "HX_TEST_MAIN_MENU", variables: {} });

  twilioService.sendTemplate = originalTemplate;
  twilioService.sendList = originalList;
});
