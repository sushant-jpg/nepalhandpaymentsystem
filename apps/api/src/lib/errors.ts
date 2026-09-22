import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import mongoose from "mongoose";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, _res, next) =>
  next(new AppError(404, "NOT_FOUND", "The requested resource was not found."));

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "The request data is invalid.", details: error.flatten() }, requestId: req.requestId,
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }, requestId: req.requestId,
    });
    return;
  }
  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({ success: false, error: { code: "INVALID_IDENTIFIER", message: "A supplied identifier is invalid." }, requestId: req.requestId });
    return;
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
    res.status(409).json({ success: false, error: { code: "DUPLICATE_RESOURCE", message: "The request conflicts with an existing record." }, requestId: req.requestId });
    return;
  }
  req.log?.error({ err: error, requestId: req.requestId }, "Unhandled request error");
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." }, requestId: req.requestId,
  });
};
