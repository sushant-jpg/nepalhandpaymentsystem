import { JournalEntry, LedgerAccount, LedgerPosting, Wallet } from "../models/index.js";

export async function reconcileLedger() {
  const [journalTotals, accountTotals, accounts, wallets, journalCount] =
    await Promise.all([
      LedgerPosting.aggregate<{
        _id: unknown;
        debitPaisa: number;
        creditPaisa: number;
      }>([
        {
          $group: {
            _id: "$journalEntryId",
            debitPaisa: {
              $sum: {
                $cond: [{ $eq: ["$direction", "DEBIT"] }, "$amountPaisa", 0],
              },
            },
            creditPaisa: {
              $sum: {
                $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amountPaisa", 0],
              },
            },
          },
        },
      ]),
      LedgerPosting.aggregate<{
        _id: unknown;
        debitPaisa: number;
        creditPaisa: number;
      }>([
        {
          $group: {
            _id: "$ledgerAccountId",
            debitPaisa: {
              $sum: {
                $cond: [{ $eq: ["$direction", "DEBIT"] }, "$amountPaisa", 0],
              },
            },
            creditPaisa: {
              $sum: {
                $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amountPaisa", 0],
              },
            },
          },
        },
      ]),
      LedgerAccount.find().lean(),
      Wallet.find().select("walletId ownerType ownerId balancePaisa").lean(),
      JournalEntry.countDocuments(),
    ]);

  const unbalancedJournals = journalTotals.filter(
    (item) => item.debitPaisa !== item.creditPaisa,
  );
  const totalsByAccount = new Map(
    accountTotals.map((item) => [String(item._id), item]),
  );
  const accountMismatches = accounts.flatMap((account) => {
    const totals = totalsByAccount.get(account._id.toString()) ?? {
      debitPaisa: 0,
      creditPaisa: 0,
    };
    const calculatedPaisa =
      account.normalBalance === "DEBIT"
        ? totals.debitPaisa - totals.creditPaisa
        : totals.creditPaisa - totals.debitPaisa;
    return calculatedPaisa === account.postedBalancePaisa
      ? []
      : [
          {
            accountId: account.accountId,
            storedPaisa: account.postedBalancePaisa,
            calculatedPaisa,
          },
        ];
  });
  const walletAccounts = new Map(
    accounts
      .filter((account) => account.purpose === "WALLET")
      .map((account) => [
        `${account.ownerType}:${account.ownerId}`,
        account.postedBalancePaisa,
      ]),
  );
  const walletMismatches = wallets.flatMap((wallet) => {
    const ledgerPaisa = walletAccounts.get(
      `${wallet.ownerType}:${wallet.ownerId.toString()}`,
    );
    return ledgerPaisa === wallet.balancePaisa
      ? []
      : [
          {
            walletId: wallet.walletId,
            walletPaisa: wallet.balancePaisa,
            ledgerPaisa: ledgerPaisa ?? null,
          },
        ];
  });
  const balanced =
    unbalancedJournals.length === 0 &&
    accountMismatches.length === 0 &&
    walletMismatches.length === 0;
  return {
    balanced,
    generatedAt: new Date().toISOString(),
    journalCount,
    accountCount: accounts.length,
    walletCount: wallets.length,
    unbalancedJournals,
    accountMismatches,
    walletMismatches,
  };
}
