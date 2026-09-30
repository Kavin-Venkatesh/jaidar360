import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, session } from "../lib/api";
import type { Me } from "../lib/types";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session.token) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ token: string } & Me>("/auth/login", { method: "POST", body: { username, password } });
      session.signIn(res.token, { user: res.user, tenant: res.tenant });
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mb-3 h-9 w-9" />
          <h1 className="text-lg font-semibold text-slate-800">WhatsApp Flow Builder</h1>
          <p className="text-[13px] text-slate-500">Sign in to design your team's WhatsApp flows.</p>
        </div>
        <label className="block space-y-1">
          <span className="text-[13px] font-medium text-slate-700">Username</span>
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600/20" />
        </label>
        <label className="block space-y-1">
          <span className="text-[13px] font-medium text-slate-700">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600/20" />
        </label>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <button type="submit" disabled={loading || !username || !password} className="btn-primary w-full justify-center py-2">
          {loading && <Loader2 size={14} className="animate-spin" />} Sign in
        </button>
      </form>
    </div>
  );
}
