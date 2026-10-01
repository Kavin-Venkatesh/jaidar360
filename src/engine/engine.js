// Runtime engine: turns inbound WhatsApp events into flow steps for the tenant that owns the number.
const tenants = require("../config/tenants");
const { prisma, toJson, isUniqueViolation } = require("../db/prisma");
const { LIMITS, normalizeKeyword } = require("../../shared/flow-rules/index.mjs");
const flowCache = require("../flows/flow-cache");
const sender = require("../whatsapp/sender");
const sessions = require("./sessions");
const queue = require("./queue");
const renderers = require("./renderers");
const { executors } = require("./executors");
const locationLinks = require("../location-links/location-link.service");
const { logError, logInfo } = require("../utils/logger");

const MAX_STEPS_PER_RUN = 100;
const RESTART_ID = "__flow_restart";
const CONTINUE_ID = "__flow_continue";

const MESSAGES = {
  notRegistered: "Sorry, this number isn't registered. Please contact your admin.",
  noFlow: "Nothing is set up here yet. Please contact your admin.",
  menuClosed: "That menu has closed. Here's where we are:",
  tooManyAttempts: "Too many invalid answers, so I've stopped this conversation. Say *hi* to start again.",
  unavailable: "That option isn't available right now. Say *hi* to go back to the menu.",
  flowChanged: "This conversation can't continue because the flow was changed. Say *hi* to start again.",
  error: "Something went wrong on our side. Say *hi* to start again.",
  timeout: "Your session timed out. Say *hi* to start again.",
};

const top = (session) => session.stack[session.stack.length - 1] || null;
const attemptKey = (frame) => `${frame.flowId}@${frame.version}:${frame.nodeId}`;

async function nodeOf(frame) {
  const graph = await flowCache.compiled(frame.flowId, frame.version);
  return graph?.nodes?.[frame.nodeId] || null;
}

function buildContext(tenant, agent, session, to) {
  const ctx = {
    tenant,
    agent,
    session, // replaced when a new session starts
    to,
    get scope() {
      return {
        ...ctx.session.vars,
        agent: { name: agent.name, team: agent.team, phone: agent.phone },
        tenant: { name: tenant.name },
      };
    },
    saveMedia: (media) => sender.saveMedia(tenant, ctx.session.id, media),
    // Location Link nodes: a one-time browser link bound to this session and the node it waits on.
    createLocationLink: (node) =>
      locationLinks.createLink({ tenantId: tenant.id, sessionId: ctx.session.id, frame: top(ctx.session), minutes: node.linkMinutes || 10 }),
  };
  return ctx;
}

async function send(ctx, payload) {
  const id = await sender.send(ctx.tenant, ctx.to, payload, { sessionId: ctx.session?.id || null });
  if (ctx.session) ctx.session.lastOutboundMsgId = id;
  return id;
}

async function close(ctx, status, message) {
  if (message) await send(ctx, renderers.text(message));
  ctx.session.status = status;
  ctx.session.pending = null;
  await sessions.save(ctx.session);
}

// ---- Entry points -----------------------------------------------------------

