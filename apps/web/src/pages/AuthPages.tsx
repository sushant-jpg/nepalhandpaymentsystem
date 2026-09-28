import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Building2,
  Eye,
  EyeOff,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Notice } from "../components/Ui";
import { useAuth } from "../context/AuthContext";
import { useBackendHealth } from "../hooks/useBackendHealth";
import { api, ApiError } from "../lib/api";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const backend = useBackendHealth();
  const [email, setEmail] = useState(
    params.get("role") === "merchant" ? "merchant@demo.local" : "",
  );
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/app" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      navigate("/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title="Welcome back"
      detail="Sign in to your secure Nepal Hand Pay workspace."
    >
      <form className="space-y-5" onSubmit={submit}>
        {backend.status === "unavailable" && (
          <Notice>
            <span>
              We cannot reach the Nepal Hand Pay API. Check that the server is
              running, then{" "}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => void backend.check()}
              >
                try again
              </button>
              .
            </span>
          </Notice>
        )}
        {error && <Notice>{error}</Notice>}
        <label className="label">
          Email address
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="label">
          Password
          <div className="relative">
            <input
              className="input pr-12"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="absolute right-2 top-3.5 rounded-lg p-2 text-slate-500"
              onClick={() => setShow(!show)}
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        <div className="flex items-center justify-between gap-3">
          <span
            role="status"
            className={`text-xs ${backend.status === "available" ? "text-emerald-700" : "text-slate-400"}`}
          >
            API {backend.status}
          </span>
          <Link
            to="/forgot-password"
            className="text-sm font-semibold text-forest-600"
          >
            Forgot password?
          </Link>
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-sm text-slate-500">
          New to Nepal Hand Pay?{" "}
          <Link to="/register" className="font-semibold text-forest-600">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState<"CUSTOMER" | "MERCHANT">(
    params.get("role") === "merchant" ? "MERCHANT" : "CUSTOMER",
  );
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/app" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      const email = String(form.get("email") ?? "");
      const verificationToken = await register({
        role,
        displayName: form.get("name"),
        email,
        phone: form.get("phone") || undefined,
        businessName:
          role === "MERCHANT" ? form.get("businessName") : undefined,
        password: form.get("password"),
      });
      const search = new URLSearchParams({ email });
      if (verificationToken) search.set("token", verificationToken);
      navigate(`/verify-email?${search.toString()}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "VALIDATION_ERROR") {
        const fields = e.details?.fieldErrors ?? {};
        setFieldErrors({
          name: fields.displayName?.join(" ") ?? "",
          businessName: fields.businessName?.join(" ") ?? "",
          email: fields.email?.join(" ") ?? "",
          phone: fields.phone?.join(" ") ?? "",
          password: fields.password?.join(" ") ?? "",
        });
      }
      setError(e instanceof Error ? e.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title="Create your account"
      detail="Start with a simulated wallet. No real money is processed."
    >
      <form className="space-y-4" onSubmit={submit}>
        {error && <Notice>{error}</Notice>}
        <fieldset>
          <legend className="label mb-2">Account type</legend>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["CUSTOMER", UserRound, "Customer"],
              ["MERCHANT", Building2, "Merchant"],
            ].map(([value, Icon, label]) => {
              const I = Icon as typeof UserRound;
              return (
                <button
                  type="button"
                  key={value as string}
                  onClick={() => setRole(value as typeof role)}
                  className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold ${role === value ? "border-forest-600 bg-forest-50 text-forest-700" : "border-slate-200"}`}
                >
                  <I size={18} />
                  {label as string}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="label">
          Full name
          <input
            className={`input ${fieldErrors.name ? "border-red-500" : ""}`}
            name="name"
            minLength={2}
            required
            autoComplete="name"
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
          />
          {fieldErrors.name && <span id="name-error" className="mt-1 block text-xs font-normal text-red-600">{fieldErrors.name}</span>}
        </label>
        {role === "MERCHANT" && (
          <label className="label">
            Business name
            <input
              className={`input ${fieldErrors.businessName ? "border-red-500" : ""}`}
              name="businessName"
              minLength={2}
              required
              aria-invalid={Boolean(fieldErrors.businessName)}
              aria-describedby={fieldErrors.businessName ? "business-name-error" : undefined}
            />
            {fieldErrors.businessName && <span id="business-name-error" className="mt-1 block text-xs font-normal text-red-600">{fieldErrors.businessName}</span>}
          </label>
        )}
        <label className="label">
          Email address
          <input
            className={`input ${fieldErrors.email ? "border-red-500" : ""}`}
            name="email"
            type="email"
            required
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />
          {fieldErrors.email && <span id="email-error" className="mt-1 block text-xs font-normal text-red-600">{fieldErrors.email}</span>}
        </label>
        <label className="label">
          Phone <span className="font-normal text-slate-400">(optional)</span>
          <input
            className={`input ${fieldErrors.phone ? "border-red-500" : ""}`}
            name="phone"
            type="tel"
            autoComplete="tel"
            aria-invalid={Boolean(fieldErrors.phone)}
            aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
          />
          {fieldErrors.phone && <span id="phone-error" className="mt-1 block text-xs font-normal text-red-600">{fieldErrors.phone}</span>}
        </label>
        <label className="label">
          Password
          <input
            className={`input ${fieldErrors.password ? "border-red-500" : ""}`}
            name="password"
            type="password"
            minLength={10}
            maxLength={128}
            pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,128}"
            title="Use at least 10 characters, including uppercase, lowercase, and a number."
            required
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "password-error" : "password-help"}
          />
          {fieldErrors.password && <span id="password-error" className="mt-1 block text-xs font-normal text-red-600">{fieldErrors.password}</span>}
          <span id="password-help" className="mt-1.5 block text-xs font-normal text-slate-400">
            At least 10 characters with uppercase, lowercase, and a number.
          </span>
        </label>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="text-center text-xs leading-5 text-slate-500">
          By continuing, you acknowledge this is an educational demo. Biometric
          consent is requested separately during palm enrollment.
        </p>
      </form>
    </AuthShell>
  );
}

