import { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { useEditor } from "../store/editorStore";

export function ProblemsBar() {
  const problems = useEditor((s) => s.problems);
  const nodes = useEditor((s) => s.nodes);
  const select = useEditor((s) => s.select);
  const { setCenter, getZoom } = useReactFlow();
  const [open, setOpen] = useState(true);

  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");
  const sorted = [...errors, ...warnings];

  const focus = (nodeId: string | null) => {
    const node = nodeId && nodes.find((n) => n.id === nodeId);
    if (!node) return;
    select(node.id);
    useEditor.setState({ nodes: useEditor.getState().nodes.map((n) => ({ ...n, selected: n.id === node.id })) });
    setCenter(node.position.x + (node.measured?.width ?? 240) / 2, node.position.y + (node.measured?.height ?? 100) / 2, { zoom: Math.max(getZoom(), 0.9), duration: 300 });
  };

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50">
        {sorted.length === 0 ? (
          <span className="flex items-center gap-1 text-green-700">
            <CheckCircle2 size={14} /> No problems. Ready to publish.
          </span>
        ) : (
          <>
            <span>Problems ({sorted.length})</span>
            {errors.length > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <AlertCircle size={13} /> {errors.length}
              </span>
            )}
            {warnings.length > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle size={13} /> {warnings.length}
              </span>
            )}
          </>
        )}
        <span className="ml-auto">{sorted.length > 0 && (open ? <ChevronDown size={14} /> : <ChevronUp size={14} />)}</span>
      </button>
      {open && sorted.length > 0 && (
        <ul className="max-h-36 overflow-y-auto border-t border-slate-100 text-[13px]">
          {sorted.map((p, i) => {
            const node = p.nodeId ? nodes.find((n) => n.id === p.nodeId) : null;
            return (
              <li key={i}>
                <button type="button" onClick={() => focus(p.nodeId)} className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-slate-50">
                  {p.severity === "error" ? <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />}
                  {node && <span className="shrink-0 font-medium text-slate-700">{node.data.label || node.type}:</span>}
                  <span className="text-slate-600">{p.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
