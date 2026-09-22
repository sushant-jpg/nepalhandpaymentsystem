import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { palmClient } from "../services/palm-client.js";
import { CustomerProfile, PalmEnrollment } from "../models/index.js";
import { publicId } from "../lib/ids.js";
import { audit, securityEvent } from "../lib/audit.js";
import { rateLimit } from "../middleware/rate-limit.js";

const router = Router();
router.use(authenticate, authorize("CUSTOMER"));

const image = z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(1_500_000);
router.post("/enroll", rateLimit(5, 15 * 60_000), validate(z.object({ handSide: z.enum(["LEFT", "RIGHT"]), consent: z.literal(true), samples: z.array(image).min(3).max(5) })), asyncHandler(async (req, res) => {
  const result = await palmClient.enroll(req.auth!.userId, req.body.handSide, req.body.samples);
  const enrollment = await PalmEnrollment.findOneAndUpdate(
    { userId: req.auth!.userId },
    {
      $set: {
        palmEnrollmentId: publicId("PALM"), handSide: req.body.handSide, algorithmVersion: result.algorithmVersion,
        serviceTemplateRef: result.templateRef ?? req.auth!.userId, enrolledAt: new Date(), status: "ACTIVE",
        sampleCount: req.body.samples.length, consentAt: new Date(), revokedAt: null,
      },
    },
    { upsert: true, new: true },
  );
  await CustomerProfile.updateOne({ userId: req.auth!.userId }, { $set: { biometricConsentAt: new Date(), biometricRetentionAccepted: true } });
  await audit(req, "PALM_ENROLLED", { type: "PalmEnrollment", id: enrollment._id.toString() }, { handSide: req.body.handSide, algorithmVersion: result.algorithmVersion });
  await securityEvent(req, { userId: req.auth!.userId, category: "PALM", action: "PALM_ENROLLED", success: true });
  res.status(201).json({ success: true, data: { enrolled: true, handSide: enrollment.handSide, algorithmVersion: enrollment.algorithmVersion, enrolledAt: enrollment.enrolledAt } });
}));

router.get("/status", asyncHandler(async (req, res) => {
  const enrollment: any = await PalmEnrollment.findOne({ userId: req.auth!.userId, status: "ACTIVE" }).lean();
  res.json({ success: true, data: enrollment ? { enrolled: true, handSide: enrollment.handSide, algorithmVersion: enrollment.algorithmVersion, enrolledAt: enrollment.enrolledAt } : { enrolled: false } });
}));

router.post("/verify", rateLimit(20, 60_000), validate(z.object({ image })), asyncHandler(async (req, res) => {
  const result = await palmClient.verify(req.auth!.userId, req.body.image);
  await securityEvent(req, { userId: req.auth!.userId, category: "PALM", action: result.matched ? "PALM_VERIFICATION_SUCCESS" : "PALM_IDENTIFICATION_FAILED", severity: result.matched ? "INFO" : "WARNING", success: result.matched, metadata: { similarity: result.similarity, algorithmVersion: result.algorithmVersion } });
  res.json({ success: true, data: { matched: result.matched, similarity: result.similarity, threshold: result.threshold } });
}));

router.delete("/", asyncHandler(async (req, res) => {
  await palmClient.remove(req.auth!.userId);
  await PalmEnrollment.updateOne({ userId: req.auth!.userId, status: "ACTIVE" }, { $set: { status: "REVOKED", revokedAt: new Date(), serviceTemplateRef: "revoked" } });
  await CustomerProfile.updateOne({ userId: req.auth!.userId }, { $set: { biometricRetentionAccepted: false } });
  await audit(req, "PALM_REMOVED", { type: "User", id: req.auth!.userId });
  res.json({ success: true, data: { deleted: true } });
}));

export default router;
