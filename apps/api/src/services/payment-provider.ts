import crypto from "node:crypto";
import type mongoose from "mongoose";
import { AppError } from "../lib/errors.js";
import { Wallet } from "../models/index.js";

export interface PaymentProvider {
  createPayment(input: { paymentId: string; amountPaisa: number; currency: "NPR" }): Promise<{ providerReference: string; status: "CREATED"; mode: "MOCK" }>;
  verifyPayment(customerId: string, amountPaisa: number): Promise<void>;
  capturePayment(customerId: string, merchantId: string, amountPaisa: number, session: mongoose.ClientSession): Promise<{ providerReference: string; status: "SUCCESS"; mode: "MOCK" }>;
  refundPayment(customerId: string, merchantId: string, amountPaisa: number, session: mongoose.ClientSession): Promise<{ providerReference: string; status: "REFUNDED"; mode: "MOCK" }>;
  getPaymentStatus(providerReference: string): Promise<{ providerReference: string; status: "MOCK_LEDGER_RECORDED"; mode: "MOCK" }>;
}

export class MockPaymentProvider implements PaymentProvider {
  async createPayment(input: { paymentId: string; amountPaisa: number; currency: "NPR" }) {
    return { providerReference: `mock:${input.paymentId}`, status: "CREATED" as const, mode: "MOCK" as const };
  }

  async verifyPayment(customerId: string, amountPaisa: number) {
    const wallet = await Wallet.findOne({ ownerType: "CUSTOMER", ownerId: customerId }).lean();
    if (!wallet || wallet.status !== "ACTIVE") throw new AppError(409, "WALLET_UNAVAILABLE", "Customer wallet is unavailable.");
    if (wallet.balancePaisa < amountPaisa) throw new AppError(409, "INSUFFICIENT_BALANCE", "Insufficient wallet balance.");
  }

  async capturePayment(customerId: string, merchantId: string, amountPaisa: number, session: mongoose.ClientSession) {
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
    return { providerReference: `mock:payment:${crypto.randomUUID()}`, status: "SUCCESS" as const, mode: "MOCK" as const };
  }

  async refundPayment(customerId: string, merchantId: string, amountPaisa: number, session: mongoose.ClientSession) {
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
    return { providerReference: `mock:refund:${crypto.randomUUID()}`, status: "REFUNDED" as const, mode: "MOCK" as const };
  }

  async getPaymentStatus(providerReference: string) {
    return { providerReference, status: "MOCK_LEDGER_RECORDED" as const, mode: "MOCK" as const };
  }
}

export class DemoWalletProvider extends MockPaymentProvider {}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();
