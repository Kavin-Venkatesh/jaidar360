import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Plus, Trash2, Workflow } from "lucide-react";
import { api } from "../lib/api";
import { toast } from "../lib/toast";
import type { FlowDetail, FlowSummary } from "../lib/types";

function StatusBadge({ flow }: { flow: FlowSummary }) {
  const styles = { active: "bg-green-100 text-green-800", inactive: "bg-slate-200 text-slate-700", draft: "bg-amber-100 text-amber-800" };
  const label = { active: "Active", inactive: "Inactive", draft: "Draft" }[flow.status];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[flow.status]}`}>{label}</span>;
}

function NewFlowDialog({ onClose, hasEntry }: { onClose: () => void; hasEntry: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [isEntry, setIsEntry] = useState(!hasEntry);
  const create = useMutation({
    mutationFn: () => api<FlowDetail>("/flows", { method: "POST", body: { name, isEntry } }),
    onSuccess: (flow) => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/flows/${flow.id}`);
    },
    onError: (error) => toast((error as Error).message, "error"),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-5 shadow-xl">
        <h2 className="font-semibold text-slate-800">New flow</h2>
        <label className="block space-y-1">
          <span className="text-[13px] font-medium text-slate-700">Name</span>
          <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Check-in" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={isEntry} disabled={hasEntry} onChange={(e) => setIsEntry(e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-600" />
          <span className="text-[13px] text-slate-700">
            Entry flow
            <span className="block text-[11px] text-slate-500">{hasEntry ? "This tenant already has an entry flow." : "Starts when agents say hi; branches into your other flows."}</span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!name.trim() || create.isPending}>
            {create.isPending && <Loader2 size={14} className="animate-spin" />} Create
          </button>
        </div>
      </form>
    </div>
  );
}

export default function FlowsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const flows = useQuery({ queryKey: ["flows"], queryFn: () => api<FlowSummary[]>("/flows") });

  const duplicate = useMutation({
    mutationFn: (id: string) => api<FlowDetail>(`/flows/${id}/duplicate`, { method: "POST" }),
    onSuccess: (flow) => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/flows/${flow.id}`);
    },
    onError: (error) => toast((error as Error).message, "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/flows/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast("Flow deleted", "info");
    },
    onError: (error) => toast((error as Error).message, "error"),
  });

  const list = flows.data || [];

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Flows</h1>
          <p className="text-[13px] text-slate-500">Each flow is a WhatsApp conversation. The entry flow runs when an agent says hi and links to the others.</p>
        </div>
        <button type="button" className="btn-primary ml-auto" onClick={() => setCreating(true)}>
          <Plus size={15} /> New flow
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Published</th>
              <th className="px-4 py-2 font-medium">Updated</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {flows.isLoading && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400"><Loader2 className="inline animate-spin" /></td>
              </tr>
            )}
            {!flows.isLoading && list.length === 0 && (
              <tr>
                <td colSpan={5} className="p-10 text-center">
                  <Workflow className="mx-auto mb-2 text-slate-300" size={32} />
                  <p className="font-medium text-slate-700">No flows yet</p>
                  <p className="text-slate-500">Create an entry flow first. It's what agents see when they message “hi”.</p>
                </td>
              </tr>
            )}
            {list.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link to={`/flows/${f.id}`} className="font-medium text-slate-800 hover:text-green-700">{f.name}</Link>
                  {f.isEntry && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Entry</span>}
                </td>
                <td className="px-4 py-2.5"><StatusBadge flow={f} /></td>
                <td className="px-4 py-2.5 text-slate-600">
                  {f.activeVersion ? `v${f.activeVersion}` : "—"}
                  {f.hasUnpublishedChanges && <span className="ml-1 text-[11px] text-amber-600">· unpublished changes</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{new Date(f.updatedAt).toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Link to={`/flows/${f.id}`} className="btn-secondary">Open</Link>
                    <button type="button" className="icon-btn" title="Duplicate" onClick={() => duplicate.mutate(f.id)}>
                      <Copy size={15} />
                    </button>
                    {f.activeVersion === null && (
                      <button type="button" className="icon-btn hover:text-red-600" title="Delete draft" onClick={() => window.confirm(`Delete “${f.name}”?`) && remove.mutate(f.id)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && <NewFlowDialog onClose={() => setCreating(false)} hasEntry={list.some((f) => f.isEntry)} />}
    </div>
  );
}
