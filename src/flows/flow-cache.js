// In-memory caches the runtime engine reads on every message.
// Compiled versions are immutable, so they're cached forever; the per-tenant list of active flows
// (entry flow + trigger keywords) is dropped whenever a flow is published, (de)activated or rolled back.
const { prisma, fromJson } = require("../db/prisma");

const compiledCache = new Map(); // `${flowId}@${version}` -> compiled graph
const activeCache = new Map(); // tenantId -> [{ id, name, isEntry, version, keywords }]

async function compiled(flowId, version) {
  const key = `${flowId}@${version}`;
  if (compiledCache.has(key)) return compiledCache.get(key);
  const row = await prisma.flowVersion.findUnique({ where: { flowId_version: { flowId, version } } });
  if (!row) return null;
  const graph = fromJson(row.compiled, null);
  compiledCache.set(key, graph);
  return graph;
}

async function activeFlows(tenantId) {
  if (activeCache.has(tenantId)) return activeCache.get(tenantId);
  const flows = await prisma.flow.findMany({ where: { tenantId, status: "active", NOT: { activeVersion: null } } });
  const result = [];
  for (const flow of flows) {
    const graph = await compiled(flow.id, flow.activeVersion);
    if (!graph) continue;
    result.push({ id: flow.id, name: flow.name, isEntry: flow.isEntry, version: flow.activeVersion, keywords: graph.trigger?.keywords || [] });
  }
  activeCache.set(tenantId, result);
  return result;
}

async function activeFlow(tenantId, flowId) {
  return (await activeFlows(tenantId)).find((f) => f.id === flowId) || null;
}

function invalidateTenant(tenantId) {
  activeCache.delete(tenantId);
}

function clear() {
  compiledCache.clear();
  activeCache.clear();
}

module.exports = { compiled, activeFlows, activeFlow, invalidateTenant, clear };
