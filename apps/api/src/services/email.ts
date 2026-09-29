import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

export type EmailDelivery = "sent" | "development-fallback" | "failed";

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | undefined;

function frontendOrigin(): string {
  return config.FRONTEND_URL.split(",")[0]!.trim().replace(/\/$/, "");
}

export function actionUrl(path: string, parameters: Record<string, string>): string {
  const url = new URL(path, `${frontendOrigin()}/`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
}

function htmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

function getTransporter(): Transporter | undefined {
  if (!config.SMTP_HOST) return undefined;
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === "true",
    ...(config.SMTP_USER && config.SMTP_PASS
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

async function deliver(message: Message): Promise<EmailDelivery> {
  const transport = getTransporter();
  if (!transport || !config.SMTP_FROM) return "development-fallback";
  try {
    await transport.sendMail({ from: config.SMTP_FROM, ...message });
    return "sent";
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "EMAIL_DELIVERY_FAILED",
        recipientDomain: message.to.split("@")[1] ?? "unknown",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    return "failed";
  }
}

export const emailService = {
  async sendVerification(input: { to: string; displayName: string; token: string }) {
    const url = actionUrl("/verify-email", { email: input.to, token: input.token });
    const name = htmlEscape(input.displayName);
    return deliver({
      to: input.to,
      subject: "Verify your Nepal Hand Pay email",
      text: `Hello ${input.displayName}, verify your email within ${config.EMAIL_VERIFICATION_TTL_HOURS} hours: ${url}`,
      html: `<p>Hello ${name},</p><p>Verify your email within ${config.EMAIL_VERIFICATION_TTL_HOURS} hours.</p><p><a href="${htmlEscape(url)}">Verify email</a></p><p>If you did not create this account, ignore this message.</p>`,
    });
  },

  async sendPasswordReset(input: { to: string; displayName: string; token: string }) {
    const url = actionUrl("/reset-password", { token: input.token });
    const name = htmlEscape(input.displayName);
    return deliver({
      to: input.to,
      subject: "Reset your Nepal Hand Pay password",
      text: `Hello ${input.displayName}, reset your password within ${config.PASSWORD_RESET_TTL_MINUTES} minutes: ${url}`,
      html: `<p>Hello ${name},</p><p>Reset your password within ${config.PASSWORD_RESET_TTL_MINUTES} minutes.</p><p><a href="${htmlEscape(url)}">Reset password</a></p><p>If you did not request this, secure your email account and ignore this message.</p>`,
    });
  },

  async sendSecurityAlert(input: {
    to: string;
    displayName: string;
    device: string;
    occurredAt: Date;
  }) {
    return deliver({
      to: input.to,
      subject: "New Nepal Hand Pay sign-in",
      text: `Hello ${input.displayName}, a new sign-in from ${input.device} occurred at ${input.occurredAt.toISOString()}. If this was not you, reset your password and revoke all sessions immediately.`,
      html: `<p>Hello ${htmlEscape(input.displayName)},</p><p>A new sign-in from <strong>${htmlEscape(input.device)}</strong> occurred at ${htmlEscape(input.occurredAt.toISOString())}.</p><p>If this was not you, reset your password and revoke all sessions immediately.</p>`,
    });
  },

  async sendPaymentReceipt(input: {
    to: string;
    displayName: string;
    merchantName: string;
    amount: string;
    transactionId: string;
  }) {
    return deliver({
      to: input.to,
      subject: `Payment receipt ${input.transactionId}`,
      text: `Hello ${input.displayName}, your simulated NPR ${input.amount} payment to ${input.merchantName} completed. Transaction: ${input.transactionId}.`,
      html: `<p>Hello ${htmlEscape(input.displayName)},</p><p>Your simulated <strong>NPR ${htmlEscape(input.amount)}</strong> payment to ${htmlEscape(input.merchantName)} completed.</p><p>Transaction: <code>${htmlEscape(input.transactionId)}</code></p>`,
    });
  },

  async sendPaymentOtp(input: {
    to: string;
    displayName: string;
    code: string;
    merchantName: string;
  }) {
    return deliver({
      to: input.to,
      subject: "Nepal Hand Pay payment confirmation code",
      text: `Hello ${input.displayName}, your payment confirmation code for ${input.merchantName} is ${input.code}. It expires in ${Math.ceil(config.OTP_TTL_SECONDS / 60)} minutes. Never share this code with a merchant.`,
      html: `<p>Hello ${htmlEscape(input.displayName)},</p><p>Your payment confirmation code for ${htmlEscape(input.merchantName)} is <strong>${htmlEscape(input.code)}</strong>.</p><p>It expires in ${Math.ceil(config.OTP_TTL_SECONDS / 60)} minutes. Never share this code with a merchant.</p>`,
    });
  },
};
