import { AppError } from "./errors.js";

export function toPaisa(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, "INVALID_AMOUNT", "Amount must be greater than zero.");
  const scaled = amount * 100;
  const paisa = Math.round(scaled);
  if (Math.abs(scaled - paisa) > 1e-7) {
    throw new AppError(
      400,
      "INVALID_AMOUNT_PRECISION",
      "Amount must use no more than two decimal places.",
    );
  }
  if (!Number.isSafeInteger(paisa) || paisa < 1 || paisa > 100_000_000_00) throw new AppError(400, "INVALID_AMOUNT", "Amount is outside the supported range.");
  return paisa;
}

export const fromPaisa = (paisa: number) => paisa / 100;
