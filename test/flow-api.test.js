// Builder API (plan §12.1): auth, tenant isolation, optimistic save, validate/publish, versions, linking.
const { setupFlowTestDb } = require("./support/flow-test-db");
const { dir } = setupFlowTestDb("api");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const app = require("../src/app");
const { prisma } = require("../src/db/prisma");
const env = require("../src/config/env");
const sender = require("../src/whatsapp/sender");
const queue = require("../src/engine/queue");

let server;
let base;
const outbox = [];
sender.setTransport({ post: async (tenant, body) => (outbox.push({ tenantId: tenant.id, ...body }), { id: `wamid.${crypto.randomUUID()}` }) });

async function call(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function login(username, password) {
  const res = await call("POST", "/api/auth/login", { body: { username, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

let acme;
let fresh;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  acme = await login("acme_admin", "Acme@123");
  fresh = await login("fresh_admin", "Fresh@123");
});

test.after(async () => {
  server.close();
  await prisma.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

const trigger = (keywords) => ({ id: "n_trigger", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Start", keywords } });
const endNode = (id = "n_end", message = "Done") => ({ id, type: "end", position: { x: 600, y: 0 }, data: { message } });

async function createFlow(token, name, isEntry = false) {
  const res = await call("POST", "/api/flows", { token, body: { name, isEntry } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function save(token, flow, draft, extra = {}) {
  const res = await call("PUT", `/api/flows/${flow.id}`, { token, body: { draft, revision: flow.revision, ...extra } });
  if (res.status === 200) flow.revision = res.body.revision;
  return res;
}

test("api: login rejects bad passwords and returns the tenant for good ones", async () => {
  assert.equal((await call("POST", "/api/auth/login", { body: { username: "acme_admin", password: "nope" } })).status, 401);
  assert.equal((await call("GET", "/api/flows")).status, 401);
  const me = await call("GET", "/api/me", { token: acme });
  assert.equal(me.body.tenant.name, "Acme Pharma");
  assert.equal(me.body.tenant.whatsappNumber, "+919876543210");
});

test("api: tenants only see their own flows; other tenants' IDs return 404", async () => {
  const flow = await createFlow(acme, "Acme only", false);
  assert.equal(flow.draft.nodes[0].type, "trigger");
  const freshList = await call("GET", "/api/flows", { token: fresh });
  assert.ok(!freshList.body.some((f) => f.id === flow.id));
  assert.equal((await call("GET", `/api/flows/${flow.id}`, { token: fresh })).status, 404);
  assert.equal((await call("PUT", `/api/flows/${flow.id}`, { token: fresh, body: { draft: flow.draft, revision: flow.revision } })).status, 404);
  assert.equal((await call("POST", `/api/flows/${flow.id}/publish`, { token: fresh, body: {} })).status, 404);
  assert.equal((await call("DELETE", `/api/flows/${flow.id}`, { token: fresh })).status, 404);
});

test("api: a stale save from a second tab gets 409", async () => {
  const flow = await createFlow(acme, "Two tabs");
  const tabB = { ...flow };
  assert.equal((await save(acme, flow, flow.draft)).status, 200);
  const stale = await save(acme, tabB, flow.draft);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, flow.revision);
});

test("api: publish returns 422 with node problems, then succeeds, versions and activates", async () => {
  const flow = await createFlow(acme, "Main menu", true);
  const menu = {
    id: "n_menu",
    type: "buttons",
    position: { x: 300, y: 0 },
    data: { body: "Pick", buttons: [{ id: "opt_a", title: "A title that is too long" }, { id: "opt_b", title: "B" }] },
  };
  let draft = { nodes: [trigger(["hi"]), menu, endNode()], edges: [{ id: "e1", source: "n_trigger", target: "n_menu" }, { id: "e2", source: "n_menu", sourceHandle: "opt_a", target: "n_end" }] };
  await save(acme, flow, draft);

  const validate = await call("POST", `/api/flows/${flow.id}/validate`, { token: acme });
  assert.ok(validate.body.problems.some((p) => p.nodeId === "n_menu" && p.field === "option.opt_b"));

  const failed = await call("POST", `/api/flows/${flow.id}/publish`, { token: acme, body: { revision: flow.revision } });
  assert.equal(failed.status, 422);
  assert.ok(failed.body.problems.some((p) => p.nodeId === "n_menu" && /max 20/.test(p.message)));

  menu.data.buttons[0].title = "A";
  draft = { ...draft, edges: [...draft.edges, { id: "e3", source: "n_menu", sourceHandle: "opt_b", target: "n_end" }] };
  await save(acme, flow, draft);
  const ok = await call("POST", `/api/flows/${flow.id}/publish`, { token: acme, body: { revision: flow.revision } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.version, 1);

  const list = await call("GET", "/api/flows", { token: acme });
  const row = list.body.find((f) => f.id === flow.id);
  assert.equal(row.status, "active");
  assert.equal(row.hasUnpublishedChanges, false);

  // Only one entry flow per tenant.
  assert.equal((await call("POST", "/api/flows", { token: acme, body: { name: "Second entry", isEntry: true } })).status, 409);

  // Published flows can't be deleted.
  assert.equal((await call("DELETE", `/api/flows/${flow.id}`, { token: acme })).status, 409);

  // A second publish is v2; rollback re-activates v1.
  await save(acme, flow, draft);
  const v2 = await call("POST", `/api/flows/${flow.id}/publish`, { token: acme, body: { revision: flow.revision } });
  assert.equal(v2.body.version, 2);
  const versions = await call("GET", `/api/flows/${flow.id}/versions`, { token: acme });
  assert.deepEqual(versions.body.map((v) => v.version), [2, 1]);
  const rolled = await call("POST", `/api/flows/${flow.id}/rollback/1`, { token: acme });
  assert.equal(rolled.body.activeVersion, 1);
});

test("api: linkable flows are the tenant's active flows; call cycles are rejected at publish; deactivation warns callers", async () => {
  const child = await createFlow(acme, "Child");
  await save(acme, child, { nodes: [trigger([]), endNode()], edges: [{ id: "e1", source: "n_trigger", target: "n_end" }] });
  assert.equal((await call("POST", `/api/flows/${child.id}/publish`, { token: acme, body: {} })).status, 200);

  const parent = await createFlow(acme, "Parent");
  const callNode = (target) => ({ id: "n_call", type: "executeFlow", position: { x: 300, y: 0 }, data: { targetFlowId: target, mode: "call" } });
  await save(acme, parent, {
    nodes: [trigger([]), callNode(child.id), endNode()],
    edges: [{ id: "e1", source: "n_trigger", target: "n_call" }, { id: "e2", source: "n_call", target: "n_end" }],
  });
  assert.equal((await call("POST", `/api/flows/${parent.id}/publish`, { token: acme, body: {} })).status, 200);

  const linkable = await call("GET", "/api/flows/linkable", { token: acme });
  assert.ok(linkable.body.some((f) => f.id === child.id));
  const freshLinkable = await call("GET", "/api/flows/linkable", { token: fresh });
  assert.ok(!freshLinkable.body.some((f) => f.id === child.id), "other tenants never see these flows");

  // Child -> Parent -> Child is a call-and-return cycle.
  await save(acme, child, {
    nodes: [trigger([]), callNode(parent.id), endNode()],
    edges: [{ id: "e1", source: "n_trigger", target: "n_call" }, { id: "e2", source: "n_call", target: "n_end" }],
  });
  const cycle = await call("POST", `/api/flows/${child.id}/publish`, { token: acme, body: {} });
  assert.equal(cycle.status, 422);
  assert.ok(cycle.body.problems.some((p) => /cycle/.test(p.message)));

  // A FreshMart flow can't target an Acme flow.
  const foreign = await createFlow(fresh, "Foreign");
  await save(fresh, foreign, {
    nodes: [trigger([]), callNode(child.id), endNode()],
    edges: [{ id: "e1", source: "n_trigger", target: "n_call" }, { id: "e2", source: "n_call", target: "n_end" }],
  });
  const foreignPublish = await call("POST", `/api/flows/${foreign.id}/publish`, { token: fresh, body: {} });
  assert.equal(foreignPublish.status, 422);
  assert.ok(foreignPublish.body.problems.some((p) => /no longer exists/.test(p.message)));

  const warn = await call("POST", `/api/flows/${child.id}/deactivate`, { token: acme, body: {} });
  assert.equal(warn.status, 409);
  assert.deepEqual(warn.body.callers.map((c) => c.name), ["Parent"]);
  const forced = await call("POST", `/api/flows/${child.id}/deactivate`, { token: acme, body: { force: true } });
  assert.equal(forced.body.status, "inactive");

  // Published flows can't be deleted; never-published, unlinked drafts can.
  assert.equal((await call("DELETE", `/api/flows/${child.id}`, { token: acme })).status, 409);
  const orphan = await createFlow(acme, "Orphan");
  assert.equal((await call("DELETE", `/api/flows/${orphan.id}`, { token: acme })).status, 204);
});

test("api: duplicate copies the draft as a non-entry draft", async () => {
  const flow = await createFlow(acme, "Original");
  const copy = await call("POST", `/api/flows/${flow.id}/duplicate`, { token: acme });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.name, "Original (copy)");
  assert.equal(copy.body.status, "draft");
});

test("api: webhook routes tenant numbers to the flow engine and checks the signature", async () => {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "PNID_ACME" }, messages: [{ id: "wamid.api.1", from: "919000000002", type: "text", text: { body: "hi" } }] } }] }],
  });
  env.WHATSAPP_APP_SECRET = "shh";
  try {
    const bad = await call("POST", "/webhooks/whatsapp-cloud", { body, headers: { "x-hub-signature-256": "sha256=deadbeef" } });
    assert.equal(bad.status, 403);
    const sig = `sha256=${crypto.createHmac("sha256", "shh").update(body).digest("hex")}`;
    const ok = await call("POST", "/webhooks/whatsapp-cloud", { body, headers: { "x-hub-signature-256": sig } });
    assert.equal(ok.status, 200);
  } finally {
    env.WHATSAPP_APP_SECRET = "";
  }
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 50));
  await queue.idle();
  const log = await prisma.messageLog.findUnique({ where: { waMessageId: "wamid.api.1" } });
  assert.equal(log.tenantId, "tnt_acme");
  assert.ok(outbox.some((m) => m.to === "919000000002" && m.tenantId === "tnt_acme"));
});