function AuthShell({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[.9fr_1.1fr]">
      <section className="flex flex-col px-5 py-6 sm:px-12 lg:px-16">
        <div className="flex items-center justify-between">
          <Brand />
          <Link
            className="flex items-center gap-1 text-sm text-slate-500"
            to="/"
          >
            <ArrowLeft size={16} />
            Home
          </Link>
        </div>
        <div className="mx-auto my-auto w-full max-w-md py-12">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mb-8 mt-2 text-sm leading-6 text-slate-500">{detail}</p>
          {children}
        </div>
      </section>
      <aside className="relative hidden overflow-hidden bg-forest-900 lg:grid lg:place-items-center">
        <div className="absolute inset-0 hero-grid opacity-20" />
        <div className="relative max-w-lg p-12 text-white">
          <div className="grid size-16 place-items-center rounded-2xl bg-white/10">
            <ShieldCheck className="size-8 text-emerald-300" />
          </div>
          <h2 className="mt-8 text-4xl font-bold leading-tight text-white">
            A faster checkout starts with a safer architecture.
          </h2>
          <p className="mt-5 leading-7 text-emerald-50/60">
            Biometric identity, payment authorization, risk decisions, and
            wallet movement remain separate responsibilities.
          </p>
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/[.06] p-5 text-sm text-emerald-50/70">
            <strong className="block text-white">
              Prototype Palm Recognition
            </strong>
            <span className="mt-1 block">
              Uses ordinary RGB cameras for demonstration—not financial-grade
              vein hardware.
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [developmentToken, setDevelopmentToken] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{
        message: string;
        developmentResetToken?: string;
      }>("/auth/forgot-password", {
        email: new FormData(e.currentTarget).get("email"),
      });
      setMessage(result.message);
      setDevelopmentToken(result.developmentResetToken ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title="Reset your password"
      detail="Request a short-lived password reset token."
    >
      <form onSubmit={submit} className="space-y-4">
        {message && <Notice tone="success">{message}</Notice>}
        {error && <Notice>{error}</Notice>}
        <label className="label">
          Email address
          <input name="email" type="email" className="input" required />
        </label>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating request…" : "Create reset request"}
        </button>
        {developmentToken && (
          <Link
            className="btn-secondary w-full"
            to={`/reset-password?token=${encodeURIComponent(developmentToken)}`}
          >
            Continue with development token
          </Link>
        )}
        <Link className="btn-secondary w-full" to="/login">
          Back to login
        </Link>
      </form>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== form.get("confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/reset-password", {
        token: form.get("token"),
        password: newPassword,
      });
      navigate("/login", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Password reset failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title="Choose a new password"
      detail="Reset tokens expire after one hour and can be used only once."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice>{error}</Notice>}
        <label className="label">
          Reset token
          <input
            name="token"
            className="input font-mono text-xs"
            defaultValue={params.get("token") ?? ""}
            minLength={20}
            required
          />
        </label>
        <label className="label">
          New password
          <input
            name="password"
            type="password"
            className="input"
            minLength={10}
            autoComplete="new-password"
            required
          />
        </label>
        <label className="label">
          Confirm new password
          <input
            name="confirmPassword"
            type="password"
            className="input"
            minLength={10}
            autoComplete="new-password"
            required
          />
        </label>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Resetting…" : "Reset password"}
        </button>
        <Link className="btn-secondary w-full" to="/login">
          Back to login
        </Link>
      </form>
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const { user, refreshUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [email, setEmail] = useState(params.get("email") ?? user?.email ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/verify-email", { token });
      await refreshUser();
      navigate("/app", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{
        message: string;
        developmentVerificationToken?: string;
      }>("/auth/resend-verification", { email });
      setMessage(result.message);
      if (result.developmentVerificationToken)
        setToken(result.developmentVerificationToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Verify your email"
      detail="Email verification protects account recovery and security notifications."
    >
      <form className="space-y-4" onSubmit={verify}>
        {message && <Notice tone="success">{message}</Notice>}
        {error && <Notice>{error}</Notice>}
        <label className="label">
          Email address
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="label">
          Verification token
          <input
            className="input font-mono text-xs"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            minLength={20}
            required
          />
        </label>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Verifying…" : "Verify email"}
        </button>
        <button
          type="button"
          className="btn-secondary w-full"
          disabled={busy || !email}
          onClick={() => void resend()}
        >
          Resend verification
        </button>
        <p className="text-center text-xs leading-5 text-slate-500">
          Development mode returns the token here. Production requires a
          configured email delivery provider.
        </p>
      </form>
    </AuthShell>
  );
}