// Called by the webhook for every parsed event. Returns false when the number isn't a flow-builder tenant,
// so the caller can hand the event to the legacy bot. Resolves after the event has been fully processed.
async function handleIncoming(event) {
  const tenant = tenants.byPhoneNumberId(event.phoneNumberId);
  if (!tenant) return false;

  if (event.type === "status") {
    await handleStatus(tenant, event);
    return true;
  }

  // Meta retries webhooks; the unique waMessageId makes a second delivery a no-op.
  try {
    await prisma.messageLog.create({
      data: { tenantId: tenant.id, direction: "in", waMessageId: event.waMessageId, type: event.kind, payload: toJson(event) },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      logInfo("FLOW_DUPLICATE_WEBHOOK", { waMessageId: event.waMessageId });
      return true;
    }
    throw error;
  }

  const key = `${tenant.id}:${event.from || event.fromUserId}`;
  await queue.run(key, () => processMessage(tenant, event)).catch((error) => logError("FLOW_EVENT_FAILED", error, { waMessageId: event.waMessageId }));
  return true;
}

async function handleStatus(tenant, event) {
  const error = event.errors.length ? event.errors.join("; ") : null;
  await prisma.messageLog.updateMany({ where: { tenantId: tenant.id, waMessageId: event.waMessageId }, data: { status: event.status, ...(error ? { error } : {}) } });
  if (event.status === "failed") {
    const log = await prisma.messageLog.findUnique({ where: { waMessageId: event.waMessageId }, select: { sessionId: true } });
    if (log?.sessionId) {
      await prisma.session.update({ where: { id: log.sessionId }, data: { lastError: `Delivery failed: ${error || "unknown error"}` } }).catch(() => {});
    }
  }
}

async function findAgent(tenant, event) {
  const byPhone = tenants.agentByPhone(tenant, event.from);
  if (byPhone) return byPhone;
  const agentId = await sessions.agentIdForUser(tenant.id, event.fromUserId);
  return tenants.agentById(tenant, agentId);
}

async function processMessage(tenant, event) {
  const agent = await findAgent(tenant, event);
  if (!agent) {
    if (event.from) await sender.text(tenant, event.from, MESSAGES.notRegistered);
    return;
  }

  const to = tenants.digits(event.from || agent.phone);
  const session = await sessions.active(tenant.id, agent.id);
  const ctx = buildContext(tenant, agent, session, to);

  try {
    await dispatch(ctx, event);
  } catch (error) {
    logError("FLOW_RUN_FAILED", error, { tenantId: tenant.id, agentId: agent.id, sessionId: ctx.session?.id });
    if (ctx.session) {
      ctx.session.lastError = error.message;
      await sessions.save(ctx.session).catch(() => {});
    }
  } finally {
    if (ctx.session) {
      await prisma.messageLog.update({ where: { waMessageId: event.waMessageId }, data: { sessionId: ctx.session.id } }).catch(() => {});
    }
  }
}

async function dispatch(ctx, event) {
  const { tenant, session } = ctx;
  if (session) {
    session.agentPhone = ctx.to;
    if (event.fromUserId) session.waUserId = event.fromUserId;
  }

  const flows = await flowCache.activeFlows(tenant.id);
  const keyword = event.kind === "text" ? normalizeKeyword(event.text) : "";
  const keywordFlow = keyword ? flows.find((f) => f.keywords.includes(keyword)) : null;

  // "Continue or restart?" answer.
  if (session?.pending?.type === "restart") {
    const pending = session.pending;
    session.pending = null;
    const choice = restartChoice(event);
    if (choice === "restart") {
      session.status = "cancelled";
      await sessions.save(session);
      const target = flows.find((f) => f.id === pending.flowId) || flows.find((f) => f.isEntry);
      return startFlow(ctx, event, target);
    }
    if (choice === "continue") {
      await resendCurrent(ctx);
      return sessions.save(session);
    }
    // Anything else: treat it as an answer to the current step.
  }

  if (!session) return startFlow(ctx, event, keywordFlow || flows.find((f) => f.isEntry));

  if (keywordFlow) {
    session.pending = { type: "restart", flowId: keywordFlow.id };
    await send(ctx, {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: `You're in the middle of a conversation. Start over with "${keywordFlow.name}"?` },
        action: {
          buttons: [
            { type: "reply", reply: { id: CONTINUE_ID, title: "Continue" } },
            { type: "reply", reply: { id: RESTART_ID, title: "Restart" } },
          ],
        },
      },
    });
    return sessions.save(session);
  }

  return applyInput(ctx, event);
}

