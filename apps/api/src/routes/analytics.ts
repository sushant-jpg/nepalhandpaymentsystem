import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { fromPaisa } from "../lib/money.js";
import { Transaction, Wallet, type TransactionRecord } from "../models/index.js";

interface AmountAggregate { _id: null; value: number }
type MerchantSummary = { businessName: string };
type RecentCustomerTransaction = Pick<TransactionRecord, "transactionId" | "amountPaisa" | "status" | "createdAt"> & {
  merchantId: MerchantSummary | null;
};

const router = Router();
router.use(authenticate, authorize("CUSTOMER"));

router.get("/customer-dashboard", asyncHandler(async (req, res) => {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const month = new Date(day.getFullYear(), day.getMonth(), 1);
  const [wallet, today, monthly, recent] = await Promise.all([
    Wallet.findOne({ ownerType: "CUSTOMER", ownerId: req.auth!.userId }).lean(),
    Transaction.aggregate<AmountAggregate>([{ $match: { customerId: new mongoose.Types.ObjectId(req.auth!.userId), status: "SUCCESS", createdAt: { $gte: day } } }, { $group: { _id: null, value: { $sum: "$amountPaisa" } } }]),
    Transaction.aggregate<AmountAggregate>([{ $match: { customerId: new mongoose.Types.ObjectId(req.auth!.userId), status: "SUCCESS", createdAt: { $gte: month } } }, { $group: { _id: null, value: { $sum: "$amountPaisa" } } }]),
    Transaction.find({ customerId: req.auth!.userId }).populate<{ merchantId: MerchantSummary | null }>("merchantId", "businessName").sort({ createdAt: -1 }).limit(6).lean<RecentCustomerTransaction[]>(),
  ]);
  res.json({ success: true, data: { balance: fromPaisa(wallet?.balancePaisa ?? 0), walletStatus: wallet?.status, todaySpending: fromPaisa(today[0]?.value ?? 0), monthlySpending: fromPaisa(monthly[0]?.value ?? 0), recent: recent.map((transaction) => ({ transactionId: transaction.transactionId, merchantName: transaction.merchantId?.businessName, amount: fromPaisa(transaction.amountPaisa), status: transaction.status, createdAt: transaction.createdAt })) } });
}));

export default router;
