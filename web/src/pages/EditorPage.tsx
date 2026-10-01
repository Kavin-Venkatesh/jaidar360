import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type OnConnectEnd,
} from "@xyflow/react";
import { ArrowLeft, History, LayoutGrid, Loader2, Redo2, ShieldCheck, Undo2, UploadCloud } from "lucide-react";
import { api, ApiError, session } from "../lib/api";
import { toast } from "../lib/toast";
import { selectDirty, useEditor } from "../store/editorStore";
import { nodeTypes } from "../canvas/nodes/FlowNodeCard";
import { edgeTypes } from "../canvas/FlowEdge";
import { DRAG_MIME, Palette } from "../canvas/Palette";
import { NodePanel } from "../canvas/panel/NodePanel";
import { ProblemsBar } from "../canvas/ProblemsBar";
import { AddNodePopover } from "../canvas/AddNodePopover";
import { NODE_META } from "../canvas/catalog";
import { isNodeType } from "../lib/rules";
import type { FlowDetail, FlowSummary, FlowVersionInfo, LinkableFlow, Problem, ValidationContext } from "../lib/types";

const AUTOSAVE_MS = 5000;

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const load = useEditor((s) => s.load);
  const setContext = useEditor((s) => s.setContext);
  const loadedFor = useEditor((s) => s.flowId);

  const flow = useQuery({ queryKey: ["flow", id], queryFn: () => api<FlowDetail>(`/flows/${id}`), staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false });
  const ctx = useQuery({ queryKey: ["flow-context", id], queryFn: () => api<ValidationContext>(`/flows/${id}/context`) });
  const linkable = useQuery({ queryKey: ["linkable"], queryFn: () => api<LinkableFlow[]>("/flows/linkable") });

  useEffect(() => {
    if (flow.data) load(flow.data);
  }, [flow.data, load]);

  useEffect(() => {
    if (ctx.data && linkable.data && loadedFor === id) setContext(ctx.data, linkable.data);
  }, [ctx.data, linkable.data, loadedFor, id, setContext]);

  if (flow.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-600">
        <p>{(flow.error as Error).message}</p>
        <Link to="/" className="text-green-700 underline">Back to flows</Link>
      </div>
    );
  }
  if (!flow.data || loadedFor !== id) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <EditorShell />
    </ReactFlowProvider>
  );
}

