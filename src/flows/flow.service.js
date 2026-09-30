const { prisma, toJson, fromJson } = require("../db/prisma");
const { validateFlow, compileFlow, hasErrors } = require("../../shared/flow-rules/index.mjs");
const flowCache = require("./flow-cache");

class HttpError extends Error {
  constructor(status, message, body = {}) {
    super(message);
    this.status = status;
    this.body = { message, ...body };
  }
}

const DEFAULT_ENTRY_KEYWORDS = ["hi", "hello", "menu"];

function starterCanvas(isEntry) {
  return {
    nodes: [
      {
        id: "n_trigger",
        type: "trigger",
        position: { x: 0, y: 120 },
        data: { label: "Start", keywords: isEntry ? DEFAULT_ENTRY_KEYWORDS : [] },
      },
    ],
    edges: [],
    viewport: { x: 80, y: 80, zoom: 1 },
  };
}

function summary(flow) {
  return {
    id: flow.id,
    name: flow.name,
    isEntry: flow.isEntry,
    status: flow.status,
    activeVersion: flow.activeVersion,
    revision: flow.revision,
    publishedRevision: flow.publishedRevision,
    hasUnpublishedChanges: flow.activeVersion !== null && flow.revision !== flow.publishedRevision,
    updatedAt: flow.updatedAt,
    createdAt: flow.createdAt,
  };
}

function detail(flow) {
  return { ...summary(flow), draft: fromJson(flow.draftJson, starterCanvas(flow.isEntry)) };
}

async function findOwned(tenantId, id) {
  const flow = await prisma.flow.findFirst({ where: { id, tenantId } });
  if (!flow) throw new HttpError(404, "Flow not found");
  return flow;
}

async function assertSingleEntry(tenantId, flowId) {
  const other = await prisma.flow.findFirst({ where: { tenantId, isEntry: true, NOT: flowId ? { id: flowId } : undefined } });
  if (other) throw new HttpError(409, `"${other.name}" is already the entry flow. Unset it first.`);
}

async function list(tenantId) {
  const flows = await prisma.flow.findMany({ where: { tenantId }, orderBy: [{ isEntry: "desc" }, { updatedAt: "desc" }] });
  return flows.map(summary);
}

async function get(tenantId, id) {
  return detail(await findOwned(tenantId, id));
}

async function create(tenantId, { name, isEntry = false, draft }) {
  if (isEntry) await assertSingleEntry(tenantId, null);
  const flow = await prisma.flow.create({
    data: { tenantId, name, isEntry, draftJson: toJson(draft || starterCanvas(isEntry)) },
  });
  return detail(flow);
}

async function saveDraft(tenantId, id, { draft, revision, name, isEntry }) {
  const flow = await findOwned(tenantId, id);
  if (isEntry === true && !flow.isEntry) await assertSingleEntry(tenantId, id);

  const result = await prisma.flow.updateMany({
    where: { id, tenantId, revision },
    data: {
      draftJson: toJson(draft),
      revision: { increment: 1 },
      ...(name !== undefined ? { name } : {}),
      ...(isEntry !== undefined ? { isEntry } : {}),
    },
  });
  if (result.count === 0) {
    const current = await findOwned(tenantId, id);
    throw new HttpError(409, "This flow was changed somewhere else (another tab?). Reload to get the latest version.", {
      revision: current.revision,
    });
  }
  return summary(await findOwned(tenantId, id));
}

// Everything validateFlow needs to know about the tenant's other flows, from their *active* compiled versions.
async function buildContext(tenantId, flowId, isEntry) {
  const flows = await prisma.flow.findMany({ where: { tenantId } });
  const activeVersions = flows.filter((f) => f.activeVersion !== null);
  const versions = activeVersions.length
    ? await prisma.flowVersion.findMany({
        where: { OR: activeVersions.map((f) => ({ flowId: f.id, version: f.activeVersion })) },
        select: { flowId: true, compiled: true },
      })
    : [];
  const compiledByFlow = new Map(versions.map((v) => [v.flowId, fromJson(v.compiled, {})]));

  return {
    flowId,
    isEntry,
    tenantFlows: flows.map((f) => {
      const compiled = compiledByFlow.get(f.id) || {};
      return {
        id: f.id,
        name: f.name,
        isEntry: f.isEntry,
        status: f.status,
        activeVersion: f.activeVersion,
        keywords: compiled.trigger?.keywords || [],
        calls: compiled.calls || [],
        jumps: compiled.jumps || [],
        saves: compiled.saves || [],
      };
    }),
  };
}

async function context(tenantId, id) {
  const flow = await findOwned(tenantId, id);
  return buildContext(tenantId, id, flow.isEntry);
}

async function validate(tenantId, id) {
  const flow = await findOwned(tenantId, id);
  const ctx = await buildContext(tenantId, id, flow.isEntry);
  return validateFlow(fromJson(flow.draftJson, {}), ctx);
}

