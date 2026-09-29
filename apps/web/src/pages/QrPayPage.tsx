import { useCallback, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  QrCode as QrIcon,
  ReceiptText,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  parseQrPayload,
  type QrPaymentRequestView,
} from "@nepal-hand-pay/shared-types";
import { useTranslation } from "react-i18next";
import { QrScanner } from "../components/QrScanner";
import { Notice, PageTitle, Status } from "../components/Ui";
import { api, ApiError } from "../lib/api";
import { dateTime, npr } from "../lib/format";

type Stage = "SCAN" | "STATIC_AMOUNT" | "REVIEW" | "RECEIPT";

interface MerchantQrView {
  merchantId: string;
  merchantName: string;
  currency: "NPR";
}

interface ConfirmationResult {
  state: string;
  requiresPin?: boolean;
  requiresOtp?: boolean;
  developmentOtp?: string;
  transactionId?: string;
  merchantName?: string;
  amountMinor?: number;
  feeMinor?: number;
  totalMinor?: number;
  currency?: "NPR";
  orderReference?: string;
  requestId?: string;
  paymentMethod?: "QR";
  completedAt?: string;
  remainingBalanceMinor?: number;
}

function key(): string {
  return crypto.randomUUID();
}

export function QrPayPage() {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("SCAN");
  const [request, setRequest] = useState<QrPaymentRequestView | null>(null);
  const [merchant, setMerchant] = useState<MerchantQrView | null>(null);
  const [result, setResult] = useState<ConfirmationResult | null>(null);
  const [pin, setPin] = useState("");
  const [otp, setOtp] = useState("");
  const [requiresPin, setRequiresPin] = useState(false);
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [developmentOtp, setDevelopmentOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createKey, setCreateKey] = useState(key);
  const [confirmKey, setConfirmKey] = useState(key);
  const [scannerKey, setScannerKey] = useState(0);

  const scanned = useCallback(async (raw: string) => {
    setBusy(true);
    setError("");
    try {
      const payload = parseQrPayload(raw);
      if (payload.type === "merchant") {
        const details = await api.get<MerchantQrView>(
          `/qr/merchants/${payload.merchantId}`,
        );
        setMerchant(details);
        setStage("STATIC_AMOUNT");
        return;
      }
      const details = await api.get<QrPaymentRequestView>(
        `/qr/payment-requests/${payload.paymentRequestId}`,
      );
      if (details.merchantId !== payload.merchantId)
        throw new Error(t("qr.merchantMismatch"));
      if (!["CREATED", "AWAITING_CONFIRMATION", "AWAITING_PIN"].includes(details.state))
        throw new Error(
          details.state === "EXPIRED"
            ? t("qr.expired")
            : details.state === "CANCELLED"
              ? t("qr.cancelled")
              : t("qr.alreadyUsed"),
        );
      setRequest(details);
      setStage("REVIEW");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("qr.invalid"),
      );
    } finally {
      setBusy(false);
    }
  }, [t]);

  async function createStaticRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!merchant) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const amountMinor = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount <= 0 || amountMinor / 100 !== amount) {
      setError(t("qr.invalidAmount"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api.post<QrPaymentRequestView>(
        "/qr/merchant-payment-requests",
        {
          merchantId: merchant.merchantId,
          amountMinor,
          currency: "NPR",
          description: String(form.get("description") || "") || undefined,
          orderReference:
            String(form.get("orderReference") || "") || undefined,
          expiresInSeconds: 300,
        },
        { idempotencyKey: createKey },
      );
      setRequest(created);
      setConfirmKey(key());
      setStage("REVIEW");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("qr.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(decision: "CONFIRM" | "DECLINE") {
    if (!request || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post<ConfirmationResult>(
        `/qr/payment-requests/${request.id}/confirm`,
        {
          decision,
          pin: pin || undefined,
          otp: otp || undefined,
        },
        { idempotencyKey: confirmKey, timeoutMs: 35_000 },
      );
      if (decision === "DECLINE") {
        setError(t("qr.cancelled"));
        reset();
        return;
      }
      if (response.state === "AWAITING_CONFIRMATION") {
        setRequiresPin(Boolean(response.requiresPin));
        setRequiresOtp(Boolean(response.requiresOtp));
        if (response.developmentOtp) setDevelopmentOtp(response.developmentOtp);
        return;
      }
      if (response.state === "SUCCESS" && response.transactionId) {
        setResult(response);
        setStage("RECEIPT");
        return;
      }
      throw new Error(t("qr.processingUnknown"));
    } catch (caught) {
      const message =
        caught instanceof ApiError && caught.requestId
          ? `${caught.message} (${t("qr.requestId")}: ${caught.requestId})`
          : caught instanceof Error
            ? caught.message
            : t("qr.paymentFailed");
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("SCAN");
    setRequest(null);
    setMerchant(null);
    setResult(null);
    setPin("");
    setOtp("");
    setRequiresPin(false);
    setRequiresOtp(false);
    setDevelopmentOtp("");
    setError("");
    setCreateKey(key());
    setConfirmKey(key());
    setScannerKey((value) => value + 1);
  }

  return (
    <>
      <PageTitle
        eyebrow="QR Pay"
        title="Scan QR"
        description="Scan locally, review authoritative merchant and amount details, then confirm explicitly. Scanning never pays automatically."
      />
      {error && (
        <div className="mb-5">
          <Notice>{error}</Notice>
        </div>
      )}
      <div className="mx-auto max-w-2xl">
        {stage === "SCAN" && (
          <section className="card">
            {busy ? (
              <p className="py-20 text-center text-sm text-slate-500">
                {t("qr.loadingDetails")}
              </p>
            ) : (
              <QrScanner key={scannerKey} onScan={scanned} />
            )}
          </section>
        )}

        {stage === "STATIC_AMOUNT" && merchant && (
          <form className="card" onSubmit={createStaticRequest}>
            <button type="button" className="mb-4 flex items-center gap-2 text-sm font-semibold text-forest-700" onClick={reset}>
              <ArrowLeft size={16} /> {t("qr.scanAnother")}
            </button>
            <QrIcon className="text-forest-600" />
            <h2 className="mt-3 text-2xl font-bold">{merchant.merchantName}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("qr.staticAmountHelp")}</p>
            <label className="label mt-6">
              {t("Amount")} (NPR)
              <input className="input" name="amount" type="number" min="0.01" max="100000000" step="0.01" required autoFocus />
            </label>
            <label className="label mt-4">
              {t("qr.descriptionOptional")}
              <input className="input" name="description" maxLength={180} />
            </label>
            <label className="label mt-4">
              {t("qr.orderReferenceOptional")}
              <input className="input" name="orderReference" maxLength={80} />
            </label>
            <button className="btn-primary mt-6 w-full" disabled={busy}>
              {busy ? t("qr.preparing") : t("qr.reviewPayment")}
            </button>
          </form>
        )}

        {stage === "REVIEW" && request && (
          <section className="card overflow-hidden p-0">
            <div className="bg-forest-900 p-7 text-white">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-emerald-100/70">{t("qr.paymentRequest")}</p>
                <Status value={request.state} />
              </div>
              <h2 className="mt-3 text-2xl font-bold text-white">{request.merchantName}</h2>
              <p className="mt-2 font-display text-4xl font-bold text-white">{npr(request.amountMinor / 100)}</p>
            </div>
            <div className="space-y-4 p-7 text-sm">
              <div className="flex justify-between gap-4"><span className="text-slate-500">{t("Merchant")}</span><strong className="text-right">{request.merchantName}</strong></div>
              {request.description && <div className="flex justify-between gap-4"><span className="text-slate-500">{t("qr.description")}</span><span className="text-right">{request.description}</span></div>}
              {request.orderReference && <div className="flex justify-between gap-4"><span className="text-slate-500">{t("qr.orderReference")}</span><span className="font-mono text-right">{request.orderReference}</span></div>}
              <div className="flex justify-between gap-4"><span className="text-slate-500">{t("qr.fee")}</span><strong>{npr(request.feeMinor / 100)}</strong></div>
              <div className="flex justify-between gap-4 border-t border-slate-100 pt-4"><span>{t("qr.total")}</span><strong className="text-xl text-forest-700">{npr(request.totalMinor / 100)}</strong></div>
              <p className="text-xs text-slate-500">{t("qr.expiresAt")}: {dateTime(request.expiresAt)}</p>
              {requiresPin && <label className="label">{t("qr.paymentPin")}<input className="input text-center font-mono tracking-[.35em]" type="password" inputMode="numeric" maxLength={8} pattern="\d{4,8}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} /></label>}
              {requiresOtp && <label className="label">{t("qr.oneTimeCode")}<input className="input text-center font-mono tracking-[.35em]" inputMode="numeric" maxLength={6} pattern="\d{6}" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} />{developmentOtp && <span className="mt-2 block text-xs text-amber-700">{t("qr.developmentCode")}: {developmentOtp}</span>}</label>}
              <div className="rounded-xl bg-blue-50 p-4 text-xs leading-5 text-blue-900"><ShieldCheck className="mb-2 size-5" />{t("qr.authoritativeNotice")}</div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button className="btn-secondary" disabled={busy} onClick={() => void confirm("DECLINE")}><XCircle size={17} />{t("qr.decline")}</button>
                <button className="btn-primary" disabled={busy || (requiresPin && pin.length < 4) || (requiresOtp && otp.length !== 6)} onClick={() => void confirm("CONFIRM")}><CheckCircle2 size={17} />{busy ? t("qr.processing") : t("qr.confirmPayment")}</button>
              </div>
            </div>
          </section>
        )}

        {stage === "RECEIPT" && result?.transactionId && (
          <section className="card py-10 text-center">
            <CheckCircle2 className="mx-auto size-16 text-emerald-600" />
            <p className="mt-4 text-sm font-bold uppercase tracking-wider text-forest-600">{t("qr.paymentSuccessful")}</p>
            <p className="mt-2 font-display text-4xl font-bold">{npr((result.totalMinor ?? 0) / 100)}</p>
            <div className="mx-auto mt-6 max-w-md space-y-3 rounded-2xl bg-slate-50 p-5 text-left text-sm">
              <div className="flex justify-between"><span className="text-slate-500">{t("Merchant")}</span><strong>{result.merchantName}</strong></div>
              <div className="flex justify-between"><span className="text-slate-500">{t("qr.paymentMethod")}</span><strong>QR</strong></div>
              <div><span className="text-slate-500">{t("qr.transactionId")}</span><p className="mt-1 break-all font-mono font-semibold">{result.transactionId}</p></div>
              <div><span className="text-slate-500">{t("qr.requestId")}</span><p className="mt-1 break-all font-mono text-xs">{result.requestId}</p></div>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button className="btn-primary" onClick={() => void api.download(`/transactions/${result.transactionId}/receipt.pdf`, `${result.transactionId}.pdf`)}><ReceiptText size={17} />{t("qr.downloadReceipt")}</button>
              <button className="btn-secondary" onClick={reset}>{t("qr.scanAnother")}</button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
