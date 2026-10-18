import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import Qasimha, { ConfigurationError, ValidationError, WebhookSignatureError, constructWebhookEvent, verifyWebhookSignature } from '../src/index.js';
import { fixture, type WebhookFixture } from './helpers/fixtures.js';

const fx = fixture<WebhookFixture>('webhook-signature.json');

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WebhookSignatureError);
    return (error as WebhookSignatureError).reason;
  }
  throw new Error('expected WebhookSignatureError');
}

describe('contract vectors', () => {
  it('reproduces the recorded sha256= digest exactly', () => {
    const digest = createHmac('sha256', fx.secret).update(fx.v0.body).digest('hex');
    expect(`sha256=${digest}`).toBe(fx.v0.signatureHeader);
    expect(fx.v0.signatureHeader).toBe('sha256=30babb40a6df2b6d212dc38bbeb7af79a6517cd037368354dd9e44eda1b9a092');
  });

  it('reproduces the recorded t=,v1= digest exactly', () => {
    const digest = createHmac('sha256', fx.secret).update(`${fx.timestamp}.${fx.v1.body}`).digest('hex');
    expect(fx.v1.signatureHeader).toBe(`t=${fx.timestamp},v1=${digest}`);
    expect(digest).toBe('1eb16bb179f2c348a6e3d889fc70f71e9656aa50636e8d19de4de28cd03f337b');
    expect(fx.v1.rotated.endsWith(`,v1=${digest}`)).toBe(true);
  });

  it('pins the shared fixture values', () => {
    expect(fx.secret).toBe('whsec_test_0123456789abcdef');
    expect(fx.timestamp).toBe(1758790800);
    expect(fx.tolerance).toBe(300);
    expect(fx.v0.timestampHeader).toBe(String(fx.timestamp));
  });
});

describe('verifySignature (sha256= format)', () => {
  it('accepts the vector within tolerance', () => {
    expect(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, fx.secret, { timestampHeader: fx.v0.timestampHeader, now: fx.nowWithinTolerance })).not.toThrow();
    expect(() => verifyWebhookSignature(Buffer.from(fx.v0.body), fx.v0.signatureHeader, fx.secret, { timestampHeader: fx.v0.timestampHeader, now: new Date(fx.nowWithinTolerance * 1000) })).not.toThrow();
    expect(() => verifyWebhookSignature(new TextEncoder().encode(fx.v0.body), fx.v0.signatureHeader.toUpperCase().replace('SHA256=', 'sha256='), fx.secret, { now: fx.nowWithinTolerance })).not.toThrow();
  });

  it('rejects the vector outside tolerance when a timestamp header is supplied', () => {
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, fx.secret, { timestampHeader: fx.v0.timestampHeader, now: fx.nowOutsideTolerance }))).toBe('timestamp_outside_tolerance');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, fx.secret, { timestampHeader: fx.v0.timestampHeader, now: fx.timestamp - 301 }))).toBe('timestamp_outside_tolerance');
    expect(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, fx.secret, { timestampHeader: fx.v0.timestampHeader, now: fx.timestamp + 300 })).not.toThrow();
    expect(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, fx.secret, { timestampHeader: fx.v0.timestampHeader, now: fx.nowOutsideTolerance, tolerance: 600 })).not.toThrow();
  });

  it('does not apply a tolerance check without a timestamp header', () => {
    expect(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, fx.secret, { now: fx.nowOutsideTolerance })).not.toThrow();
  });

  it('rejects a tampered body, a wrong secret and a non-hex digest', () => {
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body.replace('1200.00', '1.00'), fx.v0.signatureHeader, fx.secret))).toBe('signature_mismatch');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, 'whsec_other'))).toBe('signature_mismatch');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, 'sha256=abc', fx.secret))).toBe('malformed_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, `sha256=${'g'.repeat(64)}`, fx.secret))).toBe('malformed_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, fx.secret, { timestampHeader: 'yesterday' }))).toBe('malformed_header');
  });

  it('reports a missing or unrecognised header', () => {
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, undefined, fx.secret))).toBe('missing_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, '', fx.secret))).toBe('missing_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, [], fx.secret))).toBe('missing_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, 'md5=abc', fx.secret))).toBe('malformed_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, 'v1=abc', fx.secret))).toBe('malformed_header');
  });

  it('refuses to run without a secret', () => {
    expect(() => verifyWebhookSignature(fx.v0.body, fx.v0.signatureHeader, '')).toThrow(ConfigurationError);
  });
});