function EditorShell() {
  const store = useEditor;
  const dirty = useEditor(selectDirty);
  const conflict = useEditor((s) => s.conflict);
  const queryClient = useQueryClient();
  const [versionsOpen, setVersionsOpen] = useState(false);

  // Live validation with the shared rules, debounced while typing.
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  useEffect(() => {
    const t = setTimeout(() => store.getState().validate(), 250);
    return () => clearTimeout(t);
  }, [nodes, edges, store]);

  // Autosave every 5s while dirty. A failed save isn't retried until something changes again.
  const changeId = useEditor((s) => s.changeId);
  const failedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!dirty || conflict || failedAt.current === changeId) return;
    const t = setTimeout(async () => {
      const ok = await store.getState().save();
      if (!ok) failedAt.current = store.getState().changeId;
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, conflict, changeId, store]);

  // Leaving with unsaved changes: browser tab close + in-app navigation.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (selectDirty(store.getState())) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [store]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    store.getState().save().then((ok) => {
      if (ok || window.confirm("Your latest changes couldn't be saved. Leave anyway?")) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, store]);

  // Keyboard shortcuts (Delete/Backspace are handled by React Flow).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        store.getState().save().then((ok) => ok && toast("Saved", "success"));
        return;
      }
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      const s = store.getState();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        s.redo();
      } else if (key === "c") {
        s.copySelection();
      } else if (key === "v") {
        e.preventDefault();
        s.paste();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const reloadLatest = async () => {
    const latest = await api<FlowDetail>(`/flows/${store.getState().flowId}`);
    store.getState().load(latest);
    queryClient.invalidateQueries({ queryKey: ["flow-context"] });
    toast("Loaded the latest version", "info");
  };

  return (
    <div className="flex h-full flex-col">
      <EditorHeader onOpenVersions={() => setVersionsOpen(true)} />
      {conflict && (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
          <span>This flow was changed in another tab or by someone else, so your latest edits weren't saved.</span>
          <button type="button" className="btn-secondary" onClick={reloadLatest}>
            Reload latest (discard my edits)
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <PaletteWithAdd />
        <div className="flex min-w-0 flex-1 flex-col">
          <Canvas />
          <ProblemsBar />
        </div>
        <NodePanel />
      </div>
      <AddNodePopover />
      {versionsOpen && <VersionsDialog onClose={() => setVersionsOpen(false)} />}
    </div>
  );
}

function PaletteWithAdd() {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useEditor((s) => s.addNode);
  // Click-to-add drops the node in the middle of the visible canvas.
  const onAdd = useCallback(
    (type: Parameters<typeof addNode>[0]) => {
      const el = document.querySelector(".react-flow")?.getBoundingClientRect();
      const center = el ? { x: el.left + el.width / 2, y: el.top + el.height / 2 } : { x: 400, y: 300 };
      const p = screenToFlowPosition(center);
      addNode(type, { x: p.x - 130, y: p.y - 50 });
    },
    [addNode, screenToFlowPosition],
  );
  return <Palette onAdd={onAdd} />;
}

function Canvas() {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodes = useEditor((s) => s.nodes);

  // Zoom to fit once the nodes have been measured, like n8n does when a workflow opens.
  const nodesInitialized = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || fitted.current) return;
    fitted.current = true;
    if (nodes.length > 1) fitView({ maxZoom: 1, padding: 0.15 });
  }, [nodesInitialized, nodes.length, fitView]);
  const rawEdges = useEditor((s) => s.edges);
  const viewport = useEditor.getState().viewport;
  const { onNodesChange, onEdgesChange, onConnect, beginDrag, select, setViewport, addNode } = useEditor.getState();

  const edges = useMemo(() => rawEdges.map((e) => (e.type === "flow" ? e : { ...e, type: "flow" })), [rawEdges]);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (c.source === c.target) return false;
    const target = useEditor.getState().nodes.find((n) => n.id === c.target);
    return target?.type !== "trigger";
  }, []);

  // A connection released away from an input handle: onto a node's body connects to that node's input;
  // onto empty canvas opens the node picker there (n8n style).
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || state.fromHandle?.type !== "source") return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const hit = document.elementFromPoint(point.clientX, point.clientY);
      const connection = { source: state.fromNode.id, sourceHandle: state.fromHandle.id ?? null, targetHandle: null };

      const targetId = hit?.closest(".react-flow__node")?.getAttribute("data-id");
      if (targetId) {
        if (isValidConnection({ ...connection, target: targetId })) onConnect({ ...connection, target: targetId });
        return;
      }
      if (hit?.closest(".react-flow__pane")) {
        useEditor.getState().openPicker({
          nodeId: connection.source,
          handleId: connection.sourceHandle,
          x: point.clientX,
          y: point.clientY,
          position: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
        });
      }
    },
    [isValidConnection, onConnect, screenToFlowPosition],
  );

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(DRAG_MIME);
    if (!type || !isNodeType(type)) return;
    e.preventDefault();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(type, { x: p.x - 130, y: p.y - 30 });
  };

  return (
    <div className="relative min-h-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        connectionRadius={36}
        isValidConnection={isValidConnection}
        onNodeDragStart={beginDrag}
        onNodeClick={(_, node) => select(node.id)}
        onPaneClick={() => select(null)}
        onMoveEnd={(_, vp) => setViewport(vp)}
        defaultViewport={viewport}
        defaultEdgeOptions={{ type: "flow", markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#94a3b8" } }}
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode={["Meta", "Control", "Shift"]}
        minZoom={0.2}
        maxZoom={2}
        snapToGrid
        snapGrid={[10, 10]}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#cbd5e1" />
        <Controls position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (isNodeType(n.type || "") ? NODE_META[n.type as keyof typeof NODE_META].color : "#94a3b8")} nodeStrokeWidth={2} />
      </ReactFlow>
      {nodes.length <= 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
          <div className="rounded-full bg-white/90 px-4 py-1.5 text-[13px] text-slate-500 shadow">Drag nodes from the left, or click the + on the trigger's output to add the next step.</div>
        </div>
      )}
    </div>
  );
}

