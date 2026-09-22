import type { RiskLevel } from "@nepal-hand-pay/shared-types";
import { PaymentRequest, SecurityEvent, SystemConfig, Transaction, User } from "../models/index.js";
import { config } from "../config.js";

export interface RiskResult { score: number; level: RiskLevel; indicators: string[]; requiresPin: boolean; requiresOtp: boolean }

function isRiskThresholdOverride(value: unknown): value is Partial<Record<"medium" | "high" | "blocked", number>> {
  return typeof value === "object" && value !== null
    && Object.entries(value).every(([key, threshold]) => ["medium", "high", "blocked"].includes(key) && typeof threshold === "number" && Number.isFinite(threshold));
}

export async function assessPaymentRisk(customerId: string, amountPaisa: number, merchantCreatedAt?: Date): Promise<RiskResult> {
  let score = 0;
  const indicators: string[] = [];
  const amount = amountPaisa / 100;
  const [pinConfig, levelConfig] = await Promise.all([
    SystemConfig.findOne({ key: "highValuePinThreshold" }).lean(),
    SystemConfig.findOne({ key: "riskThresholds" }).lean(),
  ]);
  const highValuePinThreshold = typeof pinConfig?.value === "number" ? pinConfig.value : 20_000;
  const levels = { medium: config.RISK_MEDIUM_THRESHOLD, high: config.RISK_HIGH_THRESHOLD, blocked: config.RISK_BLOCKED_THRESHOLD, ...(isRiskThresholdOverride(levelConfig?.value) ? levelConfig.value : {}) };
  if (amount >= highValuePinThreshold) { score += 35; indicators.push("VERY_HIGH_AMOUNT"); }
  else if (amount >= 5_000) { score += 18; indicators.push("HIGH_AMOUNT"); }

  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kathmandu" }).format(new Date()));
  if (hour < 5 || hour >= 23) { score += 12; indicators.push("ABNORMAL_TRANSACTION_TIME"); }

  const lastTenMinutes = new Date(Date.now() - 10 * 60_000);
  const rapidCount = await Transaction.countDocuments({ customerId, status: "SUCCESS", createdAt: { $gte: lastTenMinutes } });
  if (rapidCount >= 3) { score += 22; indicators.push("MULTIPLE_RAPID_TRANSACTIONS"); }

  const failedPalmCount = await SecurityEvent.countDocuments({ userId: customerId, action: "PALM_IDENTIFICATION_FAILED", createdAt: { $gte: new Date(Date.now() - 30 * 60_000) } });
  if (failedPalmCount >= 3) { score += 25; indicators.push("MULTIPLE_FAILED_PALM_SCANS"); }

  if (merchantCreatedAt && merchantCreatedAt > new Date(Date.now() - 7 * 86_400_000)) { score += 10; indicators.push("NEW_MERCHANT"); }

  const user = await User.findById(customerId).select("securityChangedAt").lean();
  if (user?.securityChangedAt && user.securityChangedAt > new Date(Date.now() - 24 * 3_600_000)) { score += 15; indicators.push("RECENT_SECURITY_CHANGE"); }

  const recentRequests = await PaymentRequest.countDocuments({ customerId, createdAt: { $gte: new Date(Date.now() - 60_000) } });
  if (recentRequests >= 2) { score += 12; indicators.push("PAYMENT_VELOCITY"); }

  score = Math.min(100, score);
  const level: RiskLevel = score >= levels.blocked ? "BLOCKED" : score >= levels.high ? "HIGH" : score >= levels.medium ? "MEDIUM" : "LOW";
  return {
    score,
    level,
    indicators,
    requiresPin: amount >= highValuePinThreshold || level === "HIGH" || level === "MEDIUM",
    requiresOtp: level === "HIGH",
  };
}
