const HALALA_NOISE = 1e-6;

export function toHalalas(amount: number): number {
  return Math.round(amount * 100);
}

export function isTwoDecimalAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < HALALA_NOISE;
}

export function canonicalAmount(amount: number): number {
  return toHalalas(amount) / 100;
}

export function formatHalalas(halalas: number): string {
  return (halalas / 100).toFixed(2);
}
