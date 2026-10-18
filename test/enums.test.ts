import { describe, expect, it } from 'vitest';
import {
  INSTALLMENT_STATUS_NAMES,
  ORDER_CHANNEL_NAMES,
  ORDER_STATUS_NAMES,
  PAYMENT_TYPE_NAMES,
  normaliseEnum,
  normaliseInstallmentStatus,
  normaliseOrderChannel,
  normaliseOrderStatus,
  normalisePaymentType,
} from '../src/index.js';

describe('enum normalisation', () => {
  it('carries the documented numbering', () => {
    expect(ORDER_STATUS_NAMES).toEqual([
      'Draft', 'New', 'Approved', 'Declined', 'Expired', 'Confirmed', 'FullyFulfilled', 'PartiallyFulfilled',
      'FullyReversed', 'PartiallyReversed', 'Voided', 'Updated', 'AwaitingCheckout', 'Cancelled', 'Settled', 'WrittenOff',
    ]);
    expect(ORDER_CHANNEL_NAMES).toEqual(['Online', 'InStore', 'QrCode']);
    expect(PAYMENT_TYPE_NAMES).toEqual(['PayByInstalments', 'PayNow', 'PayNextMonth', 'PayInFull']);
    expect(INSTALLMENT_STATUS_NAMES).toEqual(['Scheduled', 'Paid', 'Late', 'Reversed', 'Waived']);
  });

  it('maps integers and integer strings to names', () => {
    expect(normaliseOrderStatus(3)).toBe('Declined');
    expect(normaliseOrderStatus(15)).toBe('WrittenOff');
    expect(normaliseOrderStatus('12')).toBe('AwaitingCheckout');
    expect(normaliseOrderChannel(2)).toBe('QrCode');
    expect(normalisePaymentType(0)).toBe('PayByInstalments');
    expect(normaliseInstallmentStatus(4)).toBe('Waived');
  });

  it('accepts names in any casing and returns the canonical spelling', () => {
    expect(normaliseOrderStatus('confirmed')).toBe('Confirmed');
    expect(normaliseOrderStatus('FULLYFULFILLED')).toBe('FullyFulfilled');
    expect(normaliseOrderChannel(' online ')).toBe('Online');
  });

  it('passes an unknown value through as a string instead of throwing', () => {
    expect(normaliseOrderStatus(99)).toBe('99');
    expect(normaliseOrderStatus('Frozen')).toBe('Frozen');
    expect(normaliseOrderStatus(true)).toBe('true');
    expect(normaliseEnum(['A'], 1)).toBe('1');
  });

  it('maps null and undefined to null', () => {
    expect(normaliseOrderStatus(null)).toBeNull();
    expect(normaliseOrderStatus(undefined)).toBeNull();
  });
});
