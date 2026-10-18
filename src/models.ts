import type { Language } from './client.js';
import type { InstallmentStatus, OrderChannel, OrderStatus, PaymentType, WebhookDeliveryStatus } from './enums.js';
import type { ResultMeta } from './http.js';

export type { ResultMeta, RequestOptions } from './http.js';

export type ItemType = 'physical' | 'digital';

export type PaymentTypeCode = 'pay_by_instalments' | 'pay_now' | 'pay_next_month' | 'pay_in_full';

export interface Item {
  referenceId: string;
  name: string;
  type: ItemType;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  taxAmount?: number;
  discountAmount?: number;
  imageUrl?: string | null;
}

export interface Consumer {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email?: string | null;
  nationalId?: string | null;
}

export interface Address {
  firstName: string;
  lastName: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode?: string | null;
  countryCode: string;
  phoneNumber?: string | null;
}

export interface RiskAssessment {
  customerDob?: string | null;
  customerGender?: string | null;
  isExistingCustomer?: boolean;
  orderIsDigital?: boolean;
  totalOrderCount?: number;
  dateOfFirstTransaction?: string | null;
}

export interface MerchantUrl {
  success: string;
  failure: string;
  cancel?: string | null;
  notification?: null;
}

export interface CreateSessionRequest {
  orderReferenceId: string;
  totalAmount: number;
  taxAmount?: number;
  shippingAmount?: number;
  discountAmount?: number;
  currencyCode?: string;
  countryCode?: string;
  description?: string | null;
  paymentType?: PaymentTypeCode;
  instalments?: number;
  items: Item[];
  consumer: Consumer;
  shippingAddress: Address;
  billingAddress?: Address | null;
  riskAssessment?: RiskAssessment | null;
  merchantUrl?: MerchantUrl | null;
}

export interface PosConsumer extends Consumer {
  email: string;
}

export interface CreatePosSessionRequest {
  orderReferenceId: string;
  totalAmount: number;
  currencyCode?: string;
  countryCode?: string;
  items: Item[];
  consumer: PosConsumer;
  merchantUrl?: MerchantUrl | null;
}

export interface CreateQrSessionRequest {
  orderReferenceId: string;
  totalAmount: number;
  currencyCode?: string;
  countryCode?: string;
  items: Item[];
  merchantUrl?: MerchantUrl | null;
}

