import {
  normaliseInstallmentStatus,
  normaliseOrderChannel,
  normaliseOrderStatus,
  normalisePaymentType,
  normaliseWebhookDeliveryStatus,
} from './enums.js';
import { ApiError } from './errors.js';
import type { RawResponse } from './http.js';
import type {
  CheckoutLink,
  CheckoutLinkItem,
  Fulfillment,
  Installment,
  Order,
  OrderCustomer,
  OrderItem,
  OrderSummary,
  Pagination,
  Plan,
  Plans,
  Reversal,
  Settlement,
  StatusChange,
  Void,
  WebhookDelivery,
  WebhookEndpoint,
} from './models.js';
import { isRecord } from './validation.js';

export type Raw = Record<string, unknown>;

export function record(value: unknown): Raw {
  return isRecord(value) ? value : {};
}

export function str(source: Raw, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

export function num(source: Raw, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function bool(source: Raw, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

export function records(source: Raw, key: string): Raw[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function strings(source: Raw, key: string): string[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function requiredId(source: Raw, raw: RawResponse, context: string, label = 'order id'): string {
  const id = str(source, 'id') ?? str(source, 'installmentId');
  if (id === null) {
    throw new ApiError(`Unexpected response from ${context}: no ${label} in the envelope data`, {
      code: raw.envelope?.code ?? null,
      httpStatus: raw.status,
      requestId: raw.requestId,
      raw: raw.envelope,
    });
  }
  return id;
}

export function mapPagination(source: Raw): Pagination {
  const pagination = record(source['pagination']);
  return {
    totalItems: num(pagination, 'totalItems'),
    page: num(pagination, 'page'),
    pageSize: num(pagination, 'pageSize'),
    totalPages: num(pagination, 'totalPages'),
  };
}

export function mapOrderSummary(row: Raw): OrderSummary {
  return {
    id: str(row, 'id') ?? '',
    orderReferenceId: str(row, 'orderReferenceId'),
    status: normaliseOrderStatus(row['status']),
    policyCode: str(row, 'policyCode'),
    policyType: str(row, 'policyType'),
    totalAmount: num(row, 'totalAmount'),
    currencyCode: str(row, 'currencyCode'),
    createdAt: str(row, 'createdAt'),
    customerId: str(row, 'customerId'),
    customerName: str(row, 'customerName'),
    customerEmail: str(row, 'customerEmail'),
    customerPhone: str(row, 'customerPhone'),
    instalments: num(row, 'instalments'),
    channel: normaliseOrderChannel(row['channel']),
    capturedAmount: num(row, 'capturedAmount'),
    refundedAmount: num(row, 'refundedAmount'),
    ejarContractNumber: str(row, 'ejarContractNumber'),
    raw: row,
  };
}

function mapCustomer(source: unknown): OrderCustomer | null {
  if (!isRecord(source)) return null;
  return {
    id: str(source, 'id'),
    name: str(source, 'name'),
    email: str(source, 'email'),
    phone: str(source, 'phone'),
  };
}

function mapItem(item: Raw): OrderItem {
  return {
    referenceId: str(item, 'referenceId'),
    name: str(item, 'name'),
    type: str(item, 'type'),
    sku: str(item, 'sku'),
    quantity: num(item, 'quantity'),
    unitPrice: num(item, 'unitPrice'),
    totalAmount: num(item, 'totalAmount'),
    taxAmount: num(item, 'taxAmount'),
    discountAmount: num(item, 'discountAmount'),
    imageUrl: str(item, 'imageUrl'),
  };
}

function mapInstallment(row: Raw): Installment {
  return {
    sequence: num(row, 'sequence'),
    dueDate: str(row, 'dueDate'),
    amount: num(row, 'amount'),
    principal: num(row, 'principal'),
    profit: num(row, 'profit'),
    status: normaliseInstallmentStatus(row['status']),
    paidAmount: num(row, 'paidAmount'),
    paidAt: str(row, 'paidAt'),
    providerRef: str(row, 'providerRef'),
  };
}

function mapFulfillment(row: Raw): Fulfillment {
  return {
    id: str(row, 'id'),
    amount: num(row, 'amount'),
    currencyCode: str(row, 'currencyCode'),
    shippingCompany: str(row, 'shippingCompany'),
    trackingNumber: str(row, 'trackingNumber'),
    trackingUrl: str(row, 'trackingUrl'),
    providerCaptureId: str(row, 'providerCaptureId'),
    createdAt: str(row, 'createdAt'),
  };
}

function mapReversal(row: Raw): Reversal {
  return {
    id: str(row, 'id'),
    amount: num(row, 'amount'),
    currencyCode: str(row, 'currencyCode'),
    comment: str(row, 'comment'),
    fulfillmentId: str(row, 'fulfillmentId'),
    providerRefundId: str(row, 'providerRefundId'),
    createdAt: str(row, 'createdAt'),
  };
}

function mapVoid(row: Raw): Void {
  return {
    id: str(row, 'id'),
    amount: num(row, 'amount'),
    currencyCode: str(row, 'currencyCode'),
    reason: str(row, 'reason'),
    providerCancelId: str(row, 'providerCancelId'),
    createdAt: str(row, 'createdAt'),
  };
}

function mapStatusChange(row: Raw): StatusChange {
  return {
    fromStatus: normaliseOrderStatus(row['fromStatus']),
    toStatus: normaliseOrderStatus(row['toStatus']),
    trigger: str(row, 'trigger'),
    createdAt: str(row, 'createdAt'),
  };
}

export function mapOrder(data: Raw, id: string, meta: { requestId: string | null; replayed: boolean }): Order {
  return {
    id,
    orderReferenceId: str(data, 'orderReferenceId'),
    status: normaliseOrderStatus(data['status']),
    paymentType: normalisePaymentType(data['paymentType']),
    channel: normaliseOrderChannel(data['channel']),
    checkoutChannel: str(data, 'checkoutChannel'),
    totalAmount: num(data, 'totalAmount'),
    taxAmount: num(data, 'taxAmount'),
    shippingAmount: num(data, 'shippingAmount'),
    discountAmount: num(data, 'discountAmount'),
    currencyCode: str(data, 'currencyCode'),
    countryCode: str(data, 'countryCode'),
    description: str(data, 'description'),
    instalments: num(data, 'instalments'),
    downPaymentAmount: num(data, 'downPaymentAmount'),
    approvedAmount: num(data, 'approvedAmount'),
    capturedAmount: num(data, 'capturedAmount'),
    fulfilledAmount: num(data, 'fulfilledAmount'),
    refundedAmount: num(data, 'refundedAmount'),
    refundableAmount: num(data, 'refundableAmount'),
    collectedAmount: num(data, 'collectedAmount'),
    voidedAmount: num(data, 'voidedAmount'),
    reversedAmount: num(data, 'reversedAmount'),
    paymentUrl: str(data, 'paymentUrl'),
    providerSessionId: str(data, 'providerSessionId'),
    providerOrderId: str(data, 'providerOrderId'),
    createdAt: str(data, 'createdAt'),
    confirmedAt: str(data, 'confirmedAt'),
    fulfilledAt: str(data, 'fulfilledAt'),
    voidedAt: str(data, 'voidedAt'),
    reversedAt: str(data, 'reversedAt'),
    settledAt: str(data, 'settledAt'),
    checkoutExpiresAt: str(data, 'checkoutExpiresAt'),
    expiresAt: str(data, 'expiresAt'),
    ejarContractNumber: str(data, 'ejarContractNumber'),
    notificationLanguage: str(data, 'notificationLanguage'),
    contractNumber: str(data, 'contractNumber'),
    customer: mapCustomer(data['customer']),
    items: records(data, 'items').map(mapItem),
    installments: records(data, 'installments').map(mapInstallment),
    fulfillments: records(data, 'fulfillments').map(mapFulfillment),
    reversals: records(data, 'reversals').map(mapReversal),
    voids: records(data, 'voids').map(mapVoid),
    statusHistory: records(data, 'statusHistory').map(mapStatusChange),
    raw: data,
    requestId: meta.requestId,
    replayed: meta.replayed,
  };
}

function mapCheckoutLinkItem(item: Raw): CheckoutLinkItem {
  return {
    name: str(item, 'name'),
    sku: str(item, 'sku'),
    quantity: num(item, 'quantity'),
    unitPrice: num(item, 'unitPrice'),
    total: num(item, 'total'),
    imageUrl: str(item, 'imageUrl'),
  };
}

export function mapCheckoutLink(data: Raw, id: string): CheckoutLink {
  const link: CheckoutLink = { id, raw: data };
  const strings = [
    'url',
    'channel',
    'currency',
    'phone',
    'language',
    'orderReferenceId',
    'ejarContractNumber',
    'decisionStatus',
    'expiresAt',
    'createdAt',
  ] as const;
  for (const key of strings) {
    if (key in data) link[key] = str(data, key);
  }
  if ('amount' in data) link.amount = num(data, 'amount');
  if ('status' in data) link.status = normaliseOrderStatus(data['status']);
  for (const key of ['completed', 'declined', 'waiting'] as const) {
    if (key in data) link[key] = bool(data, key);
  }
  if (Array.isArray(data['items'])) link.items = records(data, 'items').map(mapCheckoutLinkItem);
  return link;
}

function mapPlan(row: Raw): Plan {
  return {
    instalments: num(row, 'instalments'),
    frequency: str(row, 'frequency'),
    instalmentAmount: num(row, 'instalmentAmount'),
    firstInstalmentAmount: num(row, 'firstInstalmentAmount'),
    lastInstalmentAmount: num(row, 'lastInstalmentAmount'),
    feesIncludingVat: num(row, 'feesIncludingVat'),
    totalPayable: num(row, 'totalPayable'),
    shariaCompliant: bool(row, 'shariaCompliant'),
  };
}

export function mapPlans(data: Raw, meta: { requestId: string | null; replayed: boolean }): Plans {
  return {
    merchantName: str(data, 'merchantName'),
    currency: str(data, 'currency'),
    minAmount: num(data, 'minAmount'),
    maxAmount: num(data, 'maxAmount'),
    plans: records(data, 'plans').map(mapPlan),
    raw: data,
    requestId: meta.requestId,
    replayed: meta.replayed,
  };
}

export function mapSettlement(row: Raw): Settlement {
  return {
    id: str(row, 'id'),
    providerSettlementId: str(row, 'providerSettlementId'),
    amount: num(row, 'amount'),
    currencyCode: str(row, 'currencyCode'),
    settledAt: str(row, 'settledAt'),
    status: typeof row['status'] === 'number' ? String(row['status']) : str(row, 'status'),
    orderCount: num(row, 'orderCount'),
    raw: row,
  };
}

export function mapWebhookEndpoint(row: Raw, id: string): WebhookEndpoint {
  return {
    id,
    url: str(row, 'url'),
    description: str(row, 'description'),
    events: strings(row, 'events'),
    isActive: bool(row, 'isActive'),
    secretHint: str(row, 'secretHint'),
    previousSecretExpiresAt: str(row, 'previousSecretExpiresAt'),
    createdAt: str(row, 'createdAt'),
    updatedAt: str(row, 'updatedAt'),
    raw: row,
  };
}

export function mapWebhookDelivery(row: Raw, id: string): WebhookDelivery {
  return {
    id,
    eventId: str(row, 'eventId'),
    eventType: str(row, 'eventType'),
    orderId: str(row, 'orderId'),
    orderReferenceId: str(row, 'orderReferenceId'),
    status: normaliseWebhookDeliveryStatus(row['status']),
    attempts: num(row, 'attempts'),
    maxAttempts: num(row, 'maxAttempts'),
    nextAttemptAt: str(row, 'nextAttemptAt'),
    lastAttemptAt: str(row, 'lastAttemptAt'),
    lastStatusCode: num(row, 'lastStatusCode'),
    lastError: str(row, 'lastError'),
    responseSnippet: str(row, 'responseSnippet'),
    durationMs: num(row, 'durationMs'),
    succeededAt: str(row, 'succeededAt'),
    replayOfId: str(row, 'replayOfId'),
    createdAt: str(row, 'createdAt'),
    raw: row,
  };
}
