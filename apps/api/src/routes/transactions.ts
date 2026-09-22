import { Router, type Request } from "express";
import PDFDocument from "pdfkit";
import type { FilterQuery } from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { AppError } from "../lib/errors.js";
import { fromPaisa } from "../lib/money.js";
import { Merchant, Transaction, type MerchantRecord, type TransactionRecord, type UserRecord } from "../models/index.js";
import { audit, securityEvent } from "../lib/audit.js";
import { validate } from "../middleware/validate.js";
import { decodeDateCursor, encodeDateCursor } from "../lib/cursor.js";

const router = Router();
router.use(authenticate);

type PersistedSummary<T> = T & { _id: { toString(): string } };
type CustomerSummary = PersistedSummary<Pick<UserRecord, "displayName" | "email">>;
type MerchantSummary = PersistedSummary<Pick<MerchantRecord, "businessName">>;
type TransactionListItem = Pick<TransactionRecord, "transactionId" | "amountPaisa" | "currency" | "status" | "riskLevel" | "createdAt"> & {
  _id: unknown;
  customerId: Pick<CustomerSummary, "displayName"> | null;
  merchantId: MerchantSummary | null;
};
type TransactionDetail = Pick<TransactionRecord, "transactionId" | "amountPaisa" | "currency" | "status" | "paymentMethod" | "riskLevel" | "orderReference" | "refundedAmountPaisa" | "providerMode" | "createdAt" | "completedAt"> & {
  customerId: CustomerSummary;
  merchantId: MerchantSummary;
};

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(8).max(512).optional(),
  status: z.enum(["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED", "PARTIALLY_REFUNDED"]).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "BLOCKED"]).optional(),
  dateFrom: z.coerce.date().optional(), dateTo: z.coerce.date().optional(), minAmount: z.coerce.number().min(0).optional(), maxAmount: z.coerce.number().min(0).optional(),
});

async function scope(req: Request): Promise<FilterQuery<TransactionRecord>> {
  if (req.auth!.role === "CUSTOMER") return { customerId: req.auth!.userId };
  if (req.auth!.role === "MERCHANT") {
    const merchant = await Merchant.findOne({ userId: req.auth!.userId }).lean();
    return { merchantId: merchant?._id ?? null };
  }
  return {};
}

router.get("/", asyncHandler(async (req, res) => {
  const q = querySchema.parse(req.query);
  const filter = await scope(req);
  if (q.status) filter.status = q.status;
  if (q.riskLevel) filter.riskLevel = q.riskLevel;
  if (q.dateFrom || q.dateTo) filter.createdAt = { ...(q.dateFrom ? { $gte: q.dateFrom } : {}), ...(q.dateTo ? { $lte: q.dateTo } : {}) };
  if (q.cursor) {
    const cursor = decodeDateCursor(q.cursor);
    filter.$and = [{ $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }] }];
  }
  if (q.minAmount !== undefined || q.maxAmount !== undefined) filter.amountPaisa = { ...(q.minAmount !== undefined ? { $gte: Math.round(q.minAmount * 100) } : {}), ...(q.maxAmount !== undefined ? { $lte: Math.round(q.maxAmount * 100) } : {}) };
  const [rows, total] = await Promise.all([
    Transaction.find(filter).populate<{ customerId: Pick<CustomerSummary, "displayName"> | null }>("customerId", "displayName").populate<{ merchantId: MerchantSummary | null }>("merchantId", "businessName").sort({ createdAt: -1, _id: -1 }).skip(q.cursor ? 0 : (q.page - 1) * q.limit).limit(q.limit + 1).lean<TransactionListItem[]>(),
    q.cursor ? Promise.resolve(undefined) : Transaction.countDocuments(filter),
  ]);
  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last ? encodeDateCursor({ createdAt: new Date(last.createdAt), id: String(last._id) }) : null;
  res.json({ success: true, data: { items: items.map((item) => ({ id: item._id, transactionId: item.transactionId, customerName: item.customerId?.displayName, merchantName: item.merchantId?.businessName, amount: fromPaisa(item.amountPaisa), currency: item.currency, status: item.status, riskLevel: item.riskLevel, createdAt: item.createdAt })), pagination: { page: q.cursor ? undefined : q.page, limit: q.limit, total, pages: total === undefined ? undefined : Math.ceil(total / q.limit), nextCursor } } });
}));

