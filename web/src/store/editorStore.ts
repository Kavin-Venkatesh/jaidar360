import { create } from "zustand";
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type Viewport } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { api, ApiError } from "../lib/api";
import { edgeId, nodeId, optionId, sectionId } from "../lib/ids";
import { LIMITS, outputHandles, validateFlow } from "../lib/rules";
import { defaultData } from "../canvas/catalog";
import type { Canvas, FlowDetail, FlowEdge, FlowNode, FlowStatus, FlowSummary, LinkableFlow, NodeData, NodeType, Option, Problem, Section, ValidationContext } from "../lib/types";

type Snapshot = { nodes: FlowNode[]; edges: FlowEdge[] };

export interface Picker {
  nodeId: string;
  handleId: string | null;
  x: number;
  y: number;
}

const HISTORY_COALESCE_MS = 1200;
const CLIPBOARD_KEY = "wa-canvas.clipboard";

interface EditorState {
  flowId: string | null;
  name: string;
  isEntry: boolean;
  status: FlowStatus;
  activeVersion: number | null;
  revision: number;
  publishedRevision: number | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: Viewport;
  selectedNodeId: string | null;

  changeId: number; // bumps on every edit
  savedChangeId: number; // changeId at the last successful save
  saving: boolean;
  conflict: boolean;
  saveError: string | null;

  problems: Problem[];
  problemsByNode: Map<string, Problem[]>;
  ctx: ValidationContext | null;
  linkable: LinkableFlow[];

  past: Snapshot[];
  future: Snapshot[];
  historyKey: string | null;
  historyAt: number;

  picker: Picker | null;

  load(flow: FlowDetail): void;
  setContext(ctx: ValidationContext, linkable: LinkableFlow[]): void;
  applySummary(summary: Partial<FlowSummary>): void;

  onNodesChange(changes: NodeChange<FlowNode>[]): void;
  onEdgesChange(changes: EdgeChange<FlowEdge>[]): void;
  onConnect(connection: Connection): void;
  beginDrag(): void;
  setViewport(viewport: Viewport): void;

  addNode(type: NodeType, position: { x: number; y: number }, from?: { nodeId: string; handleId: string | null }): string;
  updateNodeData(id: string, patch: Partial<NodeData>, historyKey?: string): void;
  removeNodes(ids: string[]): void;
  removeEdge(id: string): void;
  removeOption(nodeId: string, optionId: string): void;
  removeSection(nodeId: string, sectionId: string): void;
  setExecuteMode(nodeId: string, mode: "jump" | "call"): void;
  convertNode(nodeId: string, to: "buttons" | "list"): void;
  select(id: string | null): void;
  setName(name: string): void;
  setIsEntry(isEntry: boolean): void;

  undo(): void;
  redo(): void;
  copySelection(): void;
  paste(): void;
  autoLayout(): void;

  validate(): void;
  setProblems(problems: Problem[]): void;
  openPicker(picker: Picker | null): void;

  toCanvas(): Canvas;
  save(): Promise<boolean>;
}

const isDirty = (s: Pick<EditorState, "changeId" | "savedChangeId">) => s.changeId !== s.savedChangeId;
export const selectDirty = (s: EditorState) => isDirty(s);

function groupProblems(problems: Problem[]) {
  const map = new Map<string, Problem[]>();
  for (const p of problems) {
    if (!p.nodeId) continue;
    if (!map.has(p.nodeId)) map.set(p.nodeId, []);
    map.get(p.nodeId)!.push(p);
  }
  return map;
}

function sameHandle(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? null) === (b ?? null);
}

