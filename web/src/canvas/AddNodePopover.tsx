import { useEffect, useRef, useState } from "react";
import { useEditor } from "../store/editorStore";
import { outputHandles } from "../lib/rules";
import { NodeTypeList } from "./Palette";
import type { NodeType } from "../lib/types";

// Opened by the "+" next to an unconnected output: pick a node type, it is placed to the right and connected.
export function AddNodePopover() {
  const picker = useEditor((s) => s.picker);
  const openPicker = useEditor((s) => s.openPicker);
  const addNode = useEditor((s) => s.addNode);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picker) return;
    setFilter("");
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) openPicker(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && openPicker(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [picker, openPicker]);

  if (!picker) return null;

  const pick = (type: NodeType) => {
    const source = useEditor.getState().nodes.find((n) => n.id === picker.nodeId);
    if (!source) return;
    const handles = outputHandles(source);
    const index = Math.max(0, handles.indexOf(picker.handleId));
    const offsetY = handles.length > 1 ? (index - (handles.length - 1) / 2) * 140 : 0;
    const width = source.measured?.width ?? 260;
    addNode(type, { x: source.position.x + width + 90, y: source.position.y + offsetY }, { nodeId: picker.nodeId, handleId: picker.handleId });
  };

  const left = Math.min(picker.x + 12, window.innerWidth - 300);
  const top = Math.min(picker.y - 20, window.innerHeight - 440);

  return (
    <div ref={ref} className="fixed z-50 w-72 rounded-lg border border-slate-200 bg-white shadow-xl" style={{ left, top }}>
      <div className="border-b border-slate-200 p-2">
        <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Add next node…" className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-green-600" />
      </div>
      <div className="max-h-96 overflow-y-auto p-1">
        <NodeTypeList onPick={pick} filter={filter} />
      </div>
    </div>
  );
}