function EditorHeader({ onOpenVersions }: { onOpenVersions: () => void }) {
  const s = useEditor();
  const dirty = selectDirty(s);
  const queryClient = useQueryClient();
  const tenantName = session.me?.tenant.name;
  const [busy, setBusy] = useState<null | "publish" | "validate" | "toggle">(null);

  const hasUnpublished = s.activeVersion !== null && s.revision !== s.publishedRevision;
  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ["flows"] });
    queryClient.invalidateQueries({ queryKey: ["flow-context"] });
    queryClient.invalidateQueries({ queryKey: ["linkable"] });
  };

  const showServerProblems = (problems: Problem[]) => useEditor.getState().setProblems(problems);

  const validate = async () => {
    setBusy("validate");
    try {
      if (!(await s.save())) return;
      const { problems } = await api<{ problems: Problem[] }>(`/flows/${s.flowId}/validate`, { method: "POST" });
      showServerProblems(problems);
      const errors = problems.filter((p) => p.severity === "error").length;
      toast(errors ? `${errors} error(s) must be fixed before publishing` : "No errors. Ready to publish.", errors ? "error" : "success");
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy("publish");
    try {
      if (!(await s.save())) {
        toast(useEditor.getState().saveError || "Couldn't save the draft", "error");
        return;
      }
      const revision = useEditor.getState().revision;
      const result = await api<{ version: number }>(`/flows/${s.flowId}/publish`, { method: "POST", body: { revision } });
      useEditor.getState().applySummary({ status: "active", activeVersion: result.version, publishedRevision: revision });
      refreshLists();
      toast(`Published v${result.version}. Agents get it on their next conversation.`, "success");
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.body.problems)) showServerProblems(error.body.problems as Problem[]);
      toast((error as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async () => {
    setBusy("toggle");
    try {
      if (s.status === "active") {
        let result: FlowSummary;
        try {
          result = await api<FlowSummary>(`/flows/${s.flowId}/deactivate`, { method: "POST", body: {} });
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 409 && Array.isArray(error.body.callers))) throw error;
          const names = (error.body.callers as { name: string }[]).map((c) => `• ${c.name}`).join("\n");
          if (!window.confirm(`These active flows link to this one:\n${names}\n\nAgents will see "not available" there. Deactivate anyway?`)) return;
          result = await api<FlowSummary>(`/flows/${s.flowId}/deactivate`, { method: "POST", body: { force: true } });
        }
        useEditor.getState().applySummary(result);
        toast("Deactivated. New conversations won't start this flow.", "info");
      } else if (s.activeVersion !== null && !hasUnpublished && !dirty) {
        useEditor.getState().applySummary(await api<FlowSummary>(`/flows/${s.flowId}/activate`, { method: "POST" }));
        toast(`Activated v${s.activeVersion}`, "success");
      } else {
        setBusy(null);
        await publish();
        return;
      }
      refreshLists();
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.body.problems)) showServerProblems(error.body.problems as Problem[]);
      toast((error as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const errors = s.problems.filter((p) => p.severity === "error").length;
  const active = s.status === "active";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
      <Link to="/" className="flex items-center gap-1 rounded px-2 py-1 text-[13px] text-slate-600 hover:bg-slate-100">
        <ArrowLeft size={15} /> Flows
      </Link>
      <div className="h-5 w-px bg-slate-200" />
      <span className="text-[13px] text-slate-500">{tenantName} /</span>
      <input value={s.name} onChange={(e) => s.setName(e.target.value)} maxLength={80} className="w-56 rounded px-1 text-[14px] font-semibold text-slate-800 outline-none hover:bg-slate-50 focus:bg-slate-50" aria-label="Flow name" />
      <span className="flex items-center gap-1 text-[12px] text-slate-500">
        {s.status === "draft" ? "Draft" : `v${s.activeVersion}${s.status === "inactive" ? " · inactive" : ""}`}
        {(dirty || hasUnpublished) && <span title={dirty ? "Unsaved changes" : "Saved, not yet published"} className="font-bold text-amber-600">*</span>}
        {s.saving ? <span className="ml-1 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Saving…</span> : dirty ? <span className="ml-1">Unsaved</span> : <span className="ml-1">Saved</span>}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" className="icon-btn" title="Undo (⌘Z)" onClick={s.undo} disabled={!s.past.length}>
          <Undo2 size={16} />
        </button>
        <button type="button" className="icon-btn" title="Redo (⌘⇧Z)" onClick={s.redo} disabled={!s.future.length}>
          <Redo2 size={16} />
        </button>
        <button type="button" className="icon-btn" title="Auto-layout" onClick={s.autoLayout}>
          <LayoutGrid size={16} />
        </button>
        <button type="button" className="icon-btn" title="Version history" onClick={onOpenVersions}>
          <History size={16} />
        </button>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <button type="button" className="btn-secondary" onClick={validate} disabled={busy !== null}>
          {busy === "validate" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Validate
        </button>
        <button type="button" className="btn-secondary" onClick={() => s.save().then((ok) => ok && toast("Saved", "success"))} disabled={!dirty || s.saving}>
          Save
        </button>
        <button type="button" className="btn-primary" onClick={publish} disabled={busy !== null || errors > 0} title={errors ? "Fix the problems first" : "Publish a new version and activate it"}>
          {busy === "publish" ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} Publish
        </button>
        <label className="ml-2 flex cursor-pointer items-center gap-2 text-[12px] text-slate-600" title="Active flows handle WhatsApp conversations">
          Active
          <button type="button" role="switch" aria-checked={active} onClick={toggleActive} disabled={busy !== null || (!active && errors > 0 && (s.activeVersion === null || hasUnpublished || dirty))} className={`relative h-5 w-9 rounded-full transition ${active ? "bg-green-600" : "bg-slate-300"} disabled:opacity-50`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${active ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </label>
      </div>
    </header>
  );
}

function VersionsDialog({ onClose }: { onClose: () => void }) {
  const flowId = useEditor((s) => s.flowId);
  const activeVersion = useEditor((s) => s.activeVersion);
  const status = useEditor((s) => s.status);
  const queryClient = useQueryClient();
  const versions = useQuery({ queryKey: ["versions", flowId], queryFn: () => api<FlowVersionInfo[]>(`/flows/${flowId}/versions`) });

  const activate = async (version: number) => {
    try {
      const summary = await api<FlowSummary>(`/flows/${flowId}/rollback/${version}`, { method: "POST" });
      useEditor.getState().applySummary(summary);
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      queryClient.invalidateQueries({ queryKey: ["flow-context"] });
      queryClient.invalidateQueries({ queryKey: ["linkable"] });
      toast(`v${version} is now active for new conversations`, "success");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-800">Version history</h2>
          <p className="text-[12px] text-slate-500">Activating an older version affects new conversations only; running ones stay on their version.</p>
        </div>
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {versions.isLoading && <li className="p-4 text-center text-slate-400"><Loader2 className="inline animate-spin" /></li>}
          {versions.data?.length === 0 && <li className="p-4 text-center text-[13px] text-slate-500">Not published yet.</li>}
          {versions.data?.map((v) => {
            const isActive = v.version === activeVersion && status === "active";
            return (
              <li key={v.version} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <span className="w-10 font-semibold">v{v.version}</span>
                <span className="flex-1 text-slate-500">
                  {new Date(v.publishedAt).toLocaleString()} · {v.publishedBy}
                </span>
                {isActive ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">Active</span> : <button type="button" className="btn-secondary" onClick={() => activate(v.version)}>Activate</button>}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end border-t border-slate-200 px-4 py-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
