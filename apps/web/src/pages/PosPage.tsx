import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Hand, LoaderCircle, ReceiptText, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { io } from "socket.io-client";
import { CameraCapture } from "../components/CameraCapture";
import { Notice, PageTitle } from "../components/Ui";
import { api, getToken } from "../lib/api";
import { npr } from "../lib/format";

type Stage = "AMOUNT" | "SCAN" | "CONFIRM" | "PROCESSING" | "SUCCESS" | "FAILED";
interface Payment { id: string; amount: number; state: string; expiresAt: string }
interface Match {
  paymentId: string;
  customerName: string;
  amount: number;
  merchantName: string;
  similarity: number;
  riskLevel: string;
  requiresPin: boolean;
  requiresOtp: boolean;
  confirmationToken: string;
  developmentOtp?: string;
}
interface Result { transactionId: string; remainingBalance: number; amount: number }

export function PosPage() {
  const [stage, setStage] = useState<Stage>("AMOUNT");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [pin, setPin] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [live, setLive] = useState("");
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [processKey, setProcessKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!payment) return;
    const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:4000", { auth: { token: getToken() }, reconnection: true });
    socket.emit("payment:watch", payment.id);
    socket.on("payment:update", (update: { state: string }) => setLive(update.state.replaceAll("_", " ")));
    return () => { socket.disconnect(); };
  }, [payment]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const created = await api.post<Payment>("/payments/requests", {
        amount: Number(form.get("amount")),
        description: form.get("description") || undefined,
        orderReference: form.get("orderReference") || undefined,
      }, { idempotencyKey: createKey });
      setPayment(created); setStage("SCAN");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Request failed."); }
    finally { setBusy(false); }
  }

  async function identify(image: string) {
    if (!payment) return;
    setBusy(true); setError("");
    try {
      const found = await api.post<Match>(`/payments/requests/${payment.id}/identify`, { image });
      setMatch(found); setProcessKey(crypto.randomUUID()); setStage("CONFIRM");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Palm scan failed."); }
    finally { setBusy(false); }
  }

  async function pollStatus() {
    if (!payment) return;
    try {
      const current = await api.get<{ state: string; transactionId?: string; amount: number }>(`/payments/requests/${payment.id}`);
      if (current.state === "SUCCESS" && current.transactionId) {
        setResult({ transactionId: current.transactionId, amount: current.amount, remainingBalance: 0 });
        setStage("SUCCESS");
      } else if (current.state === "PROCESSING") {
        window.setTimeout(() => void pollStatus(), 2_000);
      } else if (["FAILED", "CANCELLED", "EXPIRED"].includes(current.state)) {
        setStage("FAILED"); setError(`Payment ${current.state.toLowerCase()}.`);
      }
    } catch { window.setTimeout(() => void pollStatus(), 2_500); }
  }

  async function decide(decision: "CONFIRM" | "DECLINE") {
    if (!payment || !match) return;
    setBusy(true); setError("");
    if (decision === "CONFIRM") setStage("PROCESSING");
    try {
      const response = await api.post<{ state: string; transactionId?: string; amount: number; remainingBalance: number }>(
        `/payments/requests/${payment.id}/confirm`,
        { confirmationToken: match.confirmationToken, decision, pin: pin || undefined, otp: otp || undefined },
        { idempotencyKey: processKey, timeoutMs: 30_000 },
      );
      if (decision === "DECLINE") { setStage("FAILED"); setError("Customer declined the payment."); }
      else if (response.state === "PROCESSING" || !response.transactionId) { setStage("PROCESSING"); window.setTimeout(() => void pollStatus(), 1_500); }
      else { setResult(response as Result); setStage("SUCCESS"); }
    } catch (caught) { setStage("CONFIRM"); setError(caught instanceof Error ? caught.message : "Confirmation failed."); }
    finally { setBusy(false); }
  }

  function reset() {
    setStage("AMOUNT"); setPayment(null); setMatch(null); setResult(null); setError(""); setPin(""); setOtp(""); setLive("");
    setCreateKey(crypto.randomUUID()); setProcessKey(crypto.randomUUID());
  }

  return <>
    <PageTitle eyebrow="Merchant POS" title="New palm payment" description="Amount → palm scan → recognition → customer confirmation → atomic demo-wallet transfer." />
    {error && <div className="mb-5"><Notice>{error}</Notice></div>}
    <div className="mx-auto max-w-2xl">
      {stage === "AMOUNT" && <form className="card p-7" onSubmit={create}>
        <label className="label">Enter amount (NPR)<div className="relative mt-2"><span className="absolute left-4 top-4 font-semibold text-slate-400">Rs.</span><input name="amount" className="input !mt-0 h-16 pl-14 font-display text-2xl font-bold" type="number" step="0.01" min="0.01" max="1000000" placeholder="650.00" required autoFocus /></div></label>
        <label className="label mt-5">Order / reference ID <span className="font-normal text-slate-400">(optional)</span><input name="orderReference" className="input" maxLength={80} placeholder="ORDER-1042" /></label>
        <label className="label mt-5">Description <span className="font-normal text-slate-400">(optional)</span><input name="description" className="input" maxLength={180} placeholder="Coffee and lunch" /></label>
        <button className="btn-primary mt-7 w-full" disabled={busy}><Hand size={19} />{busy ? "Creating…" : "Request palm payment"}</button>
      </form>}

      {stage === "SCAN" && payment && <div className="card p-6">
        <div className="mb-5 flex items-center justify-between"><div><p className="text-sm text-slate-500">Amount due</p><p className="font-display text-3xl font-bold">{npr(payment.amount)}</p></div><div className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"><LoaderCircle className="size-4 animate-spin" />{live || "Waiting for palm"}</div></div>
        <CameraCapture busy={busy} captureLabel="Scan customer palm" onCapture={(image) => void identify(image)} />
        <button className="btn-secondary mt-4 w-full" onClick={() => void api.post(`/payments/requests/${payment.id}/cancel`).then(reset)}>Cancel payment</button>
      </div>}

      {stage === "CONFIRM" && match && <div className="card overflow-hidden p-0">
        <div className="bg-forest-900 p-7 text-center text-white"><div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-300/15 text-emerald-300"><CheckCircle2 size={30} /></div><p className="mt-4 text-sm text-emerald-50/60">Customer found</p><h2 className="mt-1 text-2xl font-bold text-white">{match.customerName}</h2><p className="mt-2 text-xs text-emerald-100/50">Match confidence {(match.similarity * 100).toFixed(1)}% · Risk {match.riskLevel}</p></div>
        <div className="p-7"><div className="space-y-3 text-sm"><div className="flex justify-between"><span className="text-slate-500">Merchant</span><strong>{match.merchantName}</strong></div><div className="flex justify-between border-t border-slate-100 pt-3"><span className="text-slate-500">Amount</span><strong className="text-xl text-forest-700">{npr(match.amount)}</strong></div></div>
          {match.requiresPin && <label className="label mt-6"><span className="flex items-center gap-2"><ShieldAlert size={16} className="text-amber-600" />Payment PIN required by risk policy</span><input className="input text-center font-mono text-lg tracking-[.4em]" type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="••••" /></label>}
          {match.requiresOtp && <label className="label mt-4">One-time code<input className="input text-center font-mono text-lg tracking-[.35em]" inputMode="numeric" pattern="\d{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} placeholder="000000" />{match.developmentOtp && <span className="mt-2 block text-xs font-normal text-amber-700">Development code: {match.developmentOtp}</span>}</label>}
          <p className="mt-5 text-center text-xs leading-5 text-slate-500">Ask the customer to review the merchant and amount before they choose.</p>
          <div className="mt-5 grid grid-cols-2 gap-3"><button className="btn-secondary" disabled={busy} onClick={() => void decide("DECLINE")}><XCircle size={18} />Decline</button><button className="btn-primary" disabled={busy || (match.requiresPin && pin.length < 4) || (match.requiresOtp && otp.length !== 6)} onClick={() => void decide("CONFIRM")}><CheckCircle2 size={18} />Confirm payment</button></div>
        </div>
      </div>}

      {stage === "PROCESSING" && <div className="card py-16 text-center"><LoaderCircle className="mx-auto size-12 animate-spin text-forest-600" /><h2 className="mt-5 text-xl font-bold">Processing payment</h2><p className="mt-2 text-sm text-slate-500">The server remains authoritative. This screen will recover after a network interruption.</p></div>}
      {stage === "SUCCESS" && result && <div className="card py-10 text-center"><div className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 size={34} /></div><p className="mt-5 text-sm font-semibold uppercase tracking-wider text-forest-600">Payment successful</p><p className="mt-2 font-display text-4xl font-bold">{npr(result.amount)}</p><div className="mx-auto mt-6 max-w-sm rounded-xl bg-slate-50 p-4 text-sm"><p className="text-slate-500">Transaction</p><p className="mt-1 font-mono font-semibold">{result.transactionId}</p></div><div className="mt-6 flex justify-center gap-3"><button className="btn-primary" onClick={() => void api.download(`/transactions/${result.transactionId}/receipt.pdf`, `${result.transactionId}.pdf`)}><ReceiptText size={17} />Download receipt</button><button className="btn-secondary" onClick={reset}><RotateCcw size={17} />New payment</button></div></div>}
      {stage === "FAILED" && <div className="card py-12 text-center"><XCircle className="mx-auto size-12 text-red-500" /><h2 className="mt-4 text-xl font-bold">Payment not completed</h2><button className="btn-primary mt-6" onClick={reset}>Start another payment</button></div>}
    </div>
  </>;
}
