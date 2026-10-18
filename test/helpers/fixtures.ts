import { readFileSync } from 'node:fs';
import type { CreateSessionRequest, Item } from '../../src/index.js';

const FIXTURES_DIR = new URL('../../../../contract/fixtures/', import.meta.url);

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURES_DIR), 'utf8')) as T;
}

export interface WebhookFixture {
  secret: string;
  timestamp: number;
  v0: { body: string; signatureHeader: string; timestampHeader: string; headers: Record<string, string> };
  v1: { body: string; signatureHeader: string; rotated: string; headers: Record<string, string> };
  tolerance: number;
  nowWithinTolerance: number;
  nowOutsideTolerance: number;
}

export function item(referenceId: string, name: string, type: 'physical' | 'digital', quantity: number, unitPrice: number): Item {
  return {
    referenceId,
    name,
    type,
    sku: referenceId,
    quantity,
    unitPrice,
    totalAmount: Math.round(quantity * unitPrice * 100) / 100,
    taxAmount: 0,
    discountAmount: 0,
    imageUrl: null,
  };
}

export const THREE_LINE_BASKET: Item[] = [
  item('SKU-1', 'Wireless Headphones', 'physical', 1, 899.0),
  item('SKU-2', 'USB-C Cable', 'physical', 3, 45.0),
  item('SKU-3', 'Extended Warranty', 'digital', 1, 120.0),
];

export function cart(
  orderReferenceId: string,
  totalAmount: number,
  taxAmount: number,
  shippingAmount: number,
  discountAmount: number,
  items: Item[],
): CreateSessionRequest {
  return {
    orderReferenceId,
    totalAmount,
    taxAmount,
    shippingAmount,
    discountAmount,
    currencyCode: 'SAR',
    countryCode: 'SA',
    description: 'Cart contract test',
    paymentType: 'pay_by_instalments',
    instalments: 4,
    items,
    consumer: {
      firstName: 'Noura',
      lastName: 'Al-Shammari',
      phoneNumber: '+966512349999',
      email: 'cart-shopper@qasimha.test',
    },
    shippingAddress: {
      firstName: 'Noura',
      lastName: 'Al-Shammari',
      line1: 'King Fahd Rd',
      line2: null,
      city: 'Riyadh',
      region: 'Riyadh',
      postalCode: '12345',
      countryCode: 'SA',
      phoneNumber: '+966512349999',
    },
    billingAddress: null,
    riskAssessment: null,
  };
}

export function sampleSession(overrides: Partial<CreateSessionRequest> = {}): CreateSessionRequest {
  return { ...cart('CART-TEST-A', 1302.1, 173.1, 25.0, 50.0, THREE_LINE_BASKET), ...overrides };
}
