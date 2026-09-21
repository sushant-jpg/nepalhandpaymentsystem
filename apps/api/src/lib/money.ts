import { AppError } from "./errors.js";

export function toPaisa(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, "INVALID_AMOUNT", "Amount must be greater than zero.");
  const paisa = Math.round(amount * 100);
  if (!Number.isSafeInteger(paisa) || paisa > 100_000_000_00) throw new AppError(400, "INVALID_AMOUNT", "Amount is outside the supported range.");
  return paisa;
}

export const fromPaisa = (paisa: number) => paisa / 100;
