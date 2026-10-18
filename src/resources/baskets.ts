import { formatHalalas, toHalalas } from '../money.js';
import type { Address, Consumer, MerchantUrl, RiskAssessment } from '../models.js';
import { FieldErrors, NATIONAL_ID_PATTERN, isRecord } from '../validation.js';

export const ITEM_TYPES = ['physical', 'digital'] as const;

export interface BuiltItems {
  items: Record<string, unknown>[];
  halalas: number;
  valid: boolean;
}

export function buildItems(errors: FieldErrors, value: unknown): BuiltItems {
  const before = errors.list.length;
  const list = errors.nonEmptyArray('items', value) ?? [];
  let halalas = 0;
  const items = list.map((entry, index) => {
    const prefix = `items[${index}]`;
    if (!isRecord(entry)) {
      errors.add(prefix, 'must be an object');
      return {};
    }
    const referenceId = errors.requiredString(`${prefix}.referenceId`, entry['referenceId']);
    const name = errors.requiredString(`${prefix}.name`, entry['name']);
    const type = errors.oneOf(`${prefix}.type`, entry['type'], ITEM_TYPES, { required: true });
    const sku = errors.optionalString(`${prefix}.sku`, entry['sku']);
    const quantity = errors.integer(`${prefix}.quantity`, entry['quantity'], { min: 1, required: true });
    const unitPrice = errors.amount(`${prefix}.unitPrice`, entry['unitPrice'], { required: true });
    const totalAmount = errors.amount(`${prefix}.totalAmount`, entry['totalAmount'], { required: true });
    const taxAmount = errors.amount(`${prefix}.taxAmount`, entry['taxAmount'], { defaultValue: 0 });
    const discountAmount = errors.amount(`${prefix}.discountAmount`, entry['discountAmount'], { defaultValue: 0 });
    const imageUrl = errors.optionalString(`${prefix}.imageUrl`, entry['imageUrl']);

    if (quantity !== null && unitPrice !== null && totalAmount !== null && discountAmount !== null) {
      const expected = quantity * toHalalas(unitPrice) - toHalalas(discountAmount);
      const actual = toHalalas(totalAmount);
      if (actual !== expected) {
        errors.add(
          `${prefix}.totalAmount`,
          `must equal quantity x unitPrice - discountAmount (expected ${formatHalalas(expected)}, got ${formatHalalas(actual)})`,
        );
      }
      halalas += actual;
    }

    return {
      referenceId,
      name,
      type,
      sku: sku ?? null,
      quantity,
      unitPrice,
      totalAmount,
      taxAmount,
      discountAmount,
      imageUrl: imageUrl ?? null,
    };
  });
  return { items, halalas, valid: errors.list.length === before };
}

export interface BasketTotals {
  totalAmount: number | null;
  taxAmount: number | null;
  shippingAmount: number | null;
  discountAmount: number | null;
}

export function checkBasket(errors: FieldErrors, totals: BasketTotals, built: BuiltItems): void {
  const { totalAmount, taxAmount, shippingAmount, discountAmount } = totals;
  if (!built.valid || totalAmount === null || taxAmount === null || shippingAmount === null || discountAmount === null) {
    return;
  }
  const expected = built.halalas + toHalalas(taxAmount) + toHalalas(shippingAmount) - toHalalas(discountAmount);
  const actual = toHalalas(totalAmount);
  if (actual !== expected) {
    errors.add(
      'totalAmount',
      `must equal the sum of item totals + taxAmount + shippingAmount - discountAmount (expected ${formatHalalas(expected)}, got ${formatHalalas(actual)})`,
    );
  }
}

export function buildConsumer(
  errors: FieldErrors,
  value: unknown,
  options: { emailRequired: boolean },
): Record<string, unknown> | null {
  const consumer = errors.requiredObject('consumer', value) as Partial<Consumer> | null;
  if (!consumer) return null;
  const firstName = errors.requiredString('consumer.firstName', consumer.firstName);
  const lastName = errors.requiredString('consumer.lastName', consumer.lastName);
  const phoneNumber = errors.requiredString('consumer.phoneNumber', consumer.phoneNumber);
  const email = options.emailRequired
    ? errors.requiredString('consumer.email', consumer.email)
    : errors.optionalString('consumer.email', consumer.email);
  const nationalId = errors.optionalString('consumer.nationalId', consumer.nationalId);
  if (nationalId !== undefined && !NATIONAL_ID_PATTERN.test(nationalId)) {
    errors.add('consumer.nationalId', 'must be 10 digits starting with 1 or 2');
  }
  return { firstName, lastName, phoneNumber, email: email ?? null, nationalId: nationalId ?? null };
}

