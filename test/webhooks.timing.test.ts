import { timingSafeEqual } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyWebhookSignature } from '../src/index.js';
import { fixture, type WebhookFixture } from './helpers/fixtures.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const fx = fixture<WebhookFixture>('webhook-signature.json');
const compare = vi.mocked(timingSafeEqual);

beforeEach(() => {
  compare.mockClear();
});

describe('constant-time comparison', () => {
  it('compares a well-formed sha256= digest through timingSafeEqual exactly once', () => {
    expect(() => verifyWebhookSignature(fx.v0.body, `sha256=${'0'.repeat(64)}`, fx.secret)).toThrow(/does not match/);
    expect(compare).toHaveBeenCalledTimes(1);
    const [a, b] = compare.mock.calls[0] as [Buffer, Buffer];
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
  });

  it('compares every v1 candidate without stopping at the first mismatch', () => {
    expect(() => verifyWebhookSignature(fx.v1.body, fx.v1.rotated, fx.secret, { now: fx.timestamp })).not.toThrow();
    expect(compare).toHaveBeenCalledTimes(2);
  });

  it('never reaches the comparison for a malformed or missing header', () => {
    expect(() => verifyWebhookSignature(fx.v0.body, 'sha256=short', fx.secret)).toThrow(/64-character/);
    expect(() => verifyWebhookSignature(fx.v0.body, null, fx.secret)).toThrow(/no X-Qasimha-Signature/);
    expect(() => verifyWebhookSignature(fx.v1.body, `t=${fx.timestamp},v1=nothex`, fx.secret, { now: fx.timestamp })).toThrow(/64-character/);
    expect(compare).not.toHaveBeenCalled();
  });

  it('checks the timestamp before spending a comparison', () => {
    expect(() => verifyWebhookSignature(fx.v1.body, fx.v1.signatureHeader, fx.secret, { now: fx.nowOutsideTolerance })).toThrow(/tolerance/);
    expect(compare).not.toHaveBeenCalled();
  });
});
