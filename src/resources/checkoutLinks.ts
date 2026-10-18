import { ConfigurationError } from '../errors.js';
import { dataRecord, type RequestOptions, type Transport } from '../http.js';
import { mapCheckoutLink, records, requiredId, type Raw } from '../mappers.js';
import type { CheckoutLinkList, CheckoutLinkResult, CreateCheckoutLinkRequest } from '../models.js';
import { FieldErrors, isRecord } from '../validation.js';
import { buildMerchantUrl } from './baskets.js';

const CHANNELS = ['Link', 'Qr'] as const;
const LANGUAGES = ['ar', 'en'] as const;

export function requireId(id: unknown, name = 'id'): string {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ConfigurationError(`${name} must be a non-empty string`);
  }
  return id;
}

export function buildCheckoutLinkBody(request: CreateCheckoutLinkRequest): Record<string, unknown> {
  const errors = new FieldErrors();
  const r: Raw = isRecord(request) ? request : {};
  const amount = errors.amount('amount', r['amount'], { required: true });
  const channel = errors.oneOf('channel', r['channel'], CHANNELS, { required: true });
  const phone =
    channel === 'Link' ? errors.requiredString('phone', r['phone']) : errors.optionalString('phone', r['phone']);
  const language = errors.oneOf('language', r['language'], LANGUAGES);
  const orderReferenceId = errors.optionalString('orderReferenceId', r['orderReferenceId']);
  const ejarContractNumber = errors.optionalString('ejarContractNumber', r['ejarContractNumber']);
  const merchantUrl = buildMerchantUrl(errors, r['merchantUrl']);

  let items: Record<string, unknown>[] | undefined;
  if (r['items'] !== undefined && r['items'] !== null) {
    if (!Array.isArray(r['items'])) {
      errors.add('items', 'must be an array');
    } else {
      items = r['items'].map((entry: unknown, index: number) => {
        const prefix = `items[${index}]`;
        if (!isRecord(entry)) {
          errors.add(prefix, 'must be an object');
          return {};
        }
        return {
          name: errors.requiredString(`${prefix}.name`, entry['name']),
          sku: errors.optionalString(`${prefix}.sku`, entry['sku']) ?? null,
          quantity: errors.integer(`${prefix}.quantity`, entry['quantity'], { min: 1, required: true }),
          unitPrice: errors.amount(`${prefix}.unitPrice`, entry['unitPrice'], { required: true }),
          imageUrl: errors.optionalString(`${prefix}.imageUrl`, entry['imageUrl']) ?? null,
        };
      });
    }
  }
  errors.throwIfAny();

  const body: Record<string, unknown> = { amount, channel };
  if (phone !== undefined && phone !== null) body['phone'] = phone;
  if (language !== null) body['language'] = language;
  if (orderReferenceId !== undefined) body['orderReferenceId'] = orderReferenceId;
  if (items !== undefined) body['items'] = items;
  if (ejarContractNumber !== undefined) body['ejarContractNumber'] = ejarContractNumber;
  if (merchantUrl !== undefined) body['merchantUrl'] = merchantUrl;
  return body;
}

export class CheckoutLinksResource {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async create(request: CreateCheckoutLinkRequest, options: RequestOptions = {}): Promise<CheckoutLinkResult> {
    const body = buildCheckoutLinkBody(request);
    const raw = await this.transport.request({
      method: 'POST',
      path: '/merchant/checkout-links',
      body,
      idempotencyKey: options.idempotencyKey,
    });
    const data = dataRecord(raw);
    return {
      ...mapCheckoutLink(data, requiredId(data, raw, 'checkoutLinks.create')),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async list(): Promise<CheckoutLinkList> {
    const raw = await this.transport.request({ method: 'GET', path: '/merchant/checkout-links' });
    const data = dataRecord(raw);
    const rows = records(data, 'items');
    return {
      items: rows.map((row) => mapCheckoutLink(row, requiredId(row, raw, 'checkoutLinks.list'))),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async get(id: string): Promise<CheckoutLinkResult> {
    const raw = await this.transport.request({
      method: 'GET',
      path: `/merchant/checkout-links/${encodeURIComponent(requireId(id))}`,
    });
    const data = dataRecord(raw);
    return {
      ...mapCheckoutLink(data, requiredId(data, raw, 'checkoutLinks.get')),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async cancel(id: string, options: RequestOptions = {}): Promise<CheckoutLinkResult> {
    const raw = await this.transport.request({
      method: 'POST',
      path: `/merchant/checkout-links/${encodeURIComponent(requireId(id))}/cancel`,
      idempotencyKey: options.idempotencyKey,
    });
    const data = dataRecord(raw);
    return {
      ...mapCheckoutLink(data, requiredId(data, raw, 'checkoutLinks.cancel')),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }
}
