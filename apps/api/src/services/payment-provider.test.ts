import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientSession } from "mongoose";
import { AppError } from "../lib/errors.js";
import { Wallet } from "../models/index.js";
import { DemoWalletProvider } from "./payment-provider.js";

const session = {} as ClientSession;
afterEach(() => vi.restoreAllMocks());

describe("demo wallet provider", () => {
  it("rejects an overdraft during authorization", async () => {
    vi.spyOn(Wallet, "findOne").mockReturnValue({ lean: vi.fn().mockResolvedValue({ status: "ACTIVE", balancePaisa: 5_000 }) } as never);
    await expect(new DemoWalletProvider().authorize("customer", 5_001)).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("debits and credits using guarded server-side updates", async () => {
    const update = vi.spyOn(Wallet, "findOneAndUpdate").mockResolvedValueOnce({ balancePaisa: 5_000 } as never).mockResolvedValueOnce({ balancePaisa: 15_000 } as never);
    await new DemoWalletProvider().capture("customer", "merchant", 10_000, session);
    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({ ownerType: "CUSTOMER", balancePaisa: { $gte: 10_000 } }), { $inc: { balancePaisa: -10_000, version: 1 } }, expect.objectContaining({ session }));
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({ ownerType: "MERCHANT" }), { $inc: { balancePaisa: 10_000, version: 1 } }, expect.objectContaining({ session }));
  });

  it("fails the transfer if the conditional debit loses a race", async () => {
    vi.spyOn(Wallet, "findOneAndUpdate").mockResolvedValueOnce(null);
    await expect(new DemoWalletProvider().capture("customer", "merchant", 10_000, session)).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("reverses the direction for a refund", async () => {
    const update = vi.spyOn(Wallet, "findOneAndUpdate").mockResolvedValueOnce({} as never).mockResolvedValueOnce({} as never);
    await new DemoWalletProvider().refund("customer", "merchant", 2_500, session);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ ownerType: "MERCHANT", balancePaisa: { $gte: 2_500 } });
    expect(update.mock.calls[1]?.[0]).toMatchObject({ ownerType: "CUSTOMER" });
  });
});
