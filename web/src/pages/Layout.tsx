import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Phone } from "lucide-react";
import { api, session } from "../lib/api";
import type { Me } from "../lib/types";

export function RequireAuth() {
  if (!session.token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function Layout() {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), initialData: session.me ?? undefined });
  const tenant = me.data?.tenant;

  const link = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-[13px] font-medium ${isActive ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:text-slate-900"}`;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
        <div className="leading-tight">
          <div className="text-[14px] font-semibold text-slate-800">{tenant?.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <Phone size={10} /> {tenant?.whatsappNumber}
            {tenant && !tenant.whatsappConnected && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">WhatsApp not connected</span>}
          </div>
        </div>
        <nav className="ml-6 flex gap-1">
          <NavLink to="/" end className={link}>Flows</NavLink>
          <NavLink to="/submissions" className={link}>Submissions</NavLink>
          <NavLink to="/sessions" className={link}>Live sessions</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-[13px] text-slate-600">
          {me.data?.user.name}
          <button
            type="button"
            className="icon-btn"
            title="Sign out"
            onClick={() => {
              session.signOut();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
