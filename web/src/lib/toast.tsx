import { create } from "zustand";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let counter = 0;

export function toast(message: string, tone: Tone = "info") {
  const id = ++counter;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, tone, message }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === "error" ? 7000 : 3500);
}

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONES = { success: "border-green-200 text-green-800", error: "border-red-200 text-red-700", info: "border-slate-200 text-slate-700" };

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div key={t.id} className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border bg-white px-3 py-2 text-[13px] shadow-lg ${TONES[t.tone]}`}>
            <Icon size={16} className="mt-0.5 shrink-0" />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
