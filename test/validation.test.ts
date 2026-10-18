import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/index.js';
import { buildSessionBody } from '../src/resources/checkout.js';
import { THREE_LINE_BASKET, item, sampleSession } from './helpers/fixtures.js';

function fields(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    const failure = error as ValidationError;
    expect(failure.code).toBe('VALIDATION_ERROR');
    expect(failure.httpStatus).toBeNull();
    return failure.errors.map((e) => `${e.field}: ${e.message}`);
  }
  throw new Error('expected a ValidationError');
}

describe('client-side basket validation', () => {
  it('accepts the three-line bench basket exactly to the halala', () => {
    expect(() => buildSessionBody(sampleSession())).not.toThrow();
  });

  it('accepts a basket whose parts only add up in halalas', () => {
    const lines = [item('A', 'a', 'physical', 3, 0.1), item('B', 'b', 'physical', 1, 0.2)];
    expect(0.1 * 3).not.toBe(0.3);
    expect(() => buildSessionBody(sampleSession({ items: lines, totalAmount: 0.5, taxAmount: 0, shippingAmount: 0, discountAmount: 0 }))).not.toThrow();
  });

  it('names the failing line when an item total does not match', () => {
    const wrong = { ...item('SKU-2', 'USB-C Cable', 'physical', 3, 45), totalAmount: 130 };
    const lines = [THREE_LINE_BASKET[0]!, wrong, THREE_LINE_BASKET[2]!];
    expect(fields(() => buildSessionBody(sampleSession({ items: lines })))).toEqual([
      'items[1].totalAmount: must equal quantity x unitPrice - discountAmount (expected 135.00, got 130.00)',
    ]);
  });

  it('accounts for a line discount in the item identity', () => {
    const discounted = { ...item('D', 'd', 'physical', 2, 50), discountAmount: 10, totalAmount: 90 };
    expect(() => buildSessionBody(sampleSession({ items: [discounted], totalAmount: 90, taxAmount: 0, shippingAmount: 0, discountAmount: 0 }))).not.toThrow();
  });

  it('names totalAmount when the basket does not add up', () => {
    expect(fields(() => buildSessionBody(sampleSession({ totalAmount: 1302.11 })))).toEqual([
      'totalAmount: must equal the sum of item totals + taxAmount + shippingAmount - discountAmount (expected 1302.10, got 1302.11)',
    ]);
  });

  it('refuses a zero quantity and a negative price', () => {
    expect(fields(() => buildSessionBody(sampleSession({ items: [item('Z', 'Ghost', 'physical', 0, 100)], totalAmount: 0 })))).toEqual([
      'items[0].quantity: must be at least 1',
    ]);
    expect(fields(() => buildSessionBody(sampleSession({ items: [{ ...item('N', 'Negative', 'physical', 1, -100), totalAmount: -100 }], totalAmount: -100 })))).toEqual([
      'totalAmount: must not be negative',
      'items[0].unitPrice: must not be negative',
      'items[0].totalAmount: must not be negative',
    ]);
  });

  it('refuses a third decimal place, naming the field', () => {
    expect(fields(() => buildSessionBody(sampleSession({ shippingAmount: 25.005 })))).toEqual(['shippingAmount: must have at most two decimal places']);
    expect(fields(() => buildSessionBody(sampleSession({ items: [{ ...item('A', 'a', 'physical', 1, 1.005), totalAmount: 1.005 }], totalAmount: 1.005, taxAmount: 0, shippingAmount: 0, discountAmount: 0 })))).toEqual([
      'totalAmount: must have at most two decimal places',
      'items[0].unitPrice: must have at most two decimal places',
      'items[0].totalAmount: must have at most two decimal places',
    ]);
  });

  it('refuses an empty cart and a non-integer quantity', () => {
    expect(fields(() => buildSessionBody(sampleSession({ items: [] })))).toEqual(['items: must contain at least one entry']);
    expect(fields(() => buildSessionBody(sampleSession({ items: [{ ...item('A', 'a', 'physical', 1, 10), quantity: 1.5 }], totalAmount: 10, taxAmount: 0, shippingAmount: 0, discountAmount: 0 })))).toEqual([
      'items[0].quantity: must be an integer',
    ]);
  });

  it('refuses an unknown paymentType and item type', () => {
    expect(fields(() => buildSessionBody(sampleSession({ paymentType: 'pay_later' as never })))).toEqual([
      'paymentType: must be one of pay_by_instalments, pay_now, pay_next_month, pay_in_full',
    ]);
    expect(fields(() => buildSessionBody(sampleSession({ items: [{ ...item('A', 'a', 'physical', 1, 10), type: 'service' as never }], totalAmount: 10, taxAmount: 0, shippingAmount: 0, discountAmount: 0 })))).toEqual([
      'items[0].type: must be one of physical, digital',
    ]);
  });

  it('validates the national id format when given', () => {
    const base = sampleSession();
    expect(fields(() => buildSessionBody({ ...base, consumer: { ...base.consumer, nationalId: '3123456789' } }))).toEqual([
      'consumer.nationalId: must be 10 digits starting with 1 or 2',
    ]);
    expect(fields(() => buildSessionBody({ ...base, consumer: { ...base.consumer, nationalId: '112345678' } }))).toEqual([
      'consumer.nationalId: must be 10 digits starting with 1 or 2',
    ]);
    expect(() => buildSessionBody({ ...base, consumer: { ...base.consumer, nationalId: '1123456789' } })).not.toThrow();
    expect(() => buildSessionBody({ ...base, consumer: { ...base.consumer, nationalId: '2123456789' } })).not.toThrow();
  });

  it('requires the consumer, the shipping address and the reference', () => {
    const base = sampleSession();
    expect(fields(() => buildSessionBody({ ...base, shippingAddress: undefined as never }))).toEqual(['shippingAddress: is required']);
    expect(fields(() => buildSessionBody({ ...base, shippingAddress: { ...base.shippingAddress, line1: '' } }))).toEqual(['shippingAddress.line1: is required']);
    expect(fields(() => buildSessionBody({ ...base, consumer: { firstName: 'N' } as never }))).toEqual([
      'consumer.lastName: is required',
      'consumer.phoneNumber: is required',
    ]);
    expect(fields(() => buildSessionBody({ ...base, orderReferenceId: '' }))).toEqual(['orderReferenceId: is required']);
    expect(fields(() => buildSessionBody({ ...base, orderReferenceId: 'x'.repeat(256) }))).toEqual(['orderReferenceId: must be at most 255 characters']);
    expect(() => buildSessionBody({ ...base, orderReferenceId: 'x'.repeat(255) })).not.toThrow();
  });

  it('refuses an incomplete merchantUrl and a bad instalment count', () => {
    expect(fields(() => buildSessionBody(sampleSession({ merchantUrl: { success: 'https://a' } as never })))).toEqual(['merchantUrl.failure: is required']);
    expect(fields(() => buildSessionBody(sampleSession({ instalments: 0 })))).toEqual(['instalments: must be at least 1']);
  });

  it('applies the return-URL contract to merchantUrl', () => {
    const ok = (urls: Record<string, unknown>) => expect(() => buildSessionBody(sampleSession({ merchantUrl: urls as never }))).not.toThrow();
    const bad = (urls: Record<string, unknown>) => fields(() => buildSessionBody(sampleSession({ merchantUrl: urls as never })));
    ok({ success: 'https://shop.example/r?order=1', failure: 'https://shop.example/r?order=1' });
    ok({ success: 'https://shop.example/r', failure: 'https://shop.example/r', cancel: 'http://localhost:3000/cart' });
    ok({ success: 'myshop://qasimha/return', failure: 'myshop://qasimha/return', notification: null });
    expect(bad({ success: 'http://shop.example/r', failure: 'https://shop.example/r' })).toEqual(['merchantUrl.success: must use https, http on localhost or 127.0.0.1, or a custom app scheme']);
    expect(bad({ success: 'https://shop.example/r', failure: 'javascript:alert(1)' })).toEqual(['merchantUrl.failure: must use https, http on localhost or 127.0.0.1, or a custom app scheme']);
    expect(bad({ success: 'https://shop.example/r', failure: 'https://shop.example/r', cancel: 'ab://x' })).toEqual(['merchantUrl.cancel: must use https, http on localhost or 127.0.0.1, or a custom app scheme']);
    expect(bad({ success: 'https://shop.example/r#done', failure: 'https://shop.example/r' })).toEqual(['merchantUrl.success: must not carry a fragment']);
    expect(bad({ success: '/relative', failure: 'https://shop.example/r' })).toEqual(['merchantUrl.success: must be an absolute URL']);
    expect(bad({ success: `https://shop.example/${'x'.repeat(1024)}`, failure: 'https://shop.example/r' })).toEqual(['merchantUrl.success: must be at most 1024 characters']);
    expect(bad({ success: 'https://shop.example/r', failure: 'https://shop.example/r', notification: 'https://hooks.example/x' })).toEqual(['merchantUrl.notification: is reserved and must not be set']);
  });

  it('collects every failure into one error with a readable message', () => {
    const error = (() => {
      try {
        buildSessionBody(sampleSession({ totalAmount: 1, taxAmount: 1.111 }));
      } catch (e) {
        return e as ValidationError;
      }
      return null;
    })();
    expect(error?.message).toBe('Request refused before sending: taxAmount: must have at most two decimal places');
  });
});