async function authorizedTransaction(req: Request): Promise<TransactionDetail> {
  const transaction = await Transaction.findOne({ transactionId: req.params.id }).populate<{ customerId: CustomerSummary }>("customerId", "displayName email").populate<{ merchantId: MerchantSummary }>("merchantId", "businessName").lean<TransactionDetail | null>();
  if (!transaction) throw new AppError(404, "TRANSACTION_NOT_FOUND", "Transaction was not found.");
  if (req.auth!.role === "CUSTOMER" && transaction.customerId._id.toString() !== req.auth!.userId) throw new AppError(403, "FORBIDDEN", "You cannot view this transaction.");
  if (req.auth!.role === "MERCHANT") {
    const merchant = await Merchant.findOne({ userId: req.auth!.userId }).lean();
    if (!merchant || transaction.merchantId._id.toString() !== merchant._id.toString()) throw new AppError(403, "FORBIDDEN", "You cannot view this transaction.");
  }
  return transaction;
}

router.get("/:id", asyncHandler(async (req, res) => {
  const t = await authorizedTransaction(req);
  res.json({ success: true, data: { transactionId: t.transactionId, customerName: t.customerId.displayName, merchantName: t.merchantId.businessName, amount: fromPaisa(t.amountPaisa), currency: t.currency, status: t.status, paymentMethod: t.paymentMethod, riskLevel: t.riskLevel, orderReference: t.orderReference, refundedAmount: fromPaisa(t.refundedAmountPaisa), providerMode: t.providerMode, createdAt: t.createdAt, completedAt: t.completedAt } });
}));

router.post("/:id/report", authorize("CUSTOMER"), validate(z.object({ reason: z.string().trim().min(10).max(500) })), asyncHandler(async (req, res) => {
  const transaction = await authorizedTransaction(req);
  await securityEvent(req, { userId: req.auth!.userId, category: "PAYMENT", action: "TRANSACTION_REPORTED", severity: "HIGH", success: true, metadata: { transactionId: transaction.transactionId, reason: req.body.reason } });
  await audit(req, "TRANSACTION_REPORTED", { type: "Transaction", id: transaction.transactionId }, { reason: req.body.reason });
  res.status(201).json({ success: true, data: { reported: true } });
}));

router.get("/:id/receipt.pdf", authorize("CUSTOMER", "MERCHANT", "ADMIN", "AUDITOR"), asyncHandler(async (req, res) => {
  const t = await authorizedTransaction(req);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${t.transactionId}.pdf"`);
  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: `Receipt ${t.transactionId}` } });
  doc.pipe(res);
  doc.fillColor("#0b3b2e").fontSize(24).text("NEPAL HAND PAY");
  doc.moveDown().fillColor("#16835c").fontSize(17).text("Demo Palm Payment Receipt");
  doc.moveDown(1.5).fillColor("#1e293b").fontSize(11);
  const rows = [["Merchant", t.merchantId.businessName], ["Amount", `NPR ${fromPaisa(t.amountPaisa).toLocaleString("en-NP", { minimumFractionDigits: 2 })}`], ["Transaction", t.transactionId], ["Reference", t.orderReference || "—"], ["Date", new Intl.DateTimeFormat("en-NP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kathmandu" }).format(t.completedAt ?? t.createdAt)], ["Payment method", "Palm Payment (Mock Wallet)"], ["Status", t.status], ["Refunded", `NPR ${fromPaisa(t.refundedAmountPaisa).toLocaleString("en-NP", { minimumFractionDigits: 2 })}`]];
  for (const [label, value] of rows) { doc.fillColor("#64748b").text(label as string); doc.fillColor("#0f172a").fontSize(13).text(value as string); doc.moveDown(0.7); }
  doc.moveDown().fontSize(9).fillColor("#64748b").text("Demo wallet receipt. No biometric information is included. This does not represent a bank settlement.");
  doc.end();
}));

export default router;
