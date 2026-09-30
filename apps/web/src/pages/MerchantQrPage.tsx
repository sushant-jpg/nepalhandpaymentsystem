import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, QrCode as QrIcon, RotateCcw, XCircle } from "lucide-react";
import type { QrPaymentRequestView } from "@nepal-hand-pay/shared-types";
import { io } from "socket.io-client";
import { useTranslation } from "react-i18next";
import { QrCode } from "../components/QrCode";
import { Notice, PageTitle, Status } from "../components/Ui";
import { api, getToken } from "../lib/api";
import { dateTime, npr } from "../lib/format";
import { SOCKET_URL } from "../lib/runtime-config";

interface StaticQr {
  merchantId: string;
  merchantName: string;
  currency: "NPR";
  qrPayload: string;
}

interface DynamicQr extends QrPaymentRequestView {
  qrPayload: string;
}

const finalStates = new Set([
  "SUCCESS",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "BLOCKED",
]);

function minorUnits(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [rupees = "0", paisa = ""] = normalized.split(".");
  const amount = Number(rupees) * 100 + Number(paisa.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

export function MerchantQrPage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"DYNAMIC" | "STATIC">("DYNAMIC");
  const [staticQr, setStaticQr] = useState<StaticQr | null>(null);
  const [payment, setPayment] = useState<DynamicQr | null>(null);
  const [status, setStatus] = useState("CREATED");
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"connecting" | "live" | "polling">("connecting");
  const createKey = useRef(crypto.randomUUID());
  const paymentId = payment?.id;

  useEffect(() => {
    let active = true;
    void api
      .get<StaticQr>("/qr/merchant")
      .then((value) => {
        if (active) setStaticQr(value);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : t("qr.createFailed"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const refresh = useCallback(async () => {
    if (!paymentId || finalStates.has(status)) return;
    try {
      const current = await api.get<QrPaymentRequestView>(
        `/qr/payment-requests/${paymentId}`,
      );
      setStatus(current.state);
      setPayment((value) => (value ? { ...value, ...current } : value));
    } catch (caught) {
      setConnection("polling");
      if (caught instanceof Error) setError(caught.message);
    }
  }, [paymentId, status]);

  useEffect(() => {
    if (!paymentId) return;
    const socket = io(SOCKET_URL, {
      auth: { token: getToken() },
      reconnection: true,
    });
    const onConnect = () => {
      setConnection("live");
      socket.emit("payment:watch", paymentId);
    };
    const onDisconnect = () => setConnection("polling");
    const onUpdate = (update: { paymentId?: string; state?: string; transactionId?: string }) => {
      if (update.paymentId !== paymentId || !update.state) return;
      setStatus(update.state);
      if (update.transactionId)
        setPayment((value) =>
          value ? { ...value, transactionId: update.transactionId } : value,
        );
      if (finalStates.has(update.state)) socket.disconnect();
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("payment:update", onUpdate);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("payment:update", onUpdate);
      socket.disconnect();
    };
  }, [paymentId]);

  useEffect(() => {
    if (!payment || finalStates.has(status)) return;
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [paymentId, refresh, status]);

  useEffect(() => {
    if (!payment?.expiresAt || finalStates.has(status)) return;
    const expiresAt = payment.expiresAt;
    const tick = () => {
      const seconds = Math.max(
        0,
        Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000),
      );
      setRemaining(seconds);
      if (seconds === 0) void refresh();
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [payment?.expiresAt, refresh, status]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountMinor = minorUnits(String(form.get("amount") ?? ""));
    if (!amountMinor) {
      setError(t("qr.invalidAmount"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api.post<DynamicQr>(
        "/qr/payment-requests",
        {
          amountMinor,
          currency: "NPR",
          description: String(form.get("description") || "") || undefined,
          orderReference: String(form.get("orderReference") || "") || undefined,
          expiresInSeconds: 300,
        },
        { idempotencyKey: createKey.current },
      );
      setPayment(created);
      setStatus(created.state);
      setConnection("connecting");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("qr.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!payment || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/qr/payment-requests/${payment.id}/cancel`);
      setStatus("CANCELLED");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("qr.paymentFailed"));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    createKey.current = crypto.randomUUID();
    setPayment(null);
    setStatus("CREATED");
    setRemaining(0);
    setError("");
  }

  const countdown = useMemo(
    () => `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`,
    [remaining],
  );
  const displayQr = mode === "STATIC" ? staticQr?.qrPayload : payment?.qrPayload;

  return (
    <>
      <PageTitle
        eyebrow={t("qr.merchantQr")}
        title={t("qr.generateQr")}
        description={t("qr.generateHelp")}
      />
      {error && <div className="mb-5"><Notice>{error}</Notice></div>}
      <div className="mb-5 flex gap-3">
        <button className={mode === "DYNAMIC" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("DYNAMIC")}>{t("qr.dynamicQr")}</button>
        <button className={mode === "STATIC" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("STATIC")}>{t("qr.staticQr")}</button>
      </div>

      {mode === "DYNAMIC" && !payment && (
        <form className="card mx-auto max-w-2xl" onSubmit={generate}>
          <label className="label">{t("Amount")} (NPR)<input className="input" name="amount" inputMode="decimal" pattern="\d+(\.\d{1,2})?" required autoFocus /></label>
          <label className="label">{t("qr.descriptionOptional")}<input className="input" name="description" maxLength={180} /></label>
          <label className="label">{t("qr.orderReferenceOptional")}<input className="input" name="orderReference" maxLength={80} /></label>
          <button className="btn-primary mt-2 w-full" disabled={busy}><QrIcon size={18} />{busy ? t("qr.preparing") : t("qr.generateQr")}</button>
        </form>
      )}

      {displayQr && (
        <section className="card mx-auto max-w-3xl text-center">
          <div className="mx-auto flex w-full justify-center"><QrCode value={displayQr} /></div>
          {mode === "STATIC" && staticQr ? (
            <>
              <h2 className="text-2xl font-bold">{staticQr.merchantName}</h2>
              <p className="text-sm text-slate-500">{t("qr.staticCustomerAmount")}</p>
            </>
          ) : payment ? (
            <>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Status value={status} />
                {!finalStates.has(status) && <span className="flex items-center gap-2 text-sm text-slate-500"><Clock3 size={16} />{countdown}</span>}
              </div>
              <p className="font-display text-4xl font-bold">{npr(payment.totalMinor / 100)}</p>
              <p className="text-sm text-slate-500">{payment.description || t("qr.waitingForCustomer")}</p>
              <p className="text-xs text-slate-400">{t("qr.realtimeStatus")}: {connection} · {dateTime(payment.expiresAt)}</p>
              {status === "SUCCESS" ? (
                <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
              ) : finalStates.has(status) ? (
                <XCircle className="mx-auto size-12 text-red-500" />
              ) : null}
              <div className="flex flex-wrap justify-center gap-3">
                {!finalStates.has(status) && <button className="btn-secondary" disabled={busy} onClick={() => void cancel()}>{t("qr.cancelRequest")}</button>}
                {finalStates.has(status) && <button className="btn-primary" onClick={reset}><RotateCcw size={17} />{t("qr.newQr")}</button>}
              </div>
            </>
          ) : null}
        </section>
      )}
    </>
  );
}
