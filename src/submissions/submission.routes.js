const path = require("path");
const express = require("express");
const env = require("../config/env");
const tenants = require("../config/tenants");
const { prisma, fromJson } = require("../db/prisma");
const flowCache = require("../flows/flow-cache");

const router = express.Router();

const agentInfo = (tenant, agentId) => {
  const agent = tenants.agentById(tenant, agentId);
  return { agentId, agentName: agent?.name || agentId, agentTeam: agent?.team || null };
};

router.get("/submissions", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const where = { tenantId: req.tenantId, ...(req.query.flowId ? { flowId: String(req.query.flowId) } : {}) };
  const [total, rows] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { flow: { select: { name: true } } },
    }),
  ]);
  res.json({
    page,
    pageSize,
    total,
    items: rows.map((s) => ({
      id: s.id,
      flowId: s.flowId,
      flowName: s.flow?.name || s.flowId,
      flowVersion: s.flowVersion,
      sessionId: s.sessionId,
      ...agentInfo(req.tenant, s.agentId),
      data: fromJson(s.data, {}),
      createdAt: s.createdAt,
    })),
  });
});

router.get("/sessions/active", async (req, res) => {
  const rows = await prisma.session.findMany({
    where: { tenantId: req.tenantId, OR: [{ status: "active" }, { lastError: { not: null }, updatedAt: { gt: new Date(Date.now() - 86400000) } }] },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const flows = await prisma.flow.findMany({ where: { tenantId: req.tenantId }, select: { id: true, name: true } });
  const flowName = new Map(flows.map((f) => [f.id, f.name]));

  const items = [];
  for (const row of rows) {
    const stack = fromJson(row.stack, []);
    const frames = [];
    for (const frame of stack) {
      const graph = await flowCache.compiled(frame.flowId, frame.version);
      const node = graph?.nodes?.[frame.nodeId];
      frames.push({ ...frame, flowName: flowName.get(frame.flowId) || frame.flowId, nodeLabel: node?.label || node?.type || frame.nodeId });
    }
    items.push({
      id: row.id,
      status: row.status,
      ...agentInfo(req.tenant, row.agentId),
      frames,
      vars: fromJson(row.vars, {}),
      lastError: row.lastError,
      expiresAt: row.expiresAt,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    });
  }
  res.json(items);
});

router.post("/sessions/:id/cancel", async (req, res) => {
  const { count } = await prisma.session.updateMany({ where: { id: req.params.id, tenantId: req.tenantId, status: "active" }, data: { status: "cancelled" } });
  res.status(count ? 200 : 404).json({ cancelled: count > 0 });
});

// Uploaded media (uploads/{tenantId}/{sessionId}/file). Tenants can only read their own folder.
router.get("/files/*filePath", (req, res) => {
  const relative = [].concat(req.params.filePath).join("/");
  const root = path.resolve(env.UPLOADS_DIR);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.join(root, req.tenantId) + path.sep)) return res.sendStatus(404);
  res.sendFile(absolute, { dotfiles: "deny" }, (error) => {
    if (error && !res.headersSent) res.sendStatus(404);
  });
});

module.exports = router;