export interface Session extends ResultMeta {
  orderId: string;
  paymentUrl: string | null;
  providerSessionId: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface PosSession extends ResultMeta {
  orderId: string;
  checkoutUrl: string | null;
  providerSessionId: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface QrSession extends ResultMeta {
  orderId: string;
  qrCodeUrl: string | null;
  providerSessionId: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface GetPlansOptions {
  lang?: Language;
  publishableKey?: string;
}

export interface Plan {
  instalments: number | null;
  frequency: string | null;
  instalmentAmount: number | null;
  firstInstalmentAmount: number | null;
  lastInstalmentAmount: number | null;
  feesIncludingVat: number | null;
  totalPayable: number | null;
  shariaCompliant: boolean | null;
}

export interface Plans extends ResultMeta {
  merchantName: string | null;
  currency: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  plans: Plan[];
  raw: Record<string, unknown>;
}

export type CheckoutLinkChannel = 'Link' | 'Qr';

export interface CheckoutLinkItemInput {
  name: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  imageUrl?: string | null;
}

export interface CreateCheckoutLinkRequest {
  amount: number;
  channel: CheckoutLinkChannel;
  phone?: string | null;
  language?: 'ar' | 'en';
  orderReferenceId?: string | null;
  items?: CheckoutLinkItemInput[];
  ejarContractNumber?: string | null;
  merchantUrl?: MerchantUrl | null;
}

export interface CheckoutLinkItem {
  name: string | null;
  sku: string | null;
  quantity: number | null;
  unitPrice: number | null;
  total: number | null;
  imageUrl: string | null;
}

export interface CheckoutLink {
  id: string;
  url?: string | null;
  channel?: string | null;
  amount?: number | null;
  currency?: string | null;
  phone?: string | null;
  language?: string | null;
  orderReferenceId?: string | null;
  ejarContractNumber?: string | null;
  items?: CheckoutLinkItem[];
  status?: OrderStatus | null;
  decisionStatus?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
  completed?: boolean | null;
  declined?: boolean | null;
  waiting?: boolean | null;
  raw: Record<string, unknown>;
}

export interface CheckoutLinkResult extends CheckoutLink, ResultMeta {}

export interface CheckoutLinkList extends ResultMeta {
  items: CheckoutLink[];
}

export interface Pagination {
  totalItems: number | null;
  page: number | null;
  pageSize: number | null;
  totalPages: number | null;
}

export interface Page<T> extends ResultMeta {
  items: T[];
  pagination: Pagination;
}

export interface ListOrdersParams {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface OrderSummary {
  id: string;
  orderReferenceId: string | null;
  status: OrderStatus | null;
  policyCode: string | null;
  policyType: string | null;
  totalAmount: number | null;
  currencyCode: string | null;
  createdAt: string | null;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  instalments: number | null;
  channel: OrderChannel | null;
  capturedAmount: number | null;
  refundedAmount: number | null;
  ejarContractNumber: string | null;
  raw: Record<string, unknown>;
}

export interface OrderCustomer {
  id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface OrderItem {
  referenceId: string | null;
  name: string | null;
  type: string | null;
  sku: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalAmount: number | null;
  taxAmount: number | null;
  discountAmount: number | null;
  imageUrl: string | null;
}

export interface Installment {
  sequence: number | null;
  dueDate: string | null;
  amount: number | null;
  principal: number | null;
  profit: number | null;
  status: InstallmentStatus | null;
  paidAmount: number | null;
  paidAt: string | null;
  providerRef: string | null;
}

export interface Fulfillment {
  id: string | null;
  amount: number | null;
  currencyCode: string | null;
  shippingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  providerCaptureId: string | null;
  createdAt: string | null;
}

export interface Reversal {
  id: string | null;
  amount: number | null;
  currencyCode: string | null;
  comment: string | null;
  fulfillmentId: string | null;
  providerRefundId: string | null;
  createdAt: string | null;
}

export interface Void {
  id: string | null;
  amount: number | null;
  currencyCode: string | null;
  reason: string | null;
  providerCancelId: string | null;
  createdAt: string | null;
}

export interface StatusChange {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  trigger: string | null;
  createdAt: string | null;
}

export interface Order extends ResultMeta {
  id: string;
  orderReferenceId: string | null;
  status: OrderStatus | null;
  paymentType: PaymentType | null;
  channel: OrderChannel | null;
  checkoutChannel: string | null;
  totalAmount: number | null;
  taxAmount: number | null;
  shippingAmount: number | null;
  discountAmount: number | null;
  currencyCode: string | null;
  countryCode: string | null;
  description: string | null;
  instalments: number | null;
  downPaymentAmount: number | null;
  approvedAmount: number | null;
  capturedAmount: number | null;
  fulfilledAmount: number | null;
  refundedAmount: number | null;
  refundableAmount: number | null;
  collectedAmount: number | null;
  voidedAmount: number | null;
  reversedAmount: number | null;
  paymentUrl: string | null;
  providerSessionId: string | null;
  providerOrderId: string | null;
  createdAt: string | null;
  confirmedAt: string | null;
  fulfilledAt: string | null;
  voidedAt: string | null;
  reversedAt: string | null;
  settledAt: string | null;
  checkoutExpiresAt: string | null;
  expiresAt: string | null;
  ejarContractNumber: string | null;
  notificationLanguage: string | null;
  contractNumber: string | null;
  customer: OrderCustomer | null;
  items: OrderItem[];
  installments: Installment[];
  fulfillments: Fulfillment[];
  reversals: Reversal[];
  voids: Void[];
  statusHistory: StatusChange[];
  raw: Record<string, unknown>;
}

export interface CaptureResult extends ResultMeta {
  id: string;
  status: OrderStatus | null;
  confirmedAt: string | null;
  raw: Record<string, unknown>;
}

export interface CancelResult extends ResultMeta {
  id: string;
  status: OrderStatus | null;
  raw: Record<string, unknown>;
}

export interface RefundRequest {
  amount: number;
  reason?: string | null;
}

export interface RefundResult extends ResultMeta {
  id: string;
  status: OrderStatus | null;
  refundedAmount: number | null;
  raw: Record<string, unknown>;
}

export interface FulfillRequest {
  shippedAmount?: number | null;
  shippingCompany?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}

export interface FulfillResult extends ResultMeta {
  id: string;
  status: OrderStatus | null;
  fulfilledAmount: number | null;
  raw: Record<string, unknown>;
}

export interface OrderCounts extends ResultMeta {
  all: number | null;
  approved: number | null;
  authorised: number | null;
  captured: number | null;
  refunded: number | null;
  cancelled: number | null;
}

export interface ContractDocument extends ResultMeta {
  bytes: Buffer;
  contentType: string | null;
  fileName: string | null;
}

export interface ListSettlementsParams {
  page?: number;
  pageSize?: number;
}

export interface Settlement {
  id: string | null;
  providerSettlementId: string | null;
  amount: number | null;
  currencyCode: string | null;
  settledAt: string | null;
  status: string | null;
  orderCount: number | null;
  raw: Record<string, unknown>;
}

export interface SettlementOverview extends ResultMeta {
  totalSettled?: number | null;
  count?: number | null;
  lastSettlement?: unknown;
  settlementCycle?: string | null;
  settlementModel?: string | null;
  minimumSettlementAmount?: number | null;
  remainingForNextSettlement?: number | null;
  [key: string]: unknown;
}

export interface WebhookEvent {
  id: string | null;
  type: string | null;
  orderId: string | null;
  orderReferenceId: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  occurredAt: string | null;
  raw: Record<string, unknown>;
}

export type WebhookEventType =
  | 'order.confirmed'
  | 'order.declined'
  | 'order.fulfilled'
  | 'order.partially_fulfilled'
  | 'order.refunded'
  | 'order.partially_refunded'
  | 'order.voided'
  | 'order.cancelled'
  | 'order.expired'
  | 'checkout_link.expired';

export interface CreateWebhookEndpointRequest {
  url: string;
  description?: string | null;
  events?: WebhookEventType[];
}

export interface UpdateWebhookEndpointRequest {
  url?: string;
  description?: string | null;
  events?: WebhookEventType[];
  isActive?: boolean;
}

export interface WebhookEndpoint {
  id: string;
  url: string | null;
  description: string | null;
  events: string[];
  isActive: boolean | null;
  secretHint: string | null;
  previousSecretExpiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookEndpointResult extends WebhookEndpoint, ResultMeta {}

export interface WebhookEndpointWithSecret extends WebhookEndpoint, ResultMeta {
  secret: string;
}

export interface WebhookEndpointList extends ResultMeta {
  items: WebhookEndpoint[];
}

export interface WebhookPingResult extends ResultMeta {
  eventId: string | null;
  endpointId: string | null;
}

export interface ListWebhookDeliveriesParams {
  status?: 'Pending' | 'Succeeded' | 'Failed';
  page?: number;
  pageSize?: number;
}

export interface WebhookDelivery {
  id: string;
  eventId: string | null;
  eventType: string | null;
  orderId: string | null;
  orderReferenceId: string | null;
  status: WebhookDeliveryStatus | null;
  attempts: number | null;
  maxAttempts: number | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  responseSnippet: string | null;
  durationMs: number | null;
  succeededAt: string | null;
  replayOfId: string | null;
  createdAt: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookDeliveryResult extends WebhookDelivery, ResultMeta {}
