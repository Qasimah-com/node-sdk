import { normaliseOrderStatus } from '../enums.js';
import { dataRecord, type RequestOptions, type Transport } from '../http.js';
import { mapOrder, mapOrderSummary, mapPagination, num, records, requiredId, str, type Raw } from '../mappers.js';
import type {
  CancelResult,
  CaptureResult,
  ContractDocument,
  FulfillRequest,
  FulfillResult,
  ListOrdersParams,
  Order,
  OrderCounts,
  OrderSummary,
  Page,
  RefundRequest,
  RefundResult,
} from '../models.js';
import { FieldErrors, isRecord } from '../validation.js';
import { requireId } from './checkoutLinks.js';

export function parseContentDispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*\s*=\s*utf-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      return encoded[1].trim();
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

export function encodeReferencePath(reference: string): string {
  return reference.split('/').map(encodeURIComponent).join('/');
}

export function buildRefundBody(request: RefundRequest): Record<string, unknown> {
  const errors = new FieldErrors();
  const r: Raw = isRecord(request) ? request : {};
  const amount = errors.amount('amount', r['amount'], { required: true });
  if (amount !== null && amount <= 0) errors.add('amount', 'must be greater than zero');
  const reason = errors.optionalString('reason', r['reason']);
  errors.throwIfAny();
  return reason === undefined ? { amount } : { amount, reason };
}

export function buildFulfillBody(request: FulfillRequest | undefined): Record<string, unknown> {
  const errors = new FieldErrors();
  const r: Raw = isRecord(request) ? request : {};
  const shippedAmount = errors.amount('shippedAmount', r['shippedAmount']);
  const shippingCompany = errors.optionalString('shippingCompany', r['shippingCompany']);
  const trackingNumber = errors.optionalString('trackingNumber', r['trackingNumber']);
  const trackingUrl = errors.optionalString('trackingUrl', r['trackingUrl']);
  errors.throwIfAny();
  const body: Record<string, unknown> = {};
  if (shippedAmount !== null) body['shippedAmount'] = shippedAmount;
  if (shippingCompany !== undefined) body['shippingCompany'] = shippingCompany;
  if (trackingNumber !== undefined) body['trackingNumber'] = trackingNumber;
  if (trackingUrl !== undefined) body['trackingUrl'] = trackingUrl;
  return body;
}

export class OrdersResource {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async list(params: ListOrdersParams = {}): Promise<Page<OrderSummary>> {
    const raw = await this.transport.request({
      method: 'GET',
      path: '/merchant/orders',
      query: {
        status: params.status,
        search: params.search,
        page: params.page,
        pageSize: params.pageSize,
      },
    });
    const data = dataRecord(raw);
    const rows = Array.isArray(data['data']) ? records(data, 'data') : records(data, 'items');
    return {
      items: rows.map(mapOrderSummary),
      pagination: mapPagination(data),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async get(id: string): Promise<Order> {
    const raw = await this.transport.request({
      method: 'GET',
      path: `/merchant/orders/${encodeURIComponent(requireId(id))}`,
    });
    const data = dataRecord(raw);
    return mapOrder(data, requiredId(data, raw, 'orders.get'), { requestId: raw.requestId, replayed: raw.replayed });
  }

  async getByReference(orderReferenceId: string): Promise<Order> {
    const raw = await this.transport.request({
      method: 'GET',
      path: `/merchant/orders/by-reference/${encodeReferencePath(requireId(orderReferenceId, 'orderReferenceId'))}`,
    });
    const data = dataRecord(raw);
    return mapOrder(data, requiredId(data, raw, 'orders.getByReference'), { requestId: raw.requestId, replayed: raw.replayed });
  }

  async capture(id: string, options: RequestOptions = {}): Promise<CaptureResult> {
    const raw = await this.transport.request({
      method: 'POST',
      path: `/merchant/orders/${encodeURIComponent(requireId(id))}/capture`,
      idempotencyKey: options.idempotencyKey,
    });
    const data = dataRecord(raw);
    return {
      id: requiredId(data, raw, 'orders.capture'),
      status: normaliseOrderStatus(data['status']),
      confirmedAt: str(data, 'confirmedAt'),
      raw: data,
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async cancel(id: string, options: RequestOptions = {}): Promise<CancelResult> {
    const raw = await this.transport.request({
      method: 'POST',
      path: `/merchant/orders/${encodeURIComponent(requireId(id))}/cancel`,
      idempotencyKey: options.idempotencyKey,
    });
    const data = dataRecord(raw);
    return {
      id: requiredId(data, raw, 'orders.cancel'),
      status: normaliseOrderStatus(data['status']),
      raw: data,
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async refund(id: string, request: RefundRequest, options: RequestOptions = {}): Promise<RefundResult> {
    const body = buildRefundBody(request);
    const raw = await this.transport.request({
      method: 'POST',
      path: `/merchant/orders/${encodeURIComponent(requireId(id))}/refund`,
      body,
      idempotencyKey: options.idempotencyKey,
    });
    const data = dataRecord(raw);
    return {
      id: requiredId(data, raw, 'orders.refund'),
      status: normaliseOrderStatus(data['status']),
      refundedAmount: num(data, 'refundedAmount'),
      raw: data,
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async fulfill(id: string, request: FulfillRequest = {}, options: RequestOptions = {}): Promise<FulfillResult> {
    const body = buildFulfillBody(request);
    const raw = await this.transport.request({
      method: 'POST',
      path: `/merchant/orders/${encodeURIComponent(requireId(id))}/fulfill`,
      body,
      idempotencyKey: options.idempotencyKey,
    });
    const data = dataRecord(raw);
    return {
      id: requiredId(data, raw, 'orders.fulfill'),
      status: normaliseOrderStatus(data['status']),
      fulfilledAmount: num(data, 'fulfilledAmount'),
      raw: data,
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async counts(): Promise<OrderCounts> {
    const raw = await this.transport.request({ method: 'GET', path: '/merchant/orders/counts' });
    const data = dataRecord(raw);
    return {
      all: num(data, 'all'),
      approved: num(data, 'approved'),
      authorised: num(data, 'authorised'),
      captured: num(data, 'captured'),
      refunded: num(data, 'refunded'),
      cancelled: num(data, 'cancelled'),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async contract(id: string): Promise<ContractDocument> {
    const raw = await this.transport.request({
      method: 'GET',
      path: `/merchant/orders/${encodeURIComponent(requireId(id))}/contract`,
      binary: true,
    });
    return {
      bytes: raw.bytes ?? Buffer.alloc(0),
      contentType: raw.headers.get('content-type'),
      fileName: parseContentDispositionFileName(raw.headers.get('content-disposition')),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }
}
