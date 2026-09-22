import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientSession } from "mongoose";
import { Wallet } from "../models/index.js";
import { DemoWalletProvider } from "./payment-provider.js";

const session = {} as ClientSession;
afterEach(() => vi.restoreAllMocks());

describe("wallet concurrency guards", () => {
  it("allows only two of ten simultaneous NPR 500 spends from NPR 1,000", async () => {
    const update = vi.spyOn(Wallet, "findOneAndUpdate");
    for (let attempt = 0; attempt < 10; attempt += 1) update.mockResolvedValueOnce(attempt < 2 ? { balancePaisa: 100_000 - (attempt + 1) * 50_000 } as never : null);
    update.mockResolvedValueOnce({ balancePaisa: 50_000 } as never).mockResolvedValueOnce({ balancePaisa: 100_000 } as never);

    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => new DemoWalletProvider().capturePayment("customer", "merchant", 50_000, session)));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(8);
    expect(update).toHaveBeenCalledTimes(12);
    expect(update.mock.calls.slice(0, 10).every((call) => (call[0] as { ownerType?: string }).ownerType === "CUSTOMER")).toBe(true);
    expect(update.mock.calls.slice(10).every((call) => (call[0] as { ownerType?: string }).ownerType === "MERCHANT")).toBe(true);
  });

  it("does not let concurrent refunds overdraw the merchant", async () => {
    const update = vi.spyOn(Wallet, "findOneAndUpdate");
    for (let attempt = 0; attempt < 10; attempt += 1) update.mockResolvedValueOnce(attempt < 2 ? { balancePaisa: 100_000 - (attempt + 1) * 50_000 } as never : null);
    update.mockResolvedValueOnce({ balancePaisa: 50_000 } as never).mockResolvedValueOnce({ balancePaisa: 100_000 } as never);

    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => new DemoWalletProvider().refundPayment("customer", "merchant", 50_000, session)));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(8);
    expect(update.mock.calls.slice(0, 10).every((call) => (call[0] as { ownerType?: string }).ownerType === "MERCHANT")).toBe(true);
    expect(update.mock.calls.slice(10).every((call) => (call[0] as { ownerType?: string }).ownerType === "CUSTOMER")).toBe(true);
  });
});
