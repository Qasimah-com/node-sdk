import { describe, expect, it } from 'vitest';
import { canonicalAmount, isTwoDecimalAmount, toHalalas } from '../src/index.js';

describe('money helpers', () => {
  it('converts to integer halalas without float drift', () => {
    expect(toHalalas(1302.1)).toBe(130210);
    expect(toHalalas(0.1 + 0.2)).toBe(30);
    expect(toHalalas(1.15)).toBe(115);
    expect(toHalalas(4.35)).toBe(435);
    expect(toHalalas(0)).toBe(0);
  });

  it('accepts two-decimal amounts and float noise, refuses a real third decimal', () => {
    expect(isTwoDecimalAmount(10)).toBe(true);
    expect(isTwoDecimalAmount(10.5)).toBe(true);
    expect(isTwoDecimalAmount(10.55)).toBe(true);
    expect(isTwoDecimalAmount(0.1 + 0.2)).toBe(true);
    expect(isTwoDecimalAmount(899 + 135 + 120 + 173.1 + 25 - 50)).toBe(true);
    expect(isTwoDecimalAmount(10.555)).toBe(false);
    expect(isTwoDecimalAmount(1.005)).toBe(false);
    expect(isTwoDecimalAmount(0.001)).toBe(false);
    expect(isTwoDecimalAmount(Number.NaN)).toBe(false);
    expect(isTwoDecimalAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isTwoDecimalAmount('10.00')).toBe(false);
    expect(isTwoDecimalAmount(null)).toBe(false);
  });

  it('canonicalises to the nearest halala', () => {
    expect(canonicalAmount(0.1 + 0.2)).toBe(0.3);
    expect(canonicalAmount(1302.1)).toBe(1302.1);
    expect(canonicalAmount(45 * 3)).toBe(135);
  });
});
