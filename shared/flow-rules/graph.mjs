import { normalizeHandle, outputHandles } from "./nodes.mjs";

const handleKey = (handle) => (handle === null ? "default" : handle);

// Indexes a canvas: nodes by id, outgoing edges by source + handle, incoming by target.
export function indexCanvas(canvas) {
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
  const edges = Array.isArray(canvas?.edges) ? canvas.edges : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map(); // nodeId -> Map(handleKey -> edge[])
  const incoming = new Map(); // nodeId -> edge[]

  for (const edge of edges) {
    const key = handleKey(normalizeHandle(edge.sourceHandle));
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, new Map());
    const perHandle = outgoing.get(edge.source);
    if (!perHandle.has(key)) perHandle.set(key, []);
    perHandle.get(key).push(edge);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge);
  }

  const edgesFrom = (nodeId, handle) => outgoing.get(nodeId)?.get(handleKey(handle)) || [];

  // Follows an edge target through disabled pass-through nodes.
  const resolveTarget = (targetId) => {
    const seen = new Set();
    let current = targetId;
    while (current && byId.get(current)?.data?.disabled) {
      if (seen.has(current)) return null;
      seen.add(current);
      current = edgesFrom(current, null)[0]?.target || null;
    }
    return current && byId.has(current) ? current : null;
  };

  const nextOf = (nodeId, handle) => {
    const edge = edgesFrom(nodeId, handle)[0];
    return edge ? resolveTarget(edge.target) : null;
  };

  // Successors over the compiled graph (disabled nodes skipped).
  const successors = (nodeId) => outputHandles(byId.get(nodeId)).map((h) => nextOf(nodeId, h)).filter(Boolean);

  return { nodes, edges, byId, outgoing, incoming, edgesFrom, nextOf, resolveTarget, successors, handleKey };
}

export function reachableFrom(index, startId) {
  const seen = new Set();
  const queue = startId ? [startId] : [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !index.byId.has(id)) continue;
    seen.add(id);
    // Walk raw edges too, so disabled nodes count as reachable in the editor.
    for (const edges of index.outgoing.get(id)?.values() || []) for (const e of edges) queue.push(e.target);
  }
  return seen;
}
