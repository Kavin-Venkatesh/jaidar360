// Runtime scenarios (plan §12.2) against the seeded Acme / FreshMart flows, with a fake Cloud API transport.
const { setupFlowTestDb } = require("./support/flow-test-db");
const { dir } = setupFlowTestDb("engine");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { prisma, fromJson } = require("../src/db/prisma");
const sender = require("../src/whatsapp/sender");
const engine = require("../src/engine/engine");
const flows = require("../src/flows/flow.service");
const flowCache = require("../src/flows/flow-cache");
const { parseWebhook } = require("../src/webhook/parser");
const { main: seed } = require("../prisma/seed");

const outbox = [];
let outId = 0;
sender.setTransport({
  post: async (tenant, body) => {
    outbox.push({ tenantId: tenant.id, ...body });
    return { id: `wamid.out.${++outId}` };
  },
  downloadMedia: async () => ({ buffer: Buffer.from("fake-jpeg"), mimeType: "image/jpeg" }),
});

const RAVI = "919000000001";
const PRIYA = "919000000002";
const STRANGER = "919999999999";
let inId = 0;

function webhookBody(phoneNumberId, message) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: message.from, profile: { name: "Agent" } }], messages: [message] } }] }],
  };
}

async function deliver(phoneNumberId, from, content, id = `wamid.in.${++inId}`) {
  for (const event of parseWebhook(webhookBody(phoneNumberId, { id, from, timestamp: "1", ...content }))) {
    await engine.handleIncoming(event);
  }
  return id;
}

const acme = (from, content, id) => deliver("PNID_ACME", from, content, id);
const fresh = (from, content, id) => deliver("PNID_FRESH", from, content, id);
const text = (body) => ({ type: "text", text: { body } });
const button = (id, title = id) => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
const listReply = (id, title = id) => ({ type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } });
const location = (extra = {}) => ({ type: "location", location: { latitude: 13.08, longitude: 80.27, ...extra } });
const image = (id = "media-1") => ({ type: "image", image: { id, mime_type: "image/jpeg" } });

const drain = () => outbox.splice(0, outbox.length);
const bodyOf = (m) => m.text?.body || m.interactive?.body?.text || m.image?.caption || "";
const texts = (msgs) => msgs.map(bodyOf);

async function activeSession(tenantId, agentId) {
  return prisma.session.findFirst({ where: { tenantId, agentId, status: "active" } });
}

test.before(async () => {
  await seed();
});

test.beforeEach(async () => {
  drain();
  await prisma.session.updateMany({ where: { status: "active" }, data: { status: "cancelled" } });
});

