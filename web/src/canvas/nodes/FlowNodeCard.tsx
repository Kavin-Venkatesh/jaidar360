import { memo, useEffect, useState } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { NODE_META } from "../catalog";
import { useEditor } from "../../store/editorStore";
import { CONDITION_OPERATORS } from "../../lib/rules";
import type { FlowNode, NodeData, NodeType, Option, Rule, Section } from "../../lib/types";

interface Output {
  id: string | null;
  label: string;
  tone?: "true" | "false";
}

function outputsFor(type: NodeType, data: NodeData): Output[] {
  switch (type) {
    case "buttons":
      return (data.buttons as Option[]).map((b) => ({ id: b.id, label: b.title || "(empty)" }));
    case "list":
      return (data.sections as Section[]).flatMap((s) => s.rows).map((r) => ({ id: r.id, label: r.title || "(empty)" }));
    case "condition":
      return [
        { id: "true", label: "true", tone: "true" },
        { id: "false", label: "false", tone: "false" },
      ];
    case "executeFlow":
      return data.mode === "call" ? [{ id: null, label: "" }] : [];
    case "end":
      return [];
    default:
      return [{ id: null, label: "" }];
  }
}

const clip = (text: unknown, max = 90) => {
  const s = String(text ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function Summary({ type, data }: { type: NodeType; data: NodeData }) {
  const linkable = useEditor((s) => s.linkable);
  const isEntry = useEditor((s) => s.isEntry);
  const empty = <span className="italic text-slate-400">Not configured</span>;

  switch (type) {
    case "trigger": {
      const keywords = (data.keywords as string[]) || [];
      return (
        <div className="space-y-1">
          {isEntry && <span className="wa-chip bg-amber-100 text-amber-800">Entry flow</span>}
          {keywords.length ? (
            <div className="flex flex-wrap gap-1">
              {keywords.map((k) => (
                <span key={k} className="wa-chip">“{k}”</span>
              ))}
            </div>
          ) : (
            <span className="text-slate-500">Runs only from Execute Flow</span>
          )}
        </div>
      );
    }
    case "message":
      return <>{data.imageUrl ? "🖼 " : ""}{clip(data.text) || empty}</>;
    case "buttons":
    case "list":
      return <>{clip(data.body) || empty}</>;
    case "question":
      return (
        <div className="space-y-1">
          <div>{clip(data.prompt) || empty}</div>
          <div className="flex gap-1">
            <span className="wa-chip">{data.inputType}</span>
            {data.saveAs && <span className="wa-chip font-mono">→ {data.saveAs}</span>}
          </div>
        </div>
      );
    case "location":
    case "locationLink":
    case "media":
      return (
        <div className="space-y-1">
          <div>{clip(data.prompt) || empty}</div>
          {data.saveAs && <span className="wa-chip font-mono">→ {data.saveAs}</span>}
        </div>
      );
    case "condition": {
      const rules = (data.rules as Rule[]) || [];
      if (!rules.length) return empty;
      return (
        <div className="font-mono text-[11px] leading-5">
          {rules.map((r, i) => (
            <div key={r.id}>
              {i > 0 && <span className="text-slate-400">{data.match === "any" ? "or " : "and "}</span>}
              {r.variable || "?"} {CONDITION_OPERATORS.find((o) => o.id === r.operator)?.label || r.operator} {CONDITION_OPERATORS.find((o) => o.id === r.operator)?.needsValue ? r.value : ""}
            </div>
          ))}
        </div>
      );
    }
    case "executeFlow": {
      const target = linkable.find((f) => f.id === data.targetFlowId);
      if (!data.targetFlowId) return empty;
      return (
        <>
          {data.mode === "call" ? "Call " : "Jump to "}
          <strong>{target?.name || "(unavailable flow)"}</strong>
          {data.mode === "call" ? " and return" : ""}
        </>
      );
    }
    case "end":
      return (
        <div className="space-y-1">
          <div>{clip(data.message) || <span className="text-slate-500">No closing message</span>}</div>
          {data.saveSubmission !== false && <span className="wa-chip">Saves submission</span>}
        </div>
      );
  }
}

function OutputHandle({ nodeId, output }: { nodeId: string; output: Output }) {
  const connected = useEditor((s) => s.edges.some((e) => e.source === nodeId && (e.sourceHandle ?? null) === output.id));
  const openPicker = useEditor((s) => s.openPicker);
  // The "+" lives inside the handle, so dragging it starts a connection (like n8n) and a plain click opens the picker.
  return (
    <Handle type="source" position={Position.Right} id={output.id ?? undefined} className={output.tone ? `wa-handle-${output.tone}` : undefined}>
      {!connected && (
        <button
          type="button"
          className="wa-add-next"
          title="Drag to connect, or click to add the next node"
          onClick={(event) => {
            event.stopPropagation();
            openPicker({ nodeId, handleId: output.id, x: event.clientX, y: event.clientY });
          }}
        >
          <Plus size={12} />
        </button>
      )}
    </Handle>
  );
}

function Title({ id, data, fallback }: { id: string; data: NodeData; fallback: string }) {
  const [editing, setEditing] = useState(false);
  const updateNodeData = useEditor((s) => s.updateNodeData);
  if (editing) {
    return (
      <input
        autoFocus
        className="nodrag w-full rounded border border-slate-300 px-1 text-[13px] font-semibold"
        defaultValue={data.label || fallback}
        maxLength={40}
        onBlur={(e) => {
          updateNodeData(id, { label: e.target.value.trim() || fallback });
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <span
      className="truncate"
      title="Double-click to rename"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {data.label || fallback}
    </span>
  );
}

function FlowNodeCardImpl({ id, type, data, selected }: NodeProps<FlowNode>) {
  const meta = NODE_META[type];
  const Icon = meta.icon;
  const problems = useEditor((s) => s.problemsByNode.get(id));
  const errors = problems?.filter((p) => p.severity === "error").length || 0;
  const warnings = problems?.filter((p) => p.severity === "warning").length || 0;
  const outputs = outputsFor(type, data);
  const single = outputs.length === 1 && outputs[0].id === null;

  // Buttons/List add and remove handles; React Flow must re-measure them.
  const updateInternals = useUpdateNodeInternals();
  const handleKey = outputs.map((o) => o.id).join("|");
  useEffect(() => updateInternals(id), [id, handleKey, updateInternals]);

  return (
    <div className={`wa-node ${selected ? "is-selected" : ""} ${data.disabled ? "is-disabled" : ""} ${errors ? "has-error" : ""}`}>
      {type !== "trigger" && <Handle type="target" position={Position.Left} />}
      <div className="wa-node__header">
        <span className="wa-node__icon" style={{ background: meta.color }}>
          <Icon size={14} color="white" />
        </span>
        <Title id={id} data={data} fallback={meta.label} />
        <span className="ml-auto flex items-center gap-1">
          {data.disabled && <span className="wa-chip">off</span>}
          {errors > 0 && <span className="wa-dot bg-red-500" title={`${errors} error(s)`} />}
          {!errors && warnings > 0 && <span className="wa-dot bg-amber-400" title={`${warnings} warning(s)`} />}
        </span>
      </div>
      <div className="wa-node__body">
        <Summary type={type} data={data} />
      </div>
      {single && <OutputHandle nodeId={id} output={outputs[0]} />}
      {!single && outputs.length > 0 && (
        <div className="wa-node__options">
          {outputs.map((o) => (
            <div key={o.id} className={`wa-node__option ${o.tone ? `is-${o.tone}` : ""}`}>
              <span className="truncate">{o.label}</span>
              <OutputHandle nodeId={id} output={o} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const FlowNodeCard = memo(FlowNodeCardImpl);

// Typed by NodeType so adding a node type without registering it here fails the type check.
export const nodeTypes: Record<NodeType, typeof FlowNodeCard> = {
  trigger: FlowNodeCard,
  message: FlowNodeCard,
  buttons: FlowNodeCard,
  list: FlowNodeCard,
  question: FlowNodeCard,
  location: FlowNodeCard,
  locationLink: FlowNodeCard,
  media: FlowNodeCard,
  condition: FlowNodeCard,
  executeFlow: FlowNodeCard,
  end: FlowNodeCard,
};
