export function parseMinorUnits(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [rupees = "0", paisa = ""] = normalized.split(".");
  const amount = Number(rupees) * 100 + Number(paisa.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}