test("api: submissions and media files are tenant-scoped", async () => {
  const flow = await prisma.flow.findFirst({ where: { tenantId: "tnt_acme" } });
  await prisma.submission.create({ data: { tenantId: "tnt_acme", agentId: "agt_ravi", flowId: flow.id, flowVersion: 1, sessionId: "s1", data: JSON.stringify({ customer_name: "Dr. Rao" }) } });
  const mine = await call("GET", "/api/submissions", { token: acme });
  assert.equal(mine.body.items[0].data.customer_name, "Dr. Rao");
  assert.equal(mine.body.items[0].agentName, "Ravi Kumar");
  const theirs = await call("GET", "/api/submissions", { token: fresh });
  assert.equal(theirs.body.total, 0);

  const file = path.join(process.env.UPLOADS_DIR, "tnt_acme", "s1", "photo.jpg");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "jpeg");
  assert.equal((await call("GET", `/api/files/tnt_acme/s1/photo.jpg?token=${acme}`)).status, 200);
  assert.equal((await call("GET", `/api/files/tnt_acme/s1/photo.jpg?token=${fresh}`)).status, 404);
  assert.equal((await call("GET", `/api/files/tnt_freshmart/..%2Ftnt_acme/s1/photo.jpg?token=${fresh}`)).status, 404);
});
