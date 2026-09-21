import type mongoose from "mongoose";
import { AppError } from "../lib/errors.js";
import { Wallet } from "../models/index.js";

export interface PaymentProvider {
  authorize(customerId: string, amountPaisa: number): Promise<void>;
  capture(customerId: string, merchantId: string, amountPaisa: number, session: mongoose.ClientSession): Promise<void>;
  refund(customerId: string, merchantId: string, amountPaisa: number, session: mongoose.ClientSession): Promise<void>;
}

export class DemoWalletProvider implements PaymentProvider {
  async authorize(customerId: string, amountPaisa: number) {
    const wallet: any = await Wallet.findOne({ ownerType: "CUSTOMER", ownerId: customerId }).lean();
    if (!wallet || wallet.status !== "ACTIVE") throw new AppError(409, "WALLET_UNAVAILABLE", "Customer wallet is unavailable.");
    if (wallet.balancePaisa < amountPaisa) throw new AppError(409, "INSUFFICIENT_BALANCE", "Insufficient wallet balance.");
  }

  async capture(customerId: string, merchantId: string, amountPaisa: number, session: mongoose.ClientSession) {
    const debited = await Wallet.findOneAndUpdate(
      { ownerType: "CUSTOMER", ownerId: customerId, status: "ACTIVE", balancePaisa: { $gte: amountPaisa } },
      { $inc: { balancePaisa: -amountPaisa, version: 1 } },
      { new: true, session },
    );
    if (!debited) throw new AppError(409, "INSUFFICIENT_BALANCE", "Insufficient wallet balance.");
    const credited = await Wallet.findOneAndUpdate(
      { ownerType: "MERCHANT", ownerId: merchantId, status: "ACTIVE" },
      { $inc: { balancePaisa: amountPaisa, version: 1 } },
      { new: true, session },
    );
    if (!credited) throw new AppError(409, "MERCHANT_WALLET_UNAVAILABLE", "Merchant wallet is unavailable.");
  }

  async refund(customerId: string, merchantId: string, amountPaisa: number, session: mongoose.ClientSession) {
    const debited = await Wallet.findOneAndUpdate(
      { ownerType: "MERCHANT", ownerId: merchantId, status: "ACTIVE", balancePaisa: { $gte: amountPaisa } },
      { $inc: { balancePaisa: -amountPaisa, version: 1 } }, { new: true, session },
    );
    if (!debited) throw new AppError(409, "MERCHANT_FUNDS_UNAVAILABLE", "Merchant wallet cannot support this refund.");
    const credited = await Wallet.findOneAndUpdate(
      { ownerType: "CUSTOMER", ownerId: customerId, status: "ACTIVE" },
      { $inc: { balancePaisa: amountPaisa, version: 1 } }, { new: true, session },
    );
    if (!credited) throw new AppError(409, "CUSTOMER_WALLET_UNAVAILABLE", "Customer wallet is unavailable.");
  }
}

export const paymentProvider: PaymentProvider = new DemoWalletProvider();