export const useEditor = create<EditorState>((set, get) => {
  // Pushes the current graph onto the undo stack. Rapid edits with the same key (typing in one field) share an entry.
  function record(key: string | null = null) {
    const s = get();
    const now = Date.now();
    if (key && key === s.historyKey && now - s.historyAt < HISTORY_COALESCE_MS) {
      set({ historyAt: now });
      return;
    }
    set({
      past: [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-LIMITS.historySteps),
      future: [],
      historyKey: key,
      historyAt: now,
    });
  }

  const changed = () => set((s) => ({ changeId: s.changeId + 1 }));

  function commit(nodes: FlowNode[], edges: FlowEdge[] = get().edges) {
    set({ nodes, edges });
    changed();
  }

  return {
    flowId: null,
    name: "",
    isEntry: false,
    status: "draft",
    activeVersion: null,
    revision: 0,
    publishedRevision: null,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeId: null,
    changeId: 0,
    savedChangeId: 0,
    saving: false,
    conflict: false,
    saveError: null,
    problems: [],
    problemsByNode: new Map(),
    ctx: null,
    linkable: [],
    past: [],
    future: [],
    historyKey: null,
    historyAt: 0,
    picker: null,

    load(flow) {
      set({
        flowId: flow.id,
        name: flow.name,
        isEntry: flow.isEntry,
        status: flow.status,
        activeVersion: flow.activeVersion,
        revision: flow.revision,
        publishedRevision: flow.publishedRevision,
        nodes: (flow.draft.nodes || []) as FlowNode[],
        edges: (flow.draft.edges || []).map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? null })),
        viewport: flow.draft.viewport || { x: 80, y: 80, zoom: 1 },
        selectedNodeId: null,
        changeId: 0,
        savedChangeId: 0,
        saving: false,
        conflict: false,
        saveError: null,
        past: [],
        future: [],
        historyKey: null,
        picker: null,
      });
      get().validate();
    },

    setContext(ctx, linkable) {
      set({ ctx, linkable });
      get().validate();
    },

    applySummary(summary) {
      set((s) => ({
        status: summary.status ?? s.status,
        activeVersion: summary.activeVersion !== undefined ? summary.activeVersion : s.activeVersion,
        revision: summary.revision ?? s.revision,
        publishedRevision: summary.publishedRevision !== undefined ? summary.publishedRevision : s.publishedRevision,
      }));
    },

    onNodesChange(changes) {
      const meaningful = changes.some((c) => c.type === "remove" || c.type === "add" || c.type === "replace");
      if (changes.some((c) => c.type === "remove")) record();
      const nodes = applyNodeChanges(changes, get().nodes);
      const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
      const edges = removed.size ? get().edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)) : get().edges;
      set({ nodes, edges, selectedNodeId: removed.has(get().selectedNodeId || "") ? null : get().selectedNodeId });
      const moved = changes.some((c) => c.type === "position" && c.dragging === false);
      if (meaningful || moved) changed();
    },

    onEdgesChange(changes) {
      if (changes.some((c) => c.type === "remove")) record();
      set({ edges: applyEdgeChanges(changes, get().edges) });
      if (changes.some((c) => c.type !== "select")) changed();
    },

    onConnect(connection) {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      record();
      // One connection per output handle, like n8n: a new link replaces the old one.
      const kept = get().edges.filter((e) => !(e.source === connection.source && sameHandle(e.sourceHandle, connection.sourceHandle)));
      commit(get().nodes, addEdge({ ...connection, id: edgeId(), sourceHandle: connection.sourceHandle ?? null }, kept));
    },

    beginDrag() {
      record();
    },

    setViewport(viewport) {
      set({ viewport });
    },

    addNode(type, position, from) {
      record();
      const id = type === "trigger" && !get().nodes.some((n) => n.id === "n_trigger") ? "n_trigger" : nodeId();
      const node: FlowNode = { id, type, position, data: defaultData(type, get().nodes), selected: true };
      const nodes = [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node];
      let edges = get().edges;
      if (from) {
        edges = edges.filter((e) => !(e.source === from.nodeId && sameHandle(e.sourceHandle, from.handleId)));
        edges = [...edges, { id: edgeId(), source: from.nodeId, sourceHandle: from.handleId, target: id, targetHandle: null }];
      }
      commit(nodes, edges);
      set({ selectedNodeId: id, picker: null });
      return id;
    },

    updateNodeData(id, patch, historyKey) {
      record(historyKey ?? null);
      commit(get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    },

    removeNodes(ids) {
      if (!ids.length) return;
      record();
      const gone = new Set(ids);
      commit(
        get().nodes.filter((n) => !gone.has(n.id)),
        get().edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
      );
      if (gone.has(get().selectedNodeId || "")) set({ selectedNodeId: null });
    },

    removeEdge(id) {
      record();
      commit(get().nodes, get().edges.filter((e) => e.id !== id));
    },

    removeOption(nodeIdToEdit, optionIdToRemove) {
      record();
      const nodes = get().nodes.map((n) => {
        if (n.id !== nodeIdToEdit) return n;
        if (n.type === "buttons") return { ...n, data: { ...n.data, buttons: (n.data.buttons as Option[]).filter((b) => b.id !== optionIdToRemove) } };
        const sections = (n.data.sections as Section[]).map((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== optionIdToRemove) }));
        return { ...n, data: { ...n.data, sections } };
      });
      commit(nodes, get().edges.filter((e) => !(e.source === nodeIdToEdit && e.sourceHandle === optionIdToRemove)));
    },

    removeSection(nodeIdToEdit, sectionIdToRemove) {
      const node = get().nodes.find((n) => n.id === nodeIdToEdit);
      const section = (node?.data.sections as Section[] | undefined)?.find((s) => s.id === sectionIdToRemove);
      if (!node || !section) return;
      record();
      const rowIds = new Set(section.rows.map((r) => r.id));
      commit(
        get().nodes.map((n) => (n.id === nodeIdToEdit ? { ...n, data: { ...n.data, sections: (n.data.sections as Section[]).filter((s) => s.id !== sectionIdToRemove) } } : n)),
        get().edges.filter((e) => !(e.source === nodeIdToEdit && e.sourceHandle && rowIds.has(e.sourceHandle))),
      );
    },

    setExecuteMode(id, mode) {
      record();
      const nodes = get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, mode } } : n));
      // Jump ends the flow, so it has no output.
      const edges = mode === "jump" ? get().edges.filter((e) => e.source !== id) : get().edges;
      commit(nodes, edges);
    },

    // Buttons <-> List keeps option IDs, so existing connections survive.
    convertNode(id, to) {
      const node = get().nodes.find((n) => n.id === id);
      if (!node) return;
      record();
      const { header, body, footer, saveAs, label } = node.data;
      let data: NodeData;
      if (to === "list") {
        const rows = (node.data.buttons as Option[]).map((b) => ({ id: b.id, title: b.title, description: "" }));
        data = { label: label === "Buttons" ? "List" : label, header, body, footer, saveAs, buttonLabel: "Choose", sections: [{ id: sectionId(), title: "", rows }] };
      } else {
        const rows = (node.data.sections as Section[]).flatMap((s) => s.rows);
        if (rows.length > LIMITS.maxButtons) return;
        data = { label: label === "List" ? "Buttons" : label, header, body, footer, saveAs, buttons: rows.map((r) => ({ id: r.id, title: r.title })) };
      }
      commit(get().nodes.map((n) => (n.id === id ? { ...n, type: to, data } : n)));
    },

    select(id) {
      set({ selectedNodeId: id, picker: null });
    },

    setName(name) {
      set({ name });
      changed();
    },

    setIsEntry(isEntry) {
      set({ isEntry });
      changed();
      get().validate();
    },

    undo() {
      const s = get();
      const previous = s.past[s.past.length - 1];
      if (!previous) return;
      set({ past: s.past.slice(0, -1), future: [{ nodes: s.nodes, edges: s.edges }, ...s.future], nodes: previous.nodes, edges: previous.edges, historyKey: null });
      changed();
    },

    redo() {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({ future: s.future.slice(1), past: [...s.past, { nodes: s.nodes, edges: s.edges }], nodes: next.nodes, edges: next.edges, historyKey: null });
      changed();
    },

    copySelection() {
      const selected = get().nodes.filter((n) => n.selected);
      if (!selected.length) return;
      const ids = new Set(selected.map((n) => n.id));
      const payload = { nodes: selected, edges: get().edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
      try {
        localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    },

    paste() {
      let payload: Snapshot | null = null;
      try {
        payload = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || "null");
      } catch {
        payload = null;
      }
      if (!payload?.nodes?.length) return;
      record();
      const hasTrigger = get().nodes.some((n) => n.type === "trigger");
      const idMap = new Map<string, string>();
      const handleMap = new Map<string, string>();
      const pasted: FlowNode[] = [];
      for (const node of payload.nodes) {
        if (node.type === "trigger" && hasTrigger) continue;
        const id = nodeId();
        idMap.set(node.id, id);
        const data: NodeData = structuredClone(node.data);
        // Option IDs become edge handles: give copies fresh ones.
        if (node.type === "buttons") data.buttons = (data.buttons as Option[]).map((b) => (handleMap.set(`${node.id}:${b.id}`, optionId()), { ...b, id: handleMap.get(`${node.id}:${b.id}`)! }));
        if (node.type === "list") {
          data.sections = (data.sections as Section[]).map((s) => ({
            ...s,
            id: sectionId(),
            rows: s.rows.map((r) => (handleMap.set(`${node.id}:${r.id}`, optionId()), { ...r, id: handleMap.get(`${node.id}:${r.id}`)! })),
          }));
        }
        if (data.saveAs) data.saveAs = `${data.saveAs}_copy`;
        pasted.push({ id, type: node.type, data, position: { x: node.position.x + 40, y: node.position.y + 40 }, selected: true });
      }
      const edges = payload.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          id: edgeId(),
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
          sourceHandle: e.sourceHandle ? handleMap.get(`${e.source}:${e.sourceHandle}`) ?? e.sourceHandle : null,
          targetHandle: null,
        }));
      commit([...get().nodes.map((n) => ({ ...n, selected: false })), ...pasted], [...get().edges, ...edges]);
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ nodes: pasted, edges }));
    },

    autoLayout() {
      const { nodes, edges } = get();
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 });
      g.setDefaultEdgeLabel(() => ({}));
      for (const n of nodes) g.setNode(n.id, { width: n.measured?.width ?? 260, height: n.measured?.height ?? 120 });
      // Order edges by output handle so option branches stay top-to-bottom.
      for (const n of nodes) {
        const handles = outputHandles(n);
        for (const e of edges.filter((x) => x.source === n.id).sort((a, b) => handles.indexOf(a.sourceHandle ?? null) - handles.indexOf(b.sourceHandle ?? null))) {
          g.setEdge(e.source, e.target);
        }
      }
      dagre.layout(g);
      record();
      commit(
        nodes.map((n) => {
          const p = g.node(n.id);
          return p ? { ...n, position: { x: p.x - p.width / 2, y: p.y - p.height / 2 } } : n;
        }),
      );
    },

    validate() {
      const s = get();
      const problems = validateFlow({ nodes: s.nodes, edges: s.edges }, { ...(s.ctx || {}), flowId: s.flowId || undefined, isEntry: s.isEntry });
      set({ problems, problemsByNode: groupProblems(problems) });
    },

    setProblems(problems) {
      set({ problems, problemsByNode: groupProblems(problems) });
    },

    openPicker(picker) {
      set({ picker });
    },

    toCanvas() {
      const s = get();
      return {
        nodes: s.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })) as FlowNode[],
        edges: s.edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({ id, source, sourceHandle: sourceHandle ?? null, target, targetHandle: targetHandle ?? null })),
        viewport: s.viewport,
      };
    },

    async save() {
      const s = get();
      if (!s.flowId || s.saving || s.conflict) return false;
      if (!isDirty(s)) return true;
      const savingChangeId = s.changeId;
      set({ saving: true, saveError: null });
      try {
        const summary = await api<FlowSummary>(`/flows/${s.flowId}`, {
          method: "PUT",
          body: { draft: s.toCanvas(), revision: s.revision, name: s.name, isEntry: s.isEntry },
        });
        get().applySummary(summary);
        set({ savedChangeId: savingChangeId, saving: false });
        return true;
      } catch (error) {
        const conflict = error instanceof ApiError && error.status === 409 && typeof error.body.revision === "number";
        set({ saving: false, conflict, saveError: (error as Error).message });
        return false;
      }
    },
  };
});
