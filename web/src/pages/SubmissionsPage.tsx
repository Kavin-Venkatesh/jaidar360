import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Inbox, Loader2, MapPin } from "lucide-react";
import { api, fileUrl } from "../lib/api";
import type { FlowSummary, Submission } from "../lib/types";

type Value = unknown;

function isMedia(v: Value): v is { path?: string; mimeType?: string; kind?: string; caption?: string; error?: string } {
  return typeof v === "object" && v !== null && "mediaId" in v;
}
function isLocation(v: Value): v is { latitude: number; longitude: number; name?: string; address?: string; flagged?: boolean; source?: string; accuracy?: number | null } {
  return typeof v === "object" && v !== null && "latitude" in v && "longitude" in v;
}

function AnswerValue({ value }: { value: Value }) {
  if (value === null || value === undefined || value === "") return <span className="text-slate-400">—</span>;
  if (isMedia(value)) {
    if (!value.path) return <span className="text-red-600">Download failed{value.error ? `: ${value.error}` : ""}</span>;
    const url = fileUrl(value.path);
    const image = value.kind === "image" || value.mimeType?.startsWith("image/");
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-green-700 underline">
        {image ? <img src={url} alt="" className="h-16 w-16 rounded border border-slate-200 object-cover" /> : "Open document"}
        {value.caption && <span className="text-slate-600 no-underline">{value.caption}</span>}
      </a>
    );
  }
  if (isLocation(value)) {
    return (
      <span className="inline-flex items-center gap-2">
        <a href={`https://maps.google.com/?q=${value.latitude},${value.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 underline">
          <MapPin size={13} /> {value.name || value.address || `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}`}
        </a>
        {value.source === "browser" && <span className="text-[11px] text-slate-500">browser GPS{typeof value.accuracy === "number" ? ` ±${value.accuracy} m` : ""}</span>}
        {value.flagged &&
          (value.source === "browser" ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="Browser GPS accuracy was worse than 100 m">low accuracy</span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="The agent picked a place instead of sharing live GPS">picked place</span>
          ))}
      </span>
    );
  }
  if (typeof value === "object") return <code className="text-[12px]">{JSON.stringify(value)}</code>;
  return <>{String(value)}</>;
}

export default function SubmissionsPage() {
  const [page, setPage] = useState(1);
  const [flowId, setFlowId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const flows = useQuery({ queryKey: ["flows"], queryFn: () => api<FlowSummary[]>("/flows") });
  const subs = useQuery({
    queryKey: ["submissions", page, flowId],
    queryFn: () => api<{ items: Submission[]; total: number; pageSize: number }>(`/submissions?page=${page}${flowId ? `&flowId=${flowId}` : ""}`),
    refetchInterval: 15000,
  });
  const pages = subs.data ? Math.max(1, Math.ceil(subs.data.total / subs.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-end gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Submissions</h1>
          <p className="text-[13px] text-slate-500">Completed conversations and the answers agents gave.</p>
        </div>
        <select
          value={flowId}
          onChange={(e) => {
            setFlowId(e.target.value);
            setPage(1);
          }}
          className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px]"
        >
          <option value="">All flows</option>
          {flows.data?.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="w-8" />
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Flow</th>
              <th className="px-3 py-2 font-medium">Answers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subs.isLoading && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400"><Loader2 className="inline animate-spin" /></td></tr>
            )}
            {subs.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-10 text-center text-slate-500">
                  <Inbox className="mx-auto mb-2 text-slate-300" size={32} />
                  No submissions yet. They appear when an agent reaches an End node.
                </td>
              </tr>
            )}
            {subs.data?.items.map((s) => {
              const expanded = open === s.id;
              const entries = Object.entries(s.data);
              return (
                <Fragment key={s.id}>
                  <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(expanded ? null : s.id)}>
                    <td className="pl-3 text-slate-400">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {s.agentName}
                      {s.agentTeam && <span className="ml-1 text-[11px] text-slate-400">{s.agentTeam}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {s.flowName} <span className="text-[11px] text-slate-400">v{s.flowVersion}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{entries.length} answer{entries.length === 1 ? "" : "s"}</td>
                  </tr>
                  {expanded && (
                    <tr className="bg-slate-50/60">
                      <td />
                      <td colSpan={4} className="px-3 py-3">
                        <dl className="grid grid-cols-[minmax(140px,max-content)_1fr] gap-x-6 gap-y-2">
                          {entries.map(([k, v]) => (
                            <Fragment key={k}>
                              <dt className="font-mono text-[12px] text-slate-500">{k}</dt>
                              <dd><AnswerValue value={v} /></dd>
                            </Fragment>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-[13px]">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="text-slate-500">Page {page} of {pages}</span>
          <button type="button" className="btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
