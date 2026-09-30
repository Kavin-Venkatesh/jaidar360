// Canvas JSON (React Flow nodes + edges) -> runtime graph read by the engine.
// Drops positions/viewport, turns edges into `next` maps keyed by output handle ("default" for single outputs),
// routes around disabled nodes and resolves the start node (the node after the trigger).

import { listRows, normalizeKeyword, outputHandles, savedVariable } from "./nodes.mjs";
import { indexCanvas } from "./graph.mjs";

const trim = (v) => String(v ?? "").trim();
const optional = (v) => (trim(v) ? trim(v) : undefined);

export function compileFlow(canvas, { flowId, version, isEntry = false } = {}) {
  const index = indexCanvas(canvas);
  const trigger = index.nodes.find((n) => n.type === "trigger");
  if (!trigger) throw new Error("Flow has no trigger");

  const start = index.nextOf(trigger.id, null);
  const compiled = {
    flowId,
    version,
    start,
    trigger: {
      keywords: [...new Set((trigger.data?.keywords || []).map(normalizeKeyword).filter(Boolean))],
      entry: Boolean(isEntry),
    },
    nodes: {},
    calls: [],
    jumps: [],
    saves: [],
  };

  // Only nodes reachable from the start are shipped to the runtime.
  const queue = start ? [start] : [];
  while (queue.length) {
    const id = queue.shift();
    if (compiled.nodes[id]) continue;
    const node = index.byId.get(id);
    const next = {};
    for (const handle of outputHandles(node)) {
      const target = index.nextOf(id, handle);
      if (!target) continue;
      next[handle === null ? "default" : handle] = target;
      queue.push(target);
    }
    compiled.nodes[id] = { ...compileNode(node), next };
    const saved = savedVariable(node);
    if (saved) compiled.saves.push(saved);
    if (node.type === "executeFlow") (node.data.mode === "call" ? compiled.calls : compiled.jumps).push(node.data.targetFlowId);
  }

  compiled.calls = [...new Set(compiled.calls)];
  compiled.jumps = [...new Set(compiled.jumps)];
  return compiled;
}

function compileNode(node) {
  const d = node.data || {};
  const base = { type: node.type, label: optional(d.label) };
  switch (node.type) {
    case "message":
      return { ...base, text: trim(d.text), imageUrl: optional(d.imageUrl) };
    case "buttons":
      return {
        ...base,
        header: optional(d.header),
        body: trim(d.body),
        footer: optional(d.footer),
        options: (d.buttons || []).map((b) => ({ id: b.id, title: trim(b.title) })),
        saveAs: optional(d.saveAs),
      };
    case "list":
      return {
        ...base,
        header: optional(d.header),
        body: trim(d.body),
        footer: optional(d.footer),
        buttonLabel: trim(d.buttonLabel),
        sections: (d.sections || []).map((s) => ({
          title: optional(s.title),
          rows: (s.rows || []).map((r) => ({ id: r.id, title: trim(r.title), description: optional(r.description) })),
        })),
        options: listRows(d).map((r) => ({ id: r.id, title: trim(r.title) })),
        saveAs: optional(d.saveAs),
      };
    case "question": {
      const v = d.validation || {};
      const num = (x) => (x === "" || x === undefined || x === null ? undefined : Number(x));
      return {
        ...base,
        prompt: trim(d.prompt),
        inputType: d.inputType,
        validation: { regex: optional(v.regex), min: num(v.min), max: num(v.max) },
        errorMessage: optional(d.errorMessage),
        maxAttempts: Number(d.maxAttempts ?? 3),
        saveAs: trim(d.saveAs),
      };
    }
    case "location":
      return { ...base, prompt: trim(d.prompt), saveAs: trim(d.saveAs) };
    case "media":
      return { ...base, prompt: trim(d.prompt), accept: d.accept || "image", required: d.required !== false, saveAs: trim(d.saveAs) };
    case "condition":
      return {
        ...base,
        match: d.match === "any" ? "any" : "all",
        rules: (d.rules || []).map((r) => ({ variable: trim(r.variable), operator: r.operator, value: r.value ?? "" })),
      };
    case "executeFlow":
      return { ...base, targetFlowId: d.targetFlowId, mode: d.mode };
    case "end":
      return { ...base, message: optional(d.message), saveSubmission: d.saveSubmission !== false };
    default:
      return base;
  }
}