test.after(async () => {
  await prisma.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("engine #1: Acme 'hi' shows Check in / New customer buttons from the Acme number", async () => {
  await acme(RAVI, text("hi"));
  const [menu] = drain();
  assert.equal(menu.tenantId, "tnt_acme");
  assert.equal(menu.to, RAVI);
  assert.equal(menu.interactive.type, "button");
  assert.equal(menu.interactive.body.text, "Hi Ravi Kumar 👋 What would you like to do?");
  assert.deepEqual(menu.interactive.action.buttons.map((b) => b.reply.title), ["Check in", "New customer"]);
});

test("engine #2-#4: new customer, phone validation, list, call-and-return into Check-in, submission", async () => {
  await acme(RAVI, text("hi"));
  drain();
  await acme(RAVI, button("opt_nc", "New customer"));
  assert.deepEqual(texts(drain()), ["What is the customer's name?"]);

  await acme(RAVI, text("Dr. Rao"));
  assert.deepEqual(texts(drain()), ["What is their contact number?"]);

  await acme(RAVI, text("12345"));
  assert.deepEqual(texts(drain()), ["Please send a valid 10-digit mobile number."]);

  await acme(RAVI, text("98123 45678"));
  const [list] = drain();
  assert.equal(list.interactive.type, "list");
  assert.equal(list.interactive.body.text, "What type of customer is Dr. Rao?");

  await acme(RAVI, listReply("opt_doc", "Doctor"));
  assert.deepEqual(texts(drain()), ["What is the doctor's speciality?"]);

  await acme(RAVI, text("Cardiology"));
  const [locationRequest] = drain();
  assert.equal(locationRequest.interactive.type, "location_request_message");

  const running = await activeSession("tnt_acme", "agt_ravi");
  const stack = fromJson(running.stack);
  assert.equal(stack.length, 2, "Check-in runs as a child frame");
  assert.equal(stack[0].waiting, "child");

  await acme(RAVI, location());
  assert.deepEqual(texts(drain()), ["🤳 Now send a selfie at the location."]);

  await acme(RAVI, image("selfie-1"));
  assert.deepEqual(texts(drain()), ["✅ Checked in. Thanks Ravi Kumar!", "🎉 Customer Dr. Rao created."]);

  const submission = await prisma.submission.findFirst({ where: { tenantId: "tnt_acme", sessionId: running.id }, include: { flow: true } });
  assert.equal(submission.flow.name, "New customer");
  const data = fromJson(submission.data);
  assert.equal(data.customer_phone, "+919812345678");
  assert.equal(data.customer_type, "Doctor");
  assert.equal(data.checkin_location.flagged, false);
  assert.equal(data.checkin_selfie.path, `tnt_acme/${running.id}/selfie-1.jpg`);
  assert.ok(fs.existsSync(path.join(process.env.UPLOADS_DIR, data.checkin_selfie.path)));
  assert.equal(await activeSession("tnt_acme", "agt_ravi"), null);
});

test("engine #5: tapping an old menu button says the menu has closed and re-sends the current question", async () => {
  await acme(RAVI, text("hi"));
  await acme(RAVI, button("opt_nc"));
  drain();
  await acme(RAVI, button("opt_ci", "Check in"));
  assert.deepEqual(texts(drain()), ["That menu has closed. Here's where we are:", "What is the customer's name?"]);
});

test("engine #6: 'hi' mid-flow asks continue or restart", async () => {
  await acme(RAVI, text("hi"));
  await acme(RAVI, button("opt_nc"));
  drain();

  await acme(RAVI, text("Hi"));
  const [prompt] = drain();
  assert.deepEqual(prompt.interactive.action.buttons.map((b) => b.reply.title), ["Continue", "Restart"]);

  await acme(RAVI, button(engine.CONTINUE_ID, "Continue"));
  assert.deepEqual(texts(drain()), ["What is the customer's name?"]);

  await acme(RAVI, text("menu"));
  drain();
  await acme(RAVI, button(engine.RESTART_ID, "Restart"));
  const [menu] = drain();
  assert.equal(menu.interactive.body.text, "Hi Ravi Kumar 👋 What would you like to do?");
});

test("engine: typed option title or number works as a fallback for buttons", async () => {
  await acme(PRIYA, text("hello"));
  drain();
  await acme(PRIYA, text("2"));
  assert.deepEqual(texts(drain()), ["What is the customer's name?"]);
  await acme(PRIYA, text("hi"));
  await acme(PRIYA, text("restart"));
  drain();
  await acme(PRIYA, text("check in"));
  assert.equal(drain()[0].interactive.type, "location_request_message");
  await acme(PRIYA, location({ name: "Apollo Clinic", address: "Anna Salai" }));
  drain();
  const session = await activeSession("tnt_acme", "agt_priya");
  assert.equal(fromJson(session.vars).checkin_location.flagged, true, "picked place is flagged, not trusted");
});

test("engine #7-#8: FreshMart list menu, store audit takes the shelf-photo path when nothing is out of stock", async () => {
  await fresh(RAVI, text("hi"));
  const [menu] = drain();
  assert.equal(menu.tenantId, "tnt_freshmart");
  assert.equal(menu.interactive.type, "list");
  assert.equal(menu.interactive.body.text, "Hi Arun M 👋 What would you like to do?");
  assert.equal(menu.interactive.action.sections[0].rows.length, 4);

  await fresh(RAVI, listReply("opt_audit", "Store audit"));
  assert.deepEqual(texts(drain()), ["Which store are you auditing?"]);
  await fresh(RAVI, text("T Nagar"));
  drain();
  await fresh(RAVI, text("abc"));
  assert.deepEqual(texts(drain()), ["Please reply with a number."]);
  await fresh(RAVI, text("0"));
  assert.deepEqual(texts(drain()), ["📷 Please send a photo of the shelf."]);
  await fresh(RAVI, text("here"));
  assert.deepEqual(texts(drain()), ["Please send a photo."]);
  await fresh(RAVI, image("shelf-1"));
  assert.deepEqual(texts(drain()), ["✅ Store audit for T Nagar saved."]);
});

test("engine #8b: store audit with out-of-stock items asks for the SKUs", async () => {
  await fresh(RAVI, text("hi"));
  await fresh(RAVI, listReply("opt_audit"));
  await fresh(RAVI, text("Adyar"));
  drain();
  await fresh(RAVI, text("3"));
  assert.deepEqual(texts(drain()), ["Which SKUs are out of stock? (comma separated)"]);
});

test("engine #9: the same phone registered in both tenants runs each tenant's flows independently", async () => {
  await acme(RAVI, text("hi"));
  await acme(RAVI, button("opt_nc"));
  await fresh(RAVI, text("hi"));
  const msgs = drain();
  assert.equal(msgs.at(-1).tenantId, "tnt_freshmart");
  assert.equal(msgs.at(-1).interactive.type, "list", "FreshMart starts fresh, no restart prompt");
  assert.ok(await activeSession("tnt_acme", "agt_ravi"));
  assert.ok(await activeSession("tnt_freshmart", "agt_arun"));
});

test("engine #10: an unregistered phone gets the not-registered reply", async () => {
  await acme(STRANGER, text("hi"));
  assert.deepEqual(texts(drain()), [engine.MESSAGES.notRegistered]);
});

test("engine #11: a webhook delivered twice is processed once", async () => {
  await acme(RAVI, text("hi"), "wamid.dup.1");
  await acme(RAVI, text("hi"), "wamid.dup.1");
  assert.equal(drain().length, 1);
});

test("engine #12: a running session finishes on its pinned version after a new publish", async () => {
  const [menuFlow] = await prisma.flow.findMany({ where: { tenantId: "tnt_acme", isEntry: true } });
  await acme(PRIYA, text("hi"));
  drain();

  const draft = fromJson(menuFlow.draftJson);
  draft.nodes.find((n) => n.type === "buttons").data.body = "Welcome back {{agent.name}}!";
  const saved = await flows.saveDraft("tnt_acme", menuFlow.id, { draft, revision: menuFlow.revision });
  const published = await flows.publish("tnt_acme", menuFlow.id, { revision: saved.revision, publishedBy: "test" });
  assert.equal(published.version, 2);

  await acme(PRIYA, button("opt_nc"));
  assert.deepEqual(texts(drain()), ["What is the customer's name?"], "old session continues on v1");

  await acme(RAVI, text("hi"));
  await acme(RAVI, text("restart"));
  assert.equal(bodyOf(drain().at(-1)), "Welcome back Ravi Kumar!", "new sessions use v2");
});

test("engine: question attempts are capped, then the session is cancelled", async () => {
  await acme(PRIYA, text("hi"));
  await acme(PRIYA, button("opt_nc"));
  await acme(PRIYA, text("Dr. Iyer"));
  drain();
  await acme(PRIYA, text("1"));
  await acme(PRIYA, text("2"));
  await acme(PRIYA, text("3"));
  const msgs = texts(drain());
  assert.equal(msgs.at(-1), engine.MESSAGES.tooManyAttempts);
  assert.equal(await activeSession("tnt_acme", "agt_priya"), null);
});

test("engine: jumping to a deactivated flow says the option is unavailable", async () => {
  const checkIn = await prisma.flow.findFirst({ where: { tenantId: "tnt_acme", name: "Check-in" } });
  await assert.rejects(flows.deactivate("tnt_acme", checkIn.id), (error) => error.status === 409 && error.body.callers.length === 2);
  await flows.deactivate("tnt_acme", checkIn.id, { force: true });
  try {
    await acme(PRIYA, text("hi"));
    drain();
    await acme(PRIYA, button("opt_ci"));
    assert.deepEqual(texts(drain()), [engine.MESSAGES.unavailable]);
  } finally {
    await flows.activateVersion("tnt_acme", checkIn.id);
  }
});

test("engine: idle sessions expire with a timeout notice; delivery failures show on the session", async () => {
  await acme(PRIYA, text("hi"));
  drain();
  const session = await activeSession("tnt_acme", "agt_priya");

  await engine.handleIncoming({ type: "status", phoneNumberId: "PNID_ACME", waMessageId: session.lastOutboundMsgId, status: "failed", errors: ["131047: Re-engagement message"] });
  const failed = await prisma.session.findUnique({ where: { id: session.id } });
  assert.match(failed.lastError, /131047/);

  await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await engine.expireIdleSessions();
  assert.equal((await prisma.session.findUnique({ where: { id: session.id } })).status, "expired");
  assert.deepEqual(texts(drain()), [engine.MESSAGES.timeout]);
});

test("engine: rollback makes new sessions use the older version", async () => {
  const menuFlow = await prisma.flow.findFirst({ where: { tenantId: "tnt_acme", isEntry: true } });
  await flows.activateVersion("tnt_acme", menuFlow.id, 1);
  flowCache.clear();
  await acme(PRIYA, text("hi"));
  assert.equal(bodyOf(drain()[0]), "Hi Priya S 👋 What would you like to do?");
});
