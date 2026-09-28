import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { fromPaisa } from "../lib/money.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import {
  LedgerPosting,
  JournalEntry,
} from "../models/index.js";
import { reconcileLedger } from "../services/reconciliation.js";

const router = Router();
router.use(authenticate, requirePermission("ledger.read"));

router.get(
  "/entries",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        kind: z
          .enum([
            "PAYMENT",
            "REFUND",
            "DEMO_CREDIT",
            "FEE",
            "ADJUSTMENT",
            "REVERSAL",
          ])
          .optional(),
      })
      .parse(req.query);
    const filter = query.kind ? { kind: query.kind } : {};
    const [entries, total] = await Promise.all([
      JournalEntry.find(filter)
        .sort({ postedAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      JournalEntry.countDocuments(filter),
    ]);
    const postings = await LedgerPosting.find({
      journalEntryId: { $in: entries.map((entry) => entry._id) },
    })
      .populate("ledgerAccountId", "accountId ownerType ownerId purpose")
      .lean();
    const byEntry = new Map<string, typeof postings>();
    for (const posting of postings) {
      const key = posting.journalEntryId.toString();
      byEntry.set(key, [...(byEntry.get(key) ?? []), posting]);
    }
    res.json({
      success: true,
      data: {
        items: entries.map((entry) => ({
          journalId: entry.journalId,
          kind: entry.kind,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          description: entry.description,
          totalPaisa: entry.totalPaisa,
          total: fromPaisa(entry.totalPaisa),
          requestId: entry.requestId,
          postedAt: entry.postedAt,
          postings: byEntry.get(entry._id.toString()) ?? [],
        })),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit),
        },
      },
    });
  }),
);

router.get(
  "/reconciliation",
  asyncHandler(async (_req, res) => {
    const report = await reconcileLedger();
    res.status(report.balanced ? 200 : 409).json({
      success: true,
      data: report,
    });
  }),
);

export default router;