describe('verifySignature (t=,v1= format)', () => {
  it('accepts the vector and the rotated header with two v1 values', () => {
    expect(() => verifyWebhookSignature(fx.v1.body, fx.v1.signatureHeader, fx.secret, { now: fx.nowWithinTolerance })).not.toThrow();
    expect(() => verifyWebhookSignature(fx.v1.body, fx.v1.rotated, fx.secret, { now: fx.nowWithinTolerance })).not.toThrow();
    const reordered = `v1=${'0'.repeat(64)}, t=${fx.timestamp}, v1=1eb16bb179f2c348a6e3d889fc70f71e9656aa50636e8d19de4de28cd03f337b`;
    expect(() => verifyWebhookSignature(fx.v1.body, reordered, fx.secret, { now: fx.nowWithinTolerance })).not.toThrow();
  });

  it('rejects when the timestamp is outside tolerance, whatever the X-Qasimha-Timestamp header says', () => {
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, fx.v1.signatureHeader, fx.secret, { now: fx.nowOutsideTolerance }))).toBe('timestamp_outside_tolerance');
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, fx.v1.signatureHeader, fx.secret, { now: fx.nowOutsideTolerance, timestampHeader: String(fx.nowOutsideTolerance) }))).toBe('timestamp_outside_tolerance');
  });

  it('rejects malformed headers', () => {
    const good = '1eb16bb179f2c348a6e3d889fc70f71e9656aa50636e8d19de4de28cd03f337b';
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, `t=${fx.timestamp}`, fx.secret, { now: fx.timestamp }))).toBe('malformed_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, `t=${fx.timestamp},v1=abc`, fx.secret, { now: fx.timestamp }))).toBe('malformed_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, `t=abc,v1=${good}`, fx.secret, { now: fx.timestamp }))).toBe('malformed_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, `t=${fx.timestamp},t=${fx.timestamp},v1=${good}`, fx.secret, { now: fx.timestamp }))).toBe('malformed_header');
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, `t=${fx.timestamp},garbage,v1=${good}`, fx.secret, { now: fx.timestamp }))).toBe('malformed_header');
  });

  it('ignores unknown scheme elements for forward compatibility', () => {
    const good = '1eb16bb179f2c348a6e3d889fc70f71e9656aa50636e8d19de4de28cd03f337b';
    expect(() => verifyWebhookSignature(fx.v1.body, `t=${fx.timestamp},v2=zzz,v1=${good}`, fx.secret, { now: fx.timestamp })).not.toThrow();
  });

  it('rejects a mismatch and a wrong secret', () => {
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, `t=${fx.timestamp},v1=${'0'.repeat(64)}`, fx.secret, { now: fx.timestamp }))).toBe('signature_mismatch');
    expect(reasonOf(() => verifyWebhookSignature(fx.v1.body, fx.v1.signatureHeader, 'whsec_other', { now: fx.timestamp }))).toBe('signature_mismatch');
    expect(reasonOf(() => verifyWebhookSignature(fx.v0.body, fx.v1.signatureHeader, fx.secret, { now: fx.timestamp }))).toBe('signature_mismatch');
  });
});

