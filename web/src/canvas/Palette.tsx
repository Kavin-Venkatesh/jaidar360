import { useState } from "react";
import { Search } from "lucide-react";
import { NODE_CATALOG, type NodeMeta } from "./catalog";
import { useEditor } from "../store/editorStore";
import type { NodeType } from "../lib/types";

export const DRAG_MIME = "application/x-wa-node";

export function NodeTypeList({ onPick, draggable = false, filter = "" }: { onPick: (type: NodeType) => void; draggable?: boolean; filter?: string }) {
  const hasTrigger = useEditor((s) => s.nodes.some((n) => n.type === "trigger"));
  const q = filter.trim().toLowerCase();
  const items = NODE_CATALOG.filter((m) => !q || m.label.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));

  const disabled = (m: NodeMeta) => m.type === "trigger" && hasTrigger;

  return (
    <ul className="space-y-1">
      {items.map((m) => {
        const Icon = m.icon;
        const off = disabled(m);
        return (
          <li key={m.type}>
            <button
              type="button"
              disabled={off}
              title={off ? "A flow has exactly one trigger" : `${m.description}. Drag onto the canvas or click to add.`}
              draggable={draggable && !off}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, m.type);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onPick(m.type)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded" style={{ background: m.color }}>
                <Icon size={14} color="white" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-slate-800">{m.label}</span>
                <span className="block text-[11px] leading-tight text-slate-500">{m.description}</span>
              </span>
            </button>
          </li>
        );
      })}
      {!items.length && <li className="px-2 py-4 text-center text-xs text-slate-400">No matching nodes</li>}
    </ul>
  );
}

export function Palette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  const [filter, setFilter] = useState("");
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Nodes</div>
        <label className="flex items-center gap-2 rounded-md border border-slate-300 px-2 py-1">
          <Search size={14} className="text-slate-400" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search nodes…" className="w-full text-sm outline-none" />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <NodeTypeList onPick={onAdd} draggable filter={filter} />
      </div>
    </aside>
  );
}
