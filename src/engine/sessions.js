// Session persistence. A session holds a stack of frames (one per running flow) so Execute Flow can
// jump (replace the top frame) or call-and-return (push a frame, pop it at End).
//   frame = { flowId, version, nodeId, waiting: null | "input" | "child" }
const env = require("../config/env");
const { prisma, toJson, fromJson } = require("../db/prisma");

const idleMs = () => env.FLOW_SESSION_IDLE_MINUTES * 60 * 1000;

function hydrate(row) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId,
    agentPhone: row.agentPhone,
    waUserId: row.waUserId,
    status: row.status,
    stack: fromJson(row.stack, []),
    vars: fromJson(row.vars, {}),
    attempts: fromJson(row.attempts, {}),
    pending: fromJson(row.pending, null),
    lastOutboundMsgId: row.lastOutboundMsgId,
    lastError: row.lastError,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function active(tenantId, agentId) {
  const row = await prisma.session.findFirst({ where: { tenantId, agentId, status: "active" }, orderBy: { updatedAt: "desc" } });
  if (!row) return null;
  if (row.expiresAt < new Date()) {
    await prisma.session.update({ where: { id: row.id }, data: { status: "expired" } });
    return null;
  }
  return hydrate(row);
}

async function start(tenantId, agent, { agentPhone, waUserId, frame }) {
  // One live session per agent per tenant.
  await prisma.session.updateMany({ where: { tenantId, agentId: agent.id, status: "active" }, data: { status: "cancelled" } });
  const row = await prisma.session.create({
    data: {
      tenantId,
      agentId: agent.id,
      agentPhone,
      waUserId,
      status: "active",
      stack: toJson([frame]),
      vars: toJson({}),
      expiresAt: new Date(Date.now() + idleMs()),
    },
  });
  return hydrate(row);
}

async function save(session) {
  session.expiresAt = new Date(Date.now() + idleMs());
  await prisma.session.update({
    where: { id: session.id },
    data: {
      status: session.status,
      agentPhone: session.agentPhone,
      waUserId: session.waUserId,
      stack: toJson(session.stack),
      vars: toJson(session.vars),
      attempts: toJson(session.attempts),
      pending: session.pending ? toJson(session.pending) : null,
      lastOutboundMsgId: session.lastOutboundMsgId,
      lastError: session.lastError,
      expiresAt: session.expiresAt,
    },
  });
  return session;
}

async function agentIdForUser(tenantId, waUserId) {
  if (!waUserId) return null;
  const row = await prisma.session.findFirst({ where: { tenantId, waUserId }, orderBy: { updatedAt: "desc" }, select: { agentId: true } });
  return row?.agentId || null;
}

module.exports = { active, start, save, agentIdForUser, hydrate, idleMs };