export function buildAddress(
  errors: FieldErrors,
  field: string,
  value: unknown,
  required: boolean,
): Record<string, unknown> | null | undefined {
  const address = (required ? errors.requiredObject(field, value) : errors.optionalObject(field, value)) as
    | Partial<Address>
    | null
    | undefined;
  if (!address) return required ? null : undefined;
  return {
    firstName: errors.requiredString(`${field}.firstName`, address.firstName),
    lastName: errors.requiredString(`${field}.lastName`, address.lastName),
    line1: errors.requiredString(`${field}.line1`, address.line1),
    line2: errors.optionalString(`${field}.line2`, address.line2) ?? null,
    city: errors.requiredString(`${field}.city`, address.city),
    region: errors.optionalString(`${field}.region`, address.region) ?? null,
    postalCode: errors.optionalString(`${field}.postalCode`, address.postalCode) ?? null,
    countryCode: errors.requiredString(`${field}.countryCode`, address.countryCode),
    phoneNumber: errors.optionalString(`${field}.phoneNumber`, address.phoneNumber) ?? null,
  };
}

export function buildRiskAssessment(errors: FieldErrors, value: unknown): Record<string, unknown> | undefined {
  const risk = errors.optionalObject('riskAssessment', value) as Partial<RiskAssessment> | undefined;
  if (!risk) return undefined;
  const out: Record<string, unknown> = {};
  const customerDob = errors.optionalString('riskAssessment.customerDob', risk.customerDob);
  const customerGender = errors.optionalString('riskAssessment.customerGender', risk.customerGender);
  const isExistingCustomer = errors.boolean('riskAssessment.isExistingCustomer', risk.isExistingCustomer);
  const orderIsDigital = errors.boolean('riskAssessment.orderIsDigital', risk.orderIsDigital);
  const totalOrderCount = errors.integer('riskAssessment.totalOrderCount', risk.totalOrderCount, { min: 0 });
  const dateOfFirstTransaction = errors.optionalString(
    'riskAssessment.dateOfFirstTransaction',
    risk.dateOfFirstTransaction,
  );
  if (customerDob !== undefined) out['customerDob'] = customerDob;
  if (customerGender !== undefined) out['customerGender'] = customerGender;
  if (isExistingCustomer !== undefined) out['isExistingCustomer'] = isExistingCustomer;
  if (orderIsDigital !== undefined) out['orderIsDigital'] = orderIsDigital;
  if (totalOrderCount !== null) out['totalOrderCount'] = totalOrderCount;
  if (dateOfFirstTransaction !== undefined) out['dateOfFirstTransaction'] = dateOfFirstTransaction;
  return out;
}

const RESERVED_RETURN_SCHEMES = new Set(['http', 'https', 'javascript', 'data', 'file', 'blob', 'vbscript']);
const MAX_RETURN_URL_LENGTH = 1024;

function checkReturnUrl(errors: FieldErrors, field: string, value: unknown, required: boolean): string | undefined {
  const url = required ? errors.requiredString(field, value) : errors.optionalString(field, value);
  if (url === null || url === undefined) return undefined;
  if (url.length > MAX_RETURN_URL_LENGTH) {
    errors.add(field, `must be at most ${MAX_RETURN_URL_LENGTH} characters`);
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    errors.add(field, 'must be an absolute URL');
    return undefined;
  }
  if (url.includes('#')) {
    errors.add(field, 'must not carry a fragment');
    return undefined;
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const allowed =
    scheme === 'https' || (scheme === 'http' && local) || (!RESERVED_RETURN_SCHEMES.has(scheme) && scheme.length >= 3);
  if (!allowed) {
    errors.add(field, 'must use https, http on localhost or 127.0.0.1, or a custom app scheme');
    return undefined;
  }
  return url;
}

export function buildMerchantUrl(errors: FieldErrors, value: unknown): Record<string, unknown> | undefined {
  const urls = errors.optionalObject('merchantUrl', value) as Partial<MerchantUrl> | undefined;
  if (!urls) return undefined;
  const success = checkReturnUrl(errors, 'merchantUrl.success', urls.success, true);
  const failure = checkReturnUrl(errors, 'merchantUrl.failure', urls.failure, true);
  const cancel = checkReturnUrl(errors, 'merchantUrl.cancel', urls.cancel, false);
  if (urls.notification !== undefined && urls.notification !== null) {
    errors.add('merchantUrl.notification', 'is reserved and must not be set');
  }
  const out: Record<string, unknown> = { success, failure };
  if (cancel !== undefined) out['cancel'] = cancel;
  return out;
}
