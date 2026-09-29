import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  CreditCard,
  Hand,
  ReceiptText,
  ShieldAlert,
  Store,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { npr, dateTime } from "../lib/format";
import { useLoad } from "../hooks/useLoad";
import {
  Empty,
  Loading,
  Notice,
  PageTitle,
  StatCard,
  Status,
} from "../components/Ui";

export function DashboardPage() {
  const { user } = useAuth();
  if (user?.role === "CUSTOMER") return <CustomerDashboard />;
  if (user?.role === "MERCHANT") return <MerchantDashboard />;
  if (user?.role === "ADMIN") return <AdminDashboard />;
  return <AuditorDashboard />;
}

interface Recent {
  transactionId: string;
  merchantName?: string;
  customerName?: string;
  amount: number;
  status: string;
  createdAt: string;
}
function CustomerDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { data, error, loading } = useLoad(
    () =>
      api.get<{
        balance: number;
        walletStatus: string;
        todaySpending: number;
        monthlySpending: number;
        setup: {
          emailVerified: boolean;
          kycStatus: string;
          paymentPinConfigured: boolean;
          palmEnrolled: boolean;
          progress: number;
        };
        recent: Recent[];
      }>("/analytics/customer-dashboard"),
    [],
  );
  if (loading) return <Loading label="Loading your wallet…" />;
  if (error || !data)
    return <Notice>{error || "Dashboard unavailable."}</Notice>;
  const setupSteps = [
    [t("Email verified"), data.setup.emailVerified],
    [t("KYC approved"), data.setup.kycStatus === "APPROVED"],
    [t("Payment PIN configured"), data.setup.paymentPinConfigured],
    [t("Palm enrollment"), data.setup.palmEnrolled],
  ] as const;
  return (
    <>
      <PageTitle
        eyebrow="Namaste"
        title={t("dashboard.welcome", {
          name: user?.displayName.split(" ")[0],
        })}
        description="Here is a clear view of your demo wallet and recent palm payments."
        action={
          <Link className="btn-primary" to="/app/palm">
            <Hand size={17} />
            {t("Manage palm")}
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          accent
          label="Wallet balance"
          value={npr(data.balance)}
          icon={<Wallet size={20} />}
        />
        <StatCard
          label="Today's spending"
          value={npr(data.todaySpending)}
          icon={<CreditCard size={20} />}
        />
        <StatCard
          label="Monthly spending"
          value={npr(data.monthlySpending)}
          icon={<TrendingUp size={20} />}
        />
        <StatCard
          label="Wallet status"
          value={data.walletStatus}
          icon={<UserCheck size={20} />}
        />
      </div>
      <section className="card mt-6">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{t("Account setup")}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t("Complete verification before using palm payments.")}
                </p>
              </div>
              <strong className="text-forest-700">
                {data.setup.progress}%
              </strong>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-forest-600 transition-all"
                style={{ width: `${data.setup.progress}%` }}
              />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {setupSteps.map(([label, complete]) => (
                <span
                  className={`flex items-center gap-2 text-sm ${complete ? "text-emerald-700" : "text-slate-500"}`}
                  key={label}
                >
                  {complete ? <CheckCircle2 size={16} /> : <Circle size={16} />}{" "}
                  {label}
                </span>
              ))}
            </div>
          </div>
          <Link className="btn-secondary shrink-0" to="/app/onboarding">
            {t("Continue setup")} <ArrowRight size={16} />
          </Link>
        </div>
      </section>
      <section className="card mt-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{t("Recent payments")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("Your latest demo-wallet activity")}
            </p>
          </div>
          <Link
            className="flex items-center gap-1 text-sm font-semibold text-forest-600"
            to="/app/transactions"
          >
            {t("View all")} <ArrowRight size={15} />
          </Link>
        </div>
        <RecentTable items={data.recent} mode="customer" />
      </section>
    </>
  );
}

