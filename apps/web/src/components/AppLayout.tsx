import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { BarChart3, Bell, ClipboardCheck, CreditCard, FileSearch, Hand, History, LayoutDashboard, LogOut, Menu, ReceiptText, RefreshCcw, ScanLine, Settings, ShieldCheck, Store, UserRound, Users, Wallet, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Role } from "@nepal-hand-pay/shared-types";
import { useAuth } from "../context/AuthContext";
import { Brand } from "./Brand";
import { io } from "socket.io-client";
import { api, getToken } from "../lib/api";
import { SOCKET_URL } from "../lib/runtime-config";
import { dateTime } from "../lib/format";

const nav: Record<Role, { to: string; label: string; icon: typeof Hand }[]> = {
  CUSTOMER: [
    { to: "/app", label: "Dashboard", icon: LayoutDashboard }, { to: "/app/wallet", label: "Wallet", icon: Wallet },
    { to: "/app/transactions", label: "Pay history", icon: History }, { to: "/app/palm", label: "My palm", icon: Hand },
    { to: "/app/onboarding", label: "Identity verification", icon: ClipboardCheck },
    { to: "/app/security", label: "Security", icon: ShieldCheck }, { to: "/app/profile", label: "Profile", icon: UserRound },
  ],
  MERCHANT: [
    { to: "/app", label: "Dashboard", icon: LayoutDashboard }, { to: "/app/pos", label: "New payment", icon: ScanLine },
    { to: "/app/transactions", label: "Transactions", icon: ReceiptText }, { to: "/app/refunds", label: "Refunds", icon: RefreshCcw },
    { to: "/app/onboarding", label: "Business verification", icon: ClipboardCheck },
    { to: "/app/security", label: "Security", icon: ShieldCheck }, { to: "/app/profile", label: "Settings", icon: Settings },
  ],
  ADMIN: [
    { to: "/app", label: "Dashboard", icon: BarChart3 }, { to: "/app/admin", label: "Users & merchants", icon: Users },
    { to: "/app/transactions", label: "Transactions", icon: CreditCard }, { to: "/app/security", label: "Palm & risk events", icon: ShieldCheck },
    { to: "/app/audit", label: "Audit logs", icon: FileSearch }, { to: "/app/profile", label: "Configuration", icon: Settings },
  ],
  AUDITOR: [
    { to: "/app", label: "Security overview", icon: ShieldCheck }, { to: "/app/security", label: "Security events", icon: Bell },
    { to: "/app/transactions", label: "Transactions", icon: CreditCard }, { to: "/app/audit", label: "Audit trail", icon: FileSearch },
  ],
};

interface NotificationItem {
  _id: string;
  title: string;
  message: string;
  category?: string;
  severity?: string;
  readAt?: string;
  createdAt: string;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{
        items: NotificationItem[];
        unreadCount: number;
      }>("/users/notifications?limit=6");
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // The containing session/error flow remains authoritative.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const socket = io(SOCKET_URL, {
      auth: { token: getToken() },
      reconnection: true,
    });
    socket.on("notification:new", () => void refresh());
    return () => {
      socket.disconnect();
    };
  }, [refresh]);

  async function markRead(item: NotificationItem) {
    if (!item.readAt) {
      await api.patch(`/users/notifications/${item._id}/read`, {});
      await refresh();
    }
  }

  async function markAllRead() {
    await api.post("/users/notifications/read-all");
    await refresh();
  }

  return (
    <div className="relative">
      <button
        className="relative grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white">
            {Math.min(unreadCount, 99)}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-ink">Notifications</p>
              <p className="text-xs text-slate-500">{unreadCount} unread</p>
            </div>
            {unreadCount > 0 && (
              <button
                className="text-xs font-semibold text-forest-600"
                onClick={() => void markAllRead()}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items.length ? (
              items.map((item) => (
                <button
                  key={item._id}
                  className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${item.readAt ? "" : "bg-forest-50/60"}`}
                  onClick={() => void markRead(item)}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm font-semibold text-ink">{item.title}</span>
                    {!item.readAt && <span className="mt-1 size-2 shrink-0 rounded-full bg-forest-600" />}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{item.message}</span>
                  <span className="mt-1.5 block text-[11px] text-slate-400">{dateTime(item.createdAt)}</span>
                </button>
              ))
            ) : (
              <p className="px-5 py-10 text-center text-sm text-slate-500">You are all caught up.</p>
            )}
          </div>
          <NavLink
            to="/app/notifications"
            className="block border-t border-slate-100 px-4 py-3 text-center text-xs font-semibold text-forest-600"
            onClick={() => setOpen(false)}
          >
            View all notifications
          </NavLink>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth(); const navigate = useNavigate(); const [open, setOpen] = useState(false); const [online,setOnline]=useState(()=>navigator.onLine); const { i18n } = useTranslation();
  useEffect(()=>{const connected=()=>setOnline(true);const disconnected=()=>setOnline(false);window.addEventListener("online",connected);window.addEventListener("offline",disconnected);return()=>{window.removeEventListener("online",connected);window.removeEventListener("offline",disconnected)}},[]);
  if (!user) return null;
  const signOut = async () => { await logout(); navigate("/"); };
  return <div className="min-h-screen bg-[#f6faf8] lg:grid lg:grid-cols-[260px_1fr]">
    {open && <button className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation overlay" />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col bg-forest-900 px-4 py-5 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-2"><Brand light /><button className="rounded-lg p-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button></div>
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[.06] p-3"><p className="truncate text-sm font-semibold">{user.displayName}</p><p className="mt-0.5 truncate text-xs text-emerald-100/60">{user.email}</p><span className="mt-2 inline-flex rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] font-bold tracking-wider text-emerald-300">{user.role}</span></div>
      <nav className="mt-6 flex-1 space-y-1" aria-label="Dashboard navigation">{(nav[user.role] ?? []).map(({ to, label, icon: Icon }) => <NavLink key={to} end={to === "/app"} to={to} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${isActive ? "bg-white text-forest-900" : "text-emerald-50/70 hover:bg-white/10 hover:text-white"}`}><Icon size={18} />{label}</NavLink>)}</nav>
      <button className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-emerald-50/70 hover:bg-white/10 hover:text-white" onClick={() => void signOut()}><LogOut size={18} />Sign out</button>
    </aside>
    <main className="min-w-0">
      {!online&&<div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900">You are offline. Financial writes will not be retried without their idempotency key.</div>}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200/70 bg-[#f6faf8]/90 px-4 backdrop-blur-xl sm:px-7"><button className="rounded-lg p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button><div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex"><Store size={15} className="text-forest-600" />Demo wallet environment</div><div className="flex items-center gap-2"><NotificationBell/><button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold" onClick={() => { const lang = i18n.language === "en" ? "ne" : "en"; void i18n.changeLanguage(lang); localStorage.setItem("nhp_language", lang); }}>{i18n.language === "en" ? "नेपाली" : "English"}</button><div className="grid size-9 place-items-center rounded-full bg-forest-100 text-sm font-bold text-forest-700">{user.displayName.charAt(0)}</div></div></header>
      <div className="mx-auto max-w-[1480px] p-4 sm:p-7 lg:p-9"><Outlet /></div>
    </main>
  </div>;
}