async function publish(tenantId, id, { revision, publishedBy }) {
  const flow = await findOwned(tenantId, id);
  if (revision !== undefined && revision !== flow.revision) {
    throw new HttpError(409, "Save your latest changes before publishing (the draft is out of date).", { revision: flow.revision });
  }

  const canvas = fromJson(flow.draftJson, {});
  const ctx = await buildContext(tenantId, id, flow.isEntry);
  const problems = validateFlow(canvas, ctx);
  if (hasErrors(problems)) throw new HttpError(422, "Fix the problems before publishing.", { problems });

  const result = await prisma.$transaction(async (tx) => {
    const last = await tx.flowVersion.findFirst({ where: { flowId: id }, orderBy: { version: "desc" } });
    const version = (last?.version || 0) + 1;
    const compiled = compileFlow(canvas, { flowId: id, version, isEntry: flow.isEntry });
    const created = await tx.flowVersion.create({
      data: { flowId: id, version, compiled: toJson(compiled), canvas: flow.draftJson, publishedBy },
    });
    await tx.flow.update({
      where: { id },
      data: { activeVersion: version, status: "active", publishedRevision: flow.revision },
    });
    return { version, publishedAt: created.publishedAt };
  });

  flowCache.invalidateTenant(tenantId);
  return { ...result, problems };
}

// Active flows whose active version jumps to or calls this flow.
async function callers(tenantId, id) {
  const ctx = await buildContext(tenantId, id, false);
  return ctx.tenantFlows
    .filter((f) => f.id !== id && f.status === "active" && (f.calls.includes(id) || f.jumps.includes(id)))
    .map((f) => ({ id: f.id, name: f.name }));
}

async function deactivate(tenantId, id, { force = false } = {}) {
  const flow = await findOwned(tenantId, id);
  if (flow.status !== "active") return summary(flow);
  const linked = await callers(tenantId, id);
  if (linked.length && !force) {
    throw new HttpError(409, "Other active flows link to this flow. Agents will see \"not available\" there.", { callers: linked });
  }
  const updated = await prisma.flow.update({ where: { id }, data: { status: "inactive" } });
  flowCache.invalidateTenant(tenantId);
  return { ...summary(updated), callers: linked };
}

// Makes `version` the active one (re-activation or rollback), after re-checking links and keywords.
async function activateVersion(tenantId, id, version) {
  const flow = await findOwned(tenantId, id);
  const target = version ?? flow.activeVersion;
  if (!target) throw new HttpError(400, "Publish this flow first.");
  const row = await prisma.flowVersion.findUnique({ where: { flowId_version: { flowId: id, version: target } } });
  if (!row) throw new HttpError(404, `Version ${target} not found`);

  const ctx = await buildContext(tenantId, id, flow.isEntry);
  const problems = validateFlow(fromJson(row.canvas, {}), ctx);
  if (hasErrors(problems)) throw new HttpError(422, `Version ${target} can't be activated as-is.`, { problems });

  const updated = await prisma.flow.update({ where: { id }, data: { activeVersion: target, status: "active" } });
  flowCache.invalidateTenant(tenantId);
  return summary(updated);
}

async function versions(tenantId, id) {
  await findOwned(tenantId, id);
  const rows = await prisma.flowVersion.findMany({
    where: { flowId: id },
    orderBy: { version: "desc" },
    select: { version: true, publishedAt: true, publishedBy: true },
  });
  return rows;
}

async function duplicate(tenantId, id) {
  const flow = await findOwned(tenantId, id);
  const copy = await prisma.flow.create({
    data: { tenantId, name: `${flow.name} (copy)`, isEntry: false, draftJson: flow.draftJson },
  });
  return detail(copy);
}

async function remove(tenantId, id) {
  const flow = await findOwned(tenantId, id);
  if (flow.activeVersion !== null) throw new HttpError(409, "Published flows can't be deleted. Deactivate it instead.");
  const others = await prisma.flow.findMany({ where: { tenantId, NOT: { id } }, select: { name: true, draftJson: true } });
  const linkedFrom = others.filter((f) => f.draftJson.includes(`"${id}"`)).map((f) => f.name);
  if (linkedFrom.length) throw new HttpError(409, `Used by Execute Flow nodes in: ${linkedFrom.join(", ")}.`);
  await prisma.flow.delete({ where: { id } });
  flowCache.invalidateTenant(tenantId);
}

// Published & active flows, for the Execute Flow target dropdown.
async function linkable(tenantId) {
  const flows = await prisma.flow.findMany({ where: { tenantId, status: "active" }, orderBy: { name: "asc" } });
  return flows.map((f) => ({ id: f.id, name: f.name, isEntry: f.isEntry, activeVersion: f.activeVersion }));
}

module.exports = {
  HttpError,
  starterCanvas,
  list,
  get,
  create,
  saveDraft,
  context,
  buildContext,
  validate,
  publish,
  callers,
  deactivate,
  activateVersion,
  versions,
  duplicate,
  remove,
  linkable,
};
