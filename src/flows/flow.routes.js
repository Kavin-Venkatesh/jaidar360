const express = require("express");
const { z } = require("zod");
const flows = require("./flow.service");

const router = express.Router();

const canvasSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().min(1).max(64),
      type: z.string().min(1).max(32),
      position: z.object({ x: z.number(), y: z.number() }),
      data: z.record(z.string(), z.unknown()).default({}),
    }).passthrough(),
  ).max(500),
  edges: z.array(
    z.object({
      id: z.string().min(1).max(128),
      source: z.string().min(1),
      target: z.string().min(1),
      sourceHandle: z.string().nullish(),
      targetHandle: z.string().nullish(),
    }).passthrough(),
  ).max(2000),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});

const nameSchema = z.string().trim().min(1, "Name is required").max(80);
const createSchema = z.object({ name: nameSchema, isEntry: z.boolean().optional() });
const saveSchema = z.object({
  draft: canvasSchema,
  revision: z.number().int(),
  name: nameSchema.optional(),
  isEntry: z.boolean().optional(),
});

function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new flows.HttpError(400, result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return result.data;
}

// Keep only what the canvas needs; React Flow adds measured sizes, selection flags etc.
function cleanCanvas(canvas) {
  return {
    nodes: canvas.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
    edges: canvas.edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({
      id,
      source,
      sourceHandle: sourceHandle ?? null,
      target,
      targetHandle: targetHandle ?? null,
    })),
    viewport: canvas.viewport,
  };
}

router.get("/flows", async (req, res) => {
  res.json(await flows.list(req.tenantId));
});

router.get("/flows/linkable", async (req, res) => {
  res.json(await flows.linkable(req.tenantId));
});

router.post("/flows", async (req, res) => {
  const body = parse(createSchema, req.body);
  res.status(201).json(await flows.create(req.tenantId, body));
});

router.get("/flows/:id", async (req, res) => {
  res.json(await flows.get(req.tenantId, req.params.id));
});

router.get("/flows/:id/context", async (req, res) => {
  res.json(await flows.context(req.tenantId, req.params.id));
});

router.put("/flows/:id", async (req, res) => {
  const body = parse(saveSchema, req.body);
  res.json(await flows.saveDraft(req.tenantId, req.params.id, { ...body, draft: cleanCanvas(body.draft) }));
});

router.post("/flows/:id/validate", async (req, res) => {
  res.json({ problems: await flows.validate(req.tenantId, req.params.id) });
});

router.post("/flows/:id/publish", async (req, res) => {
  const revision = req.body?.revision === undefined ? undefined : Number(req.body.revision);
  res.json(await flows.publish(req.tenantId, req.params.id, { revision, publishedBy: req.user.username }));
});

router.post("/flows/:id/deactivate", async (req, res) => {
  res.json(await flows.deactivate(req.tenantId, req.params.id, { force: req.body?.force === true }));
});

router.post("/flows/:id/activate", async (req, res) => {
  res.json(await flows.activateVersion(req.tenantId, req.params.id));
});

router.get("/flows/:id/callers", async (req, res) => {
  res.json(await flows.callers(req.tenantId, req.params.id));
});

router.get("/flows/:id/versions", async (req, res) => {
  res.json(await flows.versions(req.tenantId, req.params.id));
});

router.post("/flows/:id/rollback/:version", async (req, res) => {
  const version = Number(req.params.version);
  if (!Number.isInteger(version) || version < 1) throw new flows.HttpError(400, "Invalid version");
  res.json(await flows.activateVersion(req.tenantId, req.params.id, version));
});

router.post("/flows/:id/duplicate", async (req, res) => {
  res.status(201).json(await flows.duplicate(req.tenantId, req.params.id));
});

router.delete("/flows/:id", async (req, res) => {
  await flows.remove(req.tenantId, req.params.id);
  res.sendStatus(204);
});

module.exports = router;
