import { useState, type FormEvent } from "react";
import {
  Activity,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  HeartPulse,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Empty, Loading, Notice, PageTitle, Status } from "../components/Ui";
import { api } from "../lib/api";
import { dateTime, npr } from "../lib/format";
import { useLoad } from "../hooks/useLoad";

interface AdminUser {
  _id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

interface MerchantItem {
  _id: string;
  businessName: string;
  category?: string;
  ownerName?: string;
  registrationNumber?: string;
  panNumber?: string;
  approvalStatus: string;
  rejectionReason?: string;
  submittedAt?: string;
  createdAt: string;
  userId: { email: string; displayName: string };
}

interface KycItem {
  _id: string;
  legalFullName?: string;
  documentType?: string;
  district?: string;
  kycStatus: string;
  rejectionReason?: string;
  submittedAt?: string;
  userId: { _id: string; email: string; displayName: string };
}

interface ServiceHealth {
  ready: boolean;
  checkedAt: string;
  services: Record<string, { status: string; detail: string; latencyMs: number }>;
}

type Tab = "users" | "merchants" | "kyc" | "kyb" | "funds" | "health";

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const users = useLoad(() => api.get<{ items: AdminUser[] }>("/admin/users?limit=100"), []);
  const merchants = useLoad(() => api.get<MerchantItem[]>("/admin/merchants"), []);
  const kyc = useLoad(() => api.get<{ items: KycItem[] }>("/admin/kyc?limit=100"), []);
  const kyb = useLoad(() => api.get<{ items: MerchantItem[] }>("/admin/kyb?limit=100"), []);
  const health = useLoad(() => api.get<ServiceHealth>("/admin/system-health"), []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function userStatus(id: string, status: string) {
    setError("");
    try {
      await api.patch(`/admin/users/${id}/status`, { status });
      setMessage(`User status changed to ${status}. Active sessions were revoked when required.`);
      await users.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    }
  }

  async function merchantStatus(id: string, status: "APPROVED" | "SUSPENDED") {
    setError("");
    try {
      await api.patch(`/admin/merchants/${id}/approval`, { status });
      setMessage(`Merchant status changed to ${status}.`);
      await Promise.all([merchants.reload(), kyb.reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    }
  }

  async function reviewKyc(item: KycItem, status: "APPROVED" | "REJECTED" | "REQUIRES_UPDATE") {
    const reason = reasons[item._id]?.trim();
    if (status !== "APPROVED" && (!reason || reason.length < 5)) {
      setError("Enter a review reason of at least five characters.");
      return;
    }
    setError("");
    try {
      await api.patch(`/admin/kyc/${item.userId._id}/review`, {
        status,
        rejectionReason: status === "APPROVED" ? undefined : reason,
      });
      setMessage(`KYC review completed: ${status}.`);
      await kyc.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "KYC review failed.");
    }
  }

  async function reviewKyb(item: MerchantItem, status: "APPROVED" | "REJECTED") {
    const reason = reasons[item._id]?.trim();
    if (status === "REJECTED" && (!reason || reason.length < 5)) {
      setError("Enter a rejection reason of at least five characters.");
      return;
    }
    setError("");
    try {
      await api.patch(`/admin/kyb/${item._id}/review`, {
        status,
        rejectionReason: status === "REJECTED" ? reason : undefined,
      });
      setMessage(`KYB review completed: ${status}.`);
      await Promise.all([kyb.reload(), merchants.reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "KYB review failed.");
    }
  }

  async function funds(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      const result = await api.post<{ walletId: string; balance: number }>(
        "/admin/demo-funds",
        { userId: form.get("userId"), amount: Number(form.get("amount")) },
        { idempotencyKey: crypto.randomUUID() },
      );
      setMessage(`Funds added. New balance: ${npr(result.balance)}.`);
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Credit failed.");
    }
  }

  const tabs: Array<[Tab, typeof UserRound, string]> = [
    ["users", UserRound, "Users"],
    ["merchants", Building2, "Merchants"],
    ["kyc", ClipboardCheck, "KYC"],
    ["kyb", ShieldCheck, "KYB"],
    ["funds", CircleDollarSign, "Demo funds"],
    ["health", HeartPulse, "System health"],
  ];
  const refreshAll = () => Promise.all([
    users.reload(), merchants.reload(), kyc.reload(), kyb.reload(), health.reload(),
  ]);

  return (
    <>
      <PageTitle
        eyebrow="Administration"
        title="Operations console"
        description="Review users, business verification, demo money controls, and dependency health from one workspace."
      />
      {error && <div className="mb-4"><Notice>{error}</Notice></div>}
      {message && <div className="mb-4"><Notice tone="success">{message}</Notice></div>}
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map(([value, Icon, label]) => (
          <button key={value} className={tab === value ? "btn-primary" : "btn-secondary"} onClick={() => setTab(value)}>
            <Icon size={17} />{label}
          </button>
        ))}
        <button className="btn-secondary ml-auto" onClick={() => void refreshAll()}><RefreshCw size={17} />Refresh</button>
      </div>

      {tab === "users" && (
        users.loading ? <Loading /> : users.data?.items.length ? (
          <div className="card overflow-x-auto p-0"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-400"><tr><th className="px-5 py-4">User</th><th className="px-5 py-4">Role</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Created</th><th className="px-5 py-4">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{users.data.items.map((user) => <tr key={user._id}><td className="px-5 py-4"><p className="font-semibold">{user.displayName}</p><p className="text-xs text-slate-500">{user.email}</p></td><td className="px-5 py-4">{user.role}</td><td className="px-5 py-4"><Status value={user.status} /></td><td className="px-5 py-4 text-slate-500">{dateTime(user.createdAt)}</td><td className="px-5 py-4"><select className="rounded-lg border border-slate-200 px-2 py-2 text-xs" value={user.status} onChange={(event) => void userStatus(user._id, event.target.value)}><option>ACTIVE</option><option>FROZEN</option><option>SUSPENDED</option></select></td></tr>)}</tbody></table></div>
        ) : <Empty title="No users" detail="Registered users will appear here." />
      )}

      {tab === "merchants" && (
        merchants.loading ? <Loading /> : merchants.data?.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{merchants.data.map((merchant) => <article className="card" key={merchant._id}><div className="flex items-start justify-between gap-3"><div className="grid size-10 place-items-center rounded-xl bg-forest-50 text-forest-600"><Building2 size={20} /></div><Status value={merchant.approvalStatus} /></div><h2 className="mt-5 text-lg font-bold">{merchant.businessName}</h2><p className="mt-1 text-sm text-slate-500">{merchant.userId?.email}</p><p className="mt-4 text-xs text-slate-400">Created {dateTime(merchant.createdAt)}</p>{merchant.approvalStatus === "APPROVED" || merchant.approvalStatus === "SUSPENDED" ? <button className="btn-secondary mt-5 w-full" onClick={() => void merchantStatus(merchant._id, merchant.approvalStatus === "SUSPENDED" ? "APPROVED" : "SUSPENDED")}>{merchant.approvalStatus === "SUSPENDED" ? "Restore" : "Suspend"}</button> : <p className="mt-5 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Use the KYB queue to review this merchant.</p>}</article>)}</div>
        ) : <Empty title="No merchants" detail="Merchant applications will appear here." />
      )}

      {tab === "kyc" && (
        kyc.loading ? <Loading /> : kyc.data?.items.length ? <div className="grid gap-4 lg:grid-cols-2">{kyc.data.items.map((item) => <ReviewCard key={item._id} title={item.legalFullName || item.userId.displayName} subtitle={`${item.userId.email} · ${item.documentType || "No document"} · ${item.district || "No district"}`} status={item.kycStatus} submittedAt={item.submittedAt} reason={reasons[item._id] || ""} onReason={(value) => setReasons((current) => ({ ...current, [item._id]: value }))} actions={item.kycStatus === "PENDING" || item.kycStatus === "UNDER_REVIEW" ? <><button className="btn-primary" onClick={() => void reviewKyc(item, "APPROVED")}>Approve</button><button className="btn-secondary" onClick={() => void reviewKyc(item, "REQUIRES_UPDATE")}>Request update</button><button className="btn-danger" onClick={() => void reviewKyc(item, "REJECTED")}>Reject</button></> : undefined} />)}</div> : <Empty title="No KYC cases" detail="Submitted customer identity reviews will appear here." />
      )}

      {tab === "kyb" && (
        kyb.loading ? <Loading /> : kyb.data?.items.length ? <div className="grid gap-4 lg:grid-cols-2">{kyb.data.items.map((item) => <ReviewCard key={item._id} title={item.businessName} subtitle={`${item.ownerName || "Owner missing"} · ${item.registrationNumber || "Registration missing"} · ${item.panNumber || "PAN missing"}`} status={item.approvalStatus} submittedAt={item.submittedAt} reason={reasons[item._id] || ""} onReason={(value) => setReasons((current) => ({ ...current, [item._id]: value }))} actions={item.approvalStatus === "SUBMITTED" || item.approvalStatus === "UNDER_REVIEW" ? <><button className="btn-primary" onClick={() => void reviewKyb(item, "APPROVED")}>Approve</button><button className="btn-danger" onClick={() => void reviewKyb(item, "REJECTED")}>Reject</button></> : undefined} />)}</div> : <Empty title="No KYB cases" detail="Submitted business reviews will appear here." />
      )}

      {tab === "funds" && <form className="card mx-auto max-w-xl" onSubmit={funds}><CircleDollarSign className="size-8 text-forest-600" /><h2 className="mt-4 text-xl font-bold">Credit simulated wallet</h2><p className="mt-2 text-sm leading-6 text-slate-500">This idempotent operation is audited and affects demo money only.</p><label className="label mt-6">Customer user ID<input name="userId" className="input font-mono" required /></label><label className="label mt-4">Amount (NPR)<input name="amount" className="input" type="number" min="0.01" max="1000000" step="0.01" required /></label><button className="btn-primary mt-6 w-full">Add demo funds</button></form>}

      {tab === "health" && (
        health.loading ? <Loading label="Checking dependencies…" /> : health.error || !health.data ? <Notice>{health.error || "Health information is unavailable."}</Notice> : <div><div className="mb-5"><Notice tone={health.data.ready ? "success" : "info"}>{health.data.ready ? "All required services are ready." : "One or more services are degraded or unavailable."}</Notice></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(health.data.services).map(([name, service]) => <article className="card" key={name}><div className="flex items-start justify-between gap-3"><div className="grid size-10 place-items-center rounded-xl bg-forest-50 text-forest-600"><Activity size={19} /></div><Status value={service.status.toUpperCase()} /></div><h2 className="mt-5 font-bold capitalize">{name.replace(/([A-Z])/g, " $1")}</h2><p className="mt-1 text-sm text-slate-500">{service.detail}</p><p className="mt-4 text-xs text-slate-400">{service.latencyMs} ms health latency</p></article>)}</div><p className="mt-4 text-xs text-slate-400">Checked {dateTime(health.data.checkedAt)}</p></div>
      )}
    </>
  );
}

function ReviewCard({ title, subtitle, status, submittedAt, reason, onReason, actions }: { title: string; subtitle: string; status: string; submittedAt?: string; reason: string; onReason(value: string): void; actions?: React.ReactNode }) {
  return <article className="card"><div className="flex items-start justify-between gap-4"><div><h2 className="font-bold text-ink">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div><Status value={status} /></div>{submittedAt && <p className="mt-4 text-xs text-slate-400">Submitted {dateTime(submittedAt)}</p>}{actions && <><label className="label mt-5">Review reason <span className="font-normal text-slate-400">(required for rejection/update)</span><textarea className="input min-h-20" value={reason} onChange={(event) => onReason(event.target.value)} maxLength={500} /></label><div className="mt-4 flex flex-wrap gap-2">{actions}</div></>}</article>;
}
