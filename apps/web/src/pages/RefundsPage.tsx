import { useState, type FormEvent } from "react";
import { RefreshCcw } from "lucide-react";
import { Notice, PageTitle } from "../components/Ui";
import { api } from "../lib/api";
import { npr } from "../lib/format";

export function RefundsPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ refundId: string; status: string; amount: number } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await api.post("/merchants/refunds", {
        transactionId: form.get("transactionId"), amount: Number(form.get("amount")), reason: form.get("reason"),
      }, { idempotencyKey, timeoutMs: 30_000 }));
      event.currentTarget.reset();
      setIdempotencyKey(crypto.randomUUID());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Refund failed."); }
    finally { setBusy(false); }
  }

  return <><PageTitle eyebrow="Money movement" title="Issue a refund" description="Full or partial refunds validate merchant ownership, refundable balance, and available merchant demo funds before transferring atomically." /><div className="mx-auto max-w-2xl"><form className="card p-7" onSubmit={submit}>{error && <div className="mb-5"><Notice>{error}</Notice></div>}{result && <div className="mb-5"><Notice tone="success">Refund {result.refundId} completed for {npr(result.amount)}.</Notice></div>}<label className="label">Original transaction ID<input className="input font-mono" name="transactionId" placeholder="NHP-20260921-XXXXXXXXXX" required /></label><label className="label mt-5">Refund amount (NPR)<input className="input" name="amount" type="number" min="0.01" step="0.01" required /></label><label className="label mt-5">Reason<textarea className="input min-h-24" name="reason" minLength={4} maxLength={300} required placeholder="Reason visible in the audit record" /></label><button className="btn-primary mt-6 w-full" disabled={busy}><RefreshCcw size={18} />{busy ? "Processing atomically…" : "Process refund"}</button></form></div></>;
}