// Feeds an answer to the node the session is waiting on, then runs until the next input is needed.
async function applyInput(ctx, event) {
  const { session } = ctx;
  const frame = top(session);
  const node = frame && frame.waiting === "input" ? await nodeOf(frame) : null;
  if (!node || !executors[node.type]?.receive) return close(ctx, "cancelled", MESSAGES.flowChanged);

  const result = await executors[node.type].receive(node, event, ctx);
  if (!result.ok) return handleInvalid(ctx, frame, node, result);

  if (node.saveAs) session.vars[node.saveAs] = result.value;
  delete session.attempts[attemptKey(frame)];
  frame.nodeId = node.next?.[result.handle || "default"] || null;
  frame.waiting = null;
  return run(ctx);
}

// Input that arrives outside WhatsApp (the Location Link browser page). `request` names the session and the exact
// node that issued the link; if the agent has since moved on, restarted or timed out, nothing happens.
async function resumeWithInput(request, event) {
  const inactive = { ok: false, message: "This link is no longer active. Continue in WhatsApp, or say hi to start again." };
  const tenant = tenants.byId(request.tenantId);
  const row = await prisma.session.findUnique({ where: { id: request.sessionId }, select: { agentId: true, agentPhone: true } });
  if (!tenant || !row) return inactive;

  // Same queue key as inbound WhatsApp messages, so a browser submit and a message can't interleave.
  return queue.run(`${tenant.id}:${row.agentPhone}`, async () => {
    const session = await sessions.active(tenant.id, row.agentId);
    const frame = session && top(session);
    const waitingHere =
      session?.id === request.sessionId &&
      frame?.waiting === "input" &&
      frame.flowId === request.flowId &&
      frame.version === request.version &&
      frame.nodeId === request.nodeId;
    const agent = tenants.agentById(tenant, row.agentId);
    if (!waitingHere || !agent) return inactive;

    const ctx = buildContext(tenant, agent, session, session.agentPhone);
    session.pending = null;
    try {
      await applyInput(ctx, event);
    } catch (error) {
      logError("FLOW_RESUME_FAILED", error, { sessionId: session.id });
      ctx.session.lastError = error.message;
      await sessions.save(ctx.session).catch(() => {});
    }
    return { ok: true };
  });
}

function restartChoice(event) {
  if (event.replyId === RESTART_ID) return "restart";
  if (event.replyId === CONTINUE_ID) return "continue";
  const text = String(event.text || "").trim().toLowerCase();
  if (["restart", "start over", "yes"].includes(text)) return "restart";
  if (["continue", "no"].includes(text)) return "continue";
  return null;
}

async function startFlow(ctx, event, flow) {
  if (!flow) {
    await send(ctx, renderers.text(MESSAGES.noFlow));
    return;
  }
  const graph = await flowCache.compiled(flow.id, flow.version);
  ctx.session = await sessions.start(ctx.tenant.id, ctx.agent, {
    agentPhone: ctx.to,
    waUserId: event.fromUserId || null,
    frame: { flowId: flow.id, version: flow.version, nodeId: graph?.start || null, waiting: null },
  });
  logInfo("FLOW_SESSION_STARTED", { tenantId: ctx.tenant.id, agentId: ctx.agent.id, flowId: flow.id, version: flow.version });
  return run(ctx);
}

async function resendCurrent(ctx) {
  const frame = top(ctx.session);
  const node = frame ? await nodeOf(frame) : null;
  if (!node) return;
  const step = await executors[node.type].enter(node, ctx);
  for (const payload of step.send || []) await send(ctx, payload);
}

async function handleInvalid(ctx, frame, node, result) {
  const { session } = ctx;
  if (result.stale) {
    await send(ctx, renderers.text(MESSAGES.menuClosed));
    await resendCurrent(ctx);
    return sessions.save(session);
  }

  const key = attemptKey(frame);
  session.attempts[key] = (session.attempts[key] || 0) + 1;
  const max = node.type === "question" ? node.maxAttempts || 3 : Infinity;
  if (session.attempts[key] >= max) return close(ctx, "cancelled", MESSAGES.tooManyAttempts);

  await send(ctx, renderers.text(result.message));
  if (result.resend) await resendCurrent(ctx);
  return sessions.save(session);
}

