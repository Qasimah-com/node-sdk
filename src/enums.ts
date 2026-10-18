export const ORDER_STATUS_NAMES = [
  'Draft',
  'New',
  'Approved',
  'Declined',
  'Expired',
  'Confirmed',
  'FullyFulfilled',
  'PartiallyFulfilled',
  'FullyReversed',
  'PartiallyReversed',
  'Voided',
  'Updated',
  'AwaitingCheckout',
  'Cancelled',
  'Settled',
  'WrittenOff',
] as const;

export const ORDER_CHANNEL_NAMES = ['Online', 'InStore', 'QrCode'] as const;

export const PAYMENT_TYPE_NAMES = ['PayByInstalments', 'PayNow', 'PayNextMonth', 'PayInFull'] as const;

export const INSTALLMENT_STATUS_NAMES = ['Scheduled', 'Paid', 'Late', 'Reversed', 'Waived'] as const;

export const WEBHOOK_DELIVERY_STATUS_NAMES = ['Pending', 'Succeeded', 'Failed'] as const;

type Open<T extends string> = T | (string & Record<never, never>);

export type OrderStatus = Open<(typeof ORDER_STATUS_NAMES)[number]>;
export type OrderChannel = Open<(typeof ORDER_CHANNEL_NAMES)[number]>;
export type PaymentType = Open<(typeof PAYMENT_TYPE_NAMES)[number]>;
export type InstallmentStatus = Open<(typeof INSTALLMENT_STATUS_NAMES)[number]>;
export type WebhookDeliveryStatus = Open<(typeof WEBHOOK_DELIVERY_STATUS_NAMES)[number]>;

export function normaliseEnum(names: readonly string[], value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return names[value] ?? String(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return names[Number(trimmed)] ?? trimmed;
    const lower = trimmed.toLowerCase();
    return names.find((name) => name.toLowerCase() === lower) ?? value;
  }
  return String(value);
}

export function normaliseOrderStatus(value: unknown): OrderStatus | null {
  return normaliseEnum(ORDER_STATUS_NAMES, value);
}

export function normaliseOrderChannel(value: unknown): OrderChannel | null {
  return normaliseEnum(ORDER_CHANNEL_NAMES, value);
}

export function normalisePaymentType(value: unknown): PaymentType | null {
  return normaliseEnum(PAYMENT_TYPE_NAMES, value);
}

export function normaliseInstallmentStatus(value: unknown): InstallmentStatus | null {
  return normaliseEnum(INSTALLMENT_STATUS_NAMES, value);
}

export function normaliseWebhookDeliveryStatus(value: unknown): WebhookDeliveryStatus | null {
  return normaliseEnum(WEBHOOK_DELIVERY_STATUS_NAMES, value);
}
