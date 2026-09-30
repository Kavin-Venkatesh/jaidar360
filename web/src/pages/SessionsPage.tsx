import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Radio } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "../lib/toast";
import type { SessionInfo } from "../lib/types";

// Live conversations (debug view): where each agent is in which flow, their answers so far, and send errors.
export default function SessionsPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionInfo[]>("/sessions/active"), refetchInterval: 5000 });

  const cancel = async (id: string) => {
    if (!window.confirm("Stop this conversation? The agent can say hi to start again.")) return;
    await api(`/sessions/${id}/cancel`, { method: "POST" }).catch((e) => toast((e as Error).message, "error"));
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Live sessions</h1>
        <p className="text-[13px] text-slate-500">Conversations in progress, plus any that hit a WhatsApp error in the last 24 hours. Refreshes every 5 seconds.</p>
      </div>
      <div className="space-y-2">
        {sessions.isLoading && <div className="p-8 text-center text-slate-400"><Loader2 className="inline animate-spin" /></div>}
        {sessions.data?.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-[13px] text-slate-500">
            <Radio className="mx-auto mb-2 text-slate-300" size={28} />
            No live conversations. Message your WhatsApp number “hi” from a registered agent phone to start one.
          </div>
        )}
        {sessions.data?.map((s) => (
          <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-3 text-[13px]">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${s.status === "active" ? "bg-green-500" : "bg-slate-300"}`} />
              <span className="font-medium text-slate-800">{s.agentName}</span>
              {s.agentTeam && <span className="text-[11px] text-slate-400">{s.agentTeam}</span>}
              <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{s.status}</span>
              <span className="ml-auto text-[12px] text-slate-400">updated {new Date(s.updatedAt).toLocaleTimeString()}</span>
              {s.status === "active" && (
                <button type="button" className="btn-secondary" onClick={() => cancel(s.id)}>Stop</button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-slate-600">
              {s.frames.map((f, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-slate-400">{s.frames[i - 1].waiting === "child" ? "calls" : "→"}</span>}
                  <span className="rounded border border-slate-200 px-1.5 py-0.5">
                    {f.flowName} <span className="text-slate-400">v{f.version}</span> · <strong>{f.nodeLabel}</strong>
                  </span>
                </span>
              ))}
            </div>
            {Object.keys(s.vars).length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] text-slate-500">Answers so far ({Object.keys(s.vars).length})</summary>
                <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(s.vars, null, 2)}</pre>
              </details>
            )}
            {s.lastError && (
              <p className="mt-2 flex items-start gap-1 rounded bg-red-50 p-2 text-[12px] text-red-700">
                <AlertCircle size={13} className="mt-0.5 shrink-0" /> {s.lastError}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
