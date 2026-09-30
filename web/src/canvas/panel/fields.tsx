import { useRef, useState, type ReactNode } from "react";
import { Braces } from "lucide-react";
import { BUILT_IN_VARIABLES, savedVariable, textLength } from "../../lib/rules";
import { useEditor } from "../../store/editorStore";
import type { Problem } from "../../lib/types";

export function useFieldProblems(nodeId: string) {
  const problems = useEditor((s) => s.problemsByNode.get(nodeId));
  return (field: string) => (problems || []).filter((p) => p.field === field || p.field?.startsWith(`${field}.`));
}

export function ProblemText({ problems }: { problems: Problem[] }) {
  if (!problems.length) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {problems.map((p, i) => (
        <p key={i} className={`text-[11px] leading-snug ${p.severity === "error" ? "text-red-600" : "text-amber-600"}`}>
          {p.message}
        </p>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, problems = [] }: { label: string; hint?: ReactNode; children: ReactNode; problems?: Problem[] }) {
  return (
    <div className="space-y-1">
      <div className="text-[12px] font-medium text-slate-700">{label}</div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-slate-500">{hint}</p>}
      <ProblemText problems={problems} />
    </div>
  );
}

export function Counter({ value, max }: { value: string; max: number }) {
  const n = textLength(value);
  return <span className={`text-[11px] tabular-nums ${n > max ? "font-semibold text-red-600" : "text-slate-400"}`}>{n}/{max}</span>;
}

const inputClass = (invalid: boolean) =>
  `w-full rounded-md border px-2 py-1 text-[13px] outline-none focus:ring-2 focus:ring-green-600/20 ${invalid ? "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-green-600"}`;

export function TextInput({ value, onChange, max, placeholder, invalid = false, mono = false }: { value: string; onChange: (v: string) => void; max?: number; placeholder?: string; invalid?: boolean; mono?: boolean }) {
  const over = max !== undefined && textLength(value) > max;
  return (
    <div className="relative">
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${inputClass(invalid || over)} ${max ? "pr-12" : ""} ${mono ? "font-mono" : ""}`} />
      {max !== undefined && (
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
          <Counter value={value ?? ""} max={max} />
        </span>
      )}
    </div>
  );
}

// Variables available in {{ }} placeholders: built-ins, this flow's saved answers, and answers saved by called flows.
export function useVariables() {
  const nodes = useEditor((s) => s.nodes);
  const ctx = useEditor((s) => s.ctx);
  const own = nodes.map((n) => savedVariable(n)).filter(Boolean) as string[];
  const called = nodes
    .filter((n) => n.type === "executeFlow" && n.data.mode === "call")
    .flatMap((n) => ctx?.tenantFlows.find((f) => f.id === n.data.targetFlowId)?.saves || []);
  return { saved: [...new Set([...own, ...called])], builtIn: BUILT_IN_VARIABLES };
}

export function VariablePicker({ onPick }: { onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const { saved, builtIn } = useVariables();
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-700" title="Insert a variable">
        <Braces size={12} /> Variable
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-60 w-52 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
          {[...saved.map((v) => ({ v, group: "Saved answers" })), ...builtIn.map((v) => ({ v, group: "Built-in" }))].map(({ v, group }, i, all) => (
            <div key={v}>
              {(i === 0 || all[i - 1].group !== group) && <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group}</div>}
              <button
                type="button"
                className="block w-full px-2 py-1 text-left font-mono text-[12px] hover:bg-green-50"
                onClick={() => {
                  onPick(v);
                  setOpen(false);
                }}
              >
                {`{{${v}}}`}
              </button>
            </div>
          ))}
          {!saved.length && <div className="px-2 py-1 text-[11px] text-slate-400">No saved answers yet</div>}
        </div>
      )}
    </div>
  );
}

export function TextArea({ value, onChange, max, placeholder, rows = 3, invalid = false, variables = true }: { value: string; onChange: (v: string) => void; max?: number; placeholder?: string; rows?: number; invalid?: boolean; variables?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const over = max !== undefined && textLength(value) > max;
  const insert = (name: string) => {
    const el = ref.current;
    const token = `{{${name}}}`;
    const current = value ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    onChange(current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div>
      <textarea ref={ref} value={value ?? ""} rows={rows} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${inputClass(invalid || over)} resize-y leading-snug`} />
      <div className="flex items-center justify-between">
        {variables ? <VariablePicker onPick={insert} /> : <span />}
        {max !== undefined && <Counter value={value ?? ""} max={max} />}
      </div>
    </div>
  );
}

export function Select({ value, onChange, options, invalid = false }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; invalid?: boolean }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={`${inputClass(invalid)} bg-white`}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-600" />
      <span>
        <span className="block text-[13px] text-slate-700">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