function MerchantDashboard() {
  const { t } = useTranslation();
  const { data, error, loading } = useLoad(
    () =>
      api.get<{
        merchant: { businessName: string; approvalStatus: string };
        metrics: {
          revenue: number;
          transactions: number;
          customers: number;
          refunds: number;
        };
        chart: { date: string; value: number }[];
        recent: Recent[];
      }>("/merchants/dashboard"),
    [],
  );
  if (loading) return <Loading label="Loading merchant activity…" />;
  if (error || !data)
    return <Notice>{error || "Dashboard unavailable."}</Notice>;
  return (
    <>
      <PageTitle
        eyebrow="Merchant console"
        title={data.merchant.businessName}
        description="Live sales, refunds, and checkout activity for your demo merchant wallet."
        action={
          <Link className="btn-primary" to="/app/pos">
            <Hand size={17} />
            {t("New palm payment")}
          </Link>
        }
      />
      <div className="mb-5">
        <Status value={data.merchant.approvalStatus} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          accent
          label="Today's revenue"
          value={npr(data.metrics.revenue)}
          icon={<TrendingUp size={20} />}
        />
        <StatCard
          label="Transactions"
          value={data.metrics.transactions}
          icon={<ReceiptText size={20} />}
        />
        <StatCard
          label="Customers"
          value={data.metrics.customers}
          icon={<Users size={20} />}
        />
        <StatCard
          label="Refunds"
          value={data.metrics.refunds}
          icon={<CreditCard size={20} />}
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <section className="card">
          <h2 className="text-lg font-bold">{t("Monthly revenue")}</h2>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.chart}>
                <defs>
                  <linearGradient id="merchantArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16835c" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#16835c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e2e8f0"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickFormatter={(v) => `${v / 1000}k`}
                />
                <Tooltip formatter={(v) => npr(Number(v))} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#16835c"
                  strokeWidth={2.5}
                  fill="url(#merchantArea)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2 className="text-lg font-bold">{t("Latest sales")}</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {data.recent.length ? (
              data.recent.map((x) => (
                <div
                  className="flex items-center justify-between gap-3 py-3"
                  key={x.transactionId}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {x.customerName || t("Customer")}
                    </p>
                    <p className="text-xs text-slate-400">
                      {dateTime(x.createdAt)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-forest-700">
                    {npr(x.amount)}
                  </p>
                </div>
              ))
            ) : (
              <Empty
                title="No sales yet"
                detail="Start a palm payment to see activity."
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function AdminDashboard() {
  const { t } = useTranslation();
  const { data, error, loading } = useLoad(
    () =>
      api.get<{
        metrics: Record<string, number>;
        daily: { label: string; value: number }[];
        risk: { name: string; value: number }[];
      }>("/admin/dashboard"),
    [],
  );
  if (loading) return <Loading />;
  if (error || !data)
    return <Notice>{error || "Dashboard unavailable."}</Notice>;
  const m = data.metrics;
  return (
    <>
      <PageTitle
        eyebrow="Platform operations"
        title="Admin dashboard"
        description="Monitor adoption, demo money movement, palm failures, and risk signals."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total users"
          value={m.totalUsers ?? 0}
          icon={<Users size={20} />}
        />
        <StatCard
          label="Active customers"
          value={m.activeCustomers ?? 0}
          icon={<UserCheck size={20} />}
        />
        <StatCard
          label="Merchants"
          value={m.merchants ?? 0}
          icon={<Store size={20} />}
        />
        <StatCard
          accent
          label="Volume today"
          value={npr(m.transactionVolume ?? 0)}
          icon={<TrendingUp size={20} />}
        />
        <StatCard
          label="Payments today"
          value={m.paymentsToday ?? 0}
          icon={<ReceiptText size={20} />}
        />
        <StatCard
          label="Failed payments"
          value={m.failedTransactions ?? 0}
          icon={<Activity size={20} />}
        />
        <StatCard
          label="Failed palm scans"
          value={m.failedPalmScans ?? 0}
          icon={<Hand size={20} />}
        />
        <StatCard
          label="Open risk alerts"
          value={m.suspiciousTransactions ?? 0}
          icon={<ShieldAlert size={20} />}
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_.5fr]">
        <section className="card">
          <h2 className="text-lg font-bold">{t("Daily payment volume")}</h2>
          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daily}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e2e8f0"
                  vertical={false}
                />
                <XAxis dataKey="label" axisLine={false} />
                <YAxis axisLine={false} />
                <Tooltip formatter={(v) => npr(Number(v))} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#16835c"
                  strokeWidth={3}
                  fill="#d5f2e5"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2 className="text-lg font-bold">{t("Risk distribution")}</h2>
          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.risk}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                >
                  {data.risk.map((_, i) => (
                    <Cell
                      key={i}
                      fill={["#16835c", "#f59e0b", "#f97316", "#dc2626"][i % 4]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </>
  );
}

function AuditorDashboard() {
  const { t } = useTranslation();
  return (
    <>
      <PageTitle
        eyebrow="Read-only workspace"
        title="Security & audit overview"
        description="Your auditor role can inspect security events, suspicious payments, administrative activity, and immutable trails. Financial mutation controls are not available."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/app/security"
          className="card transition hover:border-forest-400"
        >
          <ShieldAlert className="text-forest-600" />
          <h2 className="mt-5 text-xl font-bold">{t("Security events")}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {t(
              "Review authentication, palm, account, payment, and system events.",
            )}
          </p>
        </Link>
        <Link
          to="/app/audit"
          className="card transition hover:border-forest-400"
        >
          <ReceiptText className="text-forest-600" />
          <h2 className="mt-5 text-xl font-bold">{t("Audit trail")}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {t("Inspect timestamped actions with actor and target context.")}
          </p>
        </Link>
      </div>
    </>
  );
}

function RecentTable({
  items,
  mode,
}: {
  items: Recent[];
  mode: "customer" | "merchant";
}) {
  const { t } = useTranslation();
  if (!items.length)
    return (
      <Empty
        title="No payments yet"
        detail="Completed and declined payments will appear here."
      />
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400">
          <tr>
            <th className="pb-3 font-semibold">
              {mode === "customer" ? t("Merchant") : t("Customer")}
            </th>
            <th className="pb-3 font-semibold">{t("Amount")}</th>
            <th className="pb-3 font-semibold">{t("Status")}</th>
            <th className="pb-3 font-semibold">{t("Date")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((x) => (
            <tr key={x.transactionId}>
              <td className="py-4 font-semibold text-ink">
                {mode === "customer" ? x.merchantName : x.customerName}
              </td>
              <td className="py-4 font-semibold">{npr(x.amount)}</td>
              <td className="py-4">
                <Status value={x.status} />
              </td>
              <td className="py-4 text-slate-500">{dateTime(x.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