describe('constructEvent', () => {
  const opts = { now: fx.nowWithinTolerance };

  it('builds the event from a v0 delivery with header names as sent', () => {
    const event = constructWebhookEvent(fx.v0.body, fx.v0.headers, fx.secret, opts);
    expect(event).toEqual({
      id: 'evt_0123456789abcdef0123456789abcdef',
      type: 'order.completed',
      orderId: null,
      orderReferenceId: 'ORDER-1',
      status: 'Confirmed',
      amount: 1200,
      currency: 'SAR',
      occurredAt: '2026-09-25T09:00:00Z',
      raw: JSON.parse(fx.v0.body),
    });
  });

  it('builds the event from a v1 delivery including the order id', () => {
    const event = constructWebhookEvent(Buffer.from(fx.v1.body), fx.v1.headers, fx.secret, opts);
    expect(event).toMatchObject({
      id: 'evt_1',
      type: 'order.confirmed',
      orderId: '9a2e6c4b-1111-4c2d-8a1f-000000000001',
      orderReferenceId: 'ORDER-1',
      status: 'Confirmed',
      amount: 1200,
      currency: 'SAR',
      occurredAt: '2026-09-25T09:00:00Z',
    });
    expect((event.raw['data'] as { order: { totalAmount: number } }).order.totalAmount).toBe(1200);
  });

  it('reads Node lowercase headers, array values, Fetch Headers and the explicit form', () => {
    const lower = Object.fromEntries(Object.entries(fx.v0.headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(constructWebhookEvent(fx.v0.body, lower, fx.secret, opts).id).toBe('evt_0123456789abcdef0123456789abcdef');
    expect(constructWebhookEvent(fx.v0.body, { ...lower, 'x-qasimha-signature': [fx.v0.signatureHeader] }, fx.secret, opts).type).toBe('order.completed');
    expect(constructWebhookEvent(fx.v0.body, new Headers(fx.v0.headers), fx.secret, opts).type).toBe('order.completed');
    expect(constructWebhookEvent(fx.v0.body, { signature: fx.v0.signatureHeader, timestamp: fx.v0.timestampHeader }, fx.secret, opts).status).toBe('Confirmed');
  });

  it('applies the timestamp header tolerance in the v0 format', () => {
    expect(reasonOf(() => constructWebhookEvent(fx.v0.body, fx.v0.headers, fx.secret, { now: fx.nowOutsideTolerance }))).toBe('timestamp_outside_tolerance');
    expect(reasonOf(() => constructWebhookEvent(fx.v0.body, { 'x-qasimha-signature': fx.v0.signatureHeader }, fx.secret, { now: fx.nowOutsideTolerance, timestampHeader: fx.v0.timestampHeader }))).toBe('timestamp_outside_tolerance');
    expect(() => constructWebhookEvent(fx.v0.body, { 'x-qasimha-signature': fx.v0.signatureHeader }, fx.secret, { now: fx.nowOutsideTolerance })).not.toThrow();
  });

  it('never accepts an unsigned delivery', () => {
    expect(reasonOf(() => constructWebhookEvent(fx.v0.body, {}, fx.secret, opts))).toBe('missing_header');
    expect(reasonOf(() => constructWebhookEvent(fx.v0.body, { 'x-qasimha-timestamp': fx.v0.timestampHeader }, fx.secret, opts))).toBe('missing_header');
  });

  it('falls back to the event headers when the body has no ids, and rejects a non-JSON body', () => {
    const body = '{"orderReferenceId":"R","status":"completed","amount":5,"currency":"SAR","occurredAt":"2026-09-25T09:00:00Z"}';
    const signature = `sha256=${createHmac('sha256', fx.secret).update(body).digest('hex')}`;
    const event = constructWebhookEvent(body, { 'x-qasimha-signature': signature, 'x-qasimha-event-id': 'evt_h', 'x-qasimha-event': 'order.completed' }, fx.secret);
    expect(event).toMatchObject({ id: 'evt_h', type: 'order.completed', orderReferenceId: 'R', status: 'completed', amount: 5 });

    const notJson = 'not json';
    const sig = `sha256=${createHmac('sha256', fx.secret).update(notJson).digest('hex')}`;
    expect(() => constructWebhookEvent(notJson, { 'x-qasimha-signature': sig }, fx.secret)).toThrow(ValidationError);
  });

  it('fails on a re-serialised body because the bytes differ', () => {
    const reserialised = JSON.stringify(JSON.parse(fx.v0.body));
    expect(reserialised).not.toBe(fx.v0.body);
    expect(reasonOf(() => constructWebhookEvent(reserialised, fx.v0.headers, fx.secret, opts))).toBe('signature_mismatch');
  });
});

describe('client.webhooks', () => {
  it('uses the configured secret, or an explicit one, and refuses to run without either', () => {
    const configured = new Qasimha({ apiKey: 'sk_test_abc', webhookSecret: fx.secret });
    expect(configured.webhooks.constructEvent(fx.v1.body, fx.v1.headers, undefined, { now: fx.timestamp }).id).toBe('evt_1');
    expect(() => configured.webhooks.verifySignature(fx.v1.body, fx.v1.signatureHeader, null, { now: fx.timestamp })).not.toThrow();
    expect(reasonOf(() => configured.webhooks.verifySignature(fx.v1.body, fx.v1.signatureHeader, 'whsec_other', { now: fx.timestamp }))).toBe('signature_mismatch');

    const bare = new Qasimha({ apiKey: 'sk_test_abc' });
    expect(() => bare.webhooks.constructEvent(fx.v1.body, fx.v1.headers)).toThrow(ConfigurationError);
    expect(bare.webhooks.constructEvent(fx.v1.body, fx.v1.headers, fx.secret, { now: fx.timestamp }).type).toBe('order.confirmed');
  });

  it('keeps the webhook secret out of the client serialisation', () => {
    const client = new Qasimha({ apiKey: 'sk_test_abc', webhookSecret: 'whsec_super_secret' });
    expect(JSON.stringify(client)).not.toContain('whsec');
    expect(String(client)).not.toContain('whsec');
  });
});