// Executes nodes until one needs input or the session ends.
async function run(ctx) {
  const { session } = ctx;
  for (let steps = 0; steps < MAX_STEPS_PER_RUN; steps++) {
    const frame = top(session);
    if (!frame) return close(ctx, "completed");

    // A missing next means the path just stops: treat it like an End without a message.
    if (!frame.nodeId) {
      if (await endFrame(ctx, { saveSubmission: true })) return;
      continue;
    }

    const node = await nodeOf(frame);
    if (!node) return close(ctx, "cancelled", MESSAGES.flowChanged);

    const step = await executors[node.type].enter(node, ctx);
    for (const payload of step.send || []) await send(ctx, payload);

    if (step.wait) {
      frame.waiting = "input";
      return sessions.save(session);
    }

    if (step.jump || step.call) {
      const target = await flowCache.activeFlow(ctx.tenant.id, step.jump || step.call);
      const graph = target && (await flowCache.compiled(target.id, target.version));
      if (!graph) return close(ctx, "cancelled", MESSAGES.unavailable);
      const childFrame = { flowId: target.id, version: target.version, nodeId: graph.start, waiting: null };
      if (step.jump) {
        session.stack[session.stack.length - 1] = childFrame;
      } else {
        if (session.stack.length > LIMITS.maxCallDepth) {
          session.lastError = "Call-and-return nesting limit reached";
          return close(ctx, "cancelled", MESSAGES.error);
        }
        frame.waiting = "child";
        session.stack.push(childFrame);
      }
      continue;
    }

    if (step.end) {
      if (await endFrame(ctx, node)) return;
      continue;
    }

    frame.nodeId = node.next?.[step.next || "default"] || null;
  }

  session.lastError = `Stopped after ${MAX_STEPS_PER_RUN} steps without waiting for input (loop in the flow?)`;
  return close(ctx, "cancelled", MESSAGES.error);
}

// Pops the finished flow. Returns true when the whole session is done.
async function endFrame(ctx, endNode) {
  const { session } = ctx;
  const finished = session.stack.pop();

  const parent = top(session);
  if (parent) {
    // Call-and-return: continue the parent after its Execute Flow node.
    const callNode = await nodeOf(parent);
    parent.nodeId = callNode?.next?.default || null;
    parent.waiting = null;
    return false;
  }

  if (endNode.saveSubmission !== false) {
    await prisma.submission.create({
      data: {
        tenantId: session.tenantId,
        agentId: session.agentId,
        flowId: finished.flowId,
        flowVersion: finished.version,
        sessionId: session.id,
        data: toJson(session.vars),
      },
    });
  }
  session.stack.push(finished); // keep the last position for debugging
  await close(ctx, "completed");
  logInfo("FLOW_SESSION_COMPLETED", { sessionId: session.id, flowId: finished.flowId });
  return true;
}

// Called every minute: idle sessions expire, with an optional notice (always inside the 24h window,
// because a session only lives FLOW_SESSION_IDLE_MINUTES after the agent's last message).
async function expireIdleSessions({ notify = true } = {}) {
  const rows = await prisma.session.findMany({ where: { status: "active", expiresAt: { lt: new Date() } } });
  for (const row of rows) {
    const tenant = tenants.byId(row.tenantId);
    await queue.run(`${row.tenantId}:${row.agentPhone}`, async () => {
      const { count } = await prisma.session.updateMany({ where: { id: row.id, status: "active", expiresAt: { lt: new Date() } }, data: { status: "expired" } });
      if (!count || !notify || !tenant || !row.agentPhone) return;
      await sender.text(tenant, row.agentPhone, MESSAGES.timeout, { sessionId: row.id }).catch((error) => logError("FLOW_TIMEOUT_NOTICE_FAILED", error, { sessionId: row.id }));
    });
  }
  return rows.length;
}

module.exports = { handleIncoming, resumeWithInput, expireIdleSessions, MESSAGES, RESTART_ID, CONTINUE_ID };
