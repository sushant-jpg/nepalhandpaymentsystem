import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function Notice({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const colors = tone === "error" ? "border-red-200 bg-red-50 text-red-700" : tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-700";
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${colors}`}><Icon className="mt-0.5 size-4 shrink-0" />{children}</div>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-5 animate-spin" />{label}</div>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center"><p className="font-semibold text-slate-700">{title}</p><p className="mt-1 text-sm text-slate-500">{detail}</p></div>;
}

export function Status({ value }: { value: string }) {
  const good = ["SUCCESS", "ACTIVE", "APPROVED", "LOW", "REFUNDED"].includes(value);
  const bad = ["FAILED", "SUSPENDED", "BLOCKED", "FROZEN", "REJECTED"].includes(value);
  return <span className={`status ${good ? "bg-emerald-100 text-emerald-800" : bad ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{value.replaceAll("_", " ")}</span>;
}

export function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div>{eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}<h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}</div>{action}</div>;
}

export function StatCard({ label, value, icon, accent = false }: { label: string; value: string | number; icon: ReactNode; accent?: boolean }) {
  return <div className={`card ${accent ? "border-forest-600 bg-forest-900 text-white" : ""}`}><div className={`mb-5 grid size-10 place-items-center rounded-xl ${accent ? "bg-white/10 text-emerald-300" : "bg-forest-50 text-forest-600"}`}>{icon}</div><p className={`text-sm ${accent ? "text-emerald-100/70" : "text-slate-500"}`}>{label}</p><p className={`mt-1 font-display text-2xl font-bold ${accent ? "text-white" : "text-ink"}`}>{value}</p></div>;
}
