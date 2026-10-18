import { ApiError } from '../errors.js';
import { dataRecord, type RawResponse, type RequestOptions, type Transport } from '../http.js';
import { mapPagination, mapWebhookDelivery, mapWebhookEndpoint, records, requiredId, str, type Raw } from '../mappers.js';
import type {
  CreateWebhookEndpointRequest,
  ListWebhookDeliveriesParams,
  Page,
  UpdateWebhookEndpointRequest,
  WebhookDelivery,
  WebhookDeliveryResult,
  WebhookEndpointList,
  WebhookEndpointResult,
  WebhookEndpointWithSecret,
  WebhookPingResult,
} from '../models.js';
import { FieldErrors, isRecord } from '../validation.js';
import { requireId } from './checkoutLinks.js';

export const WEBHOOK_EVENT_TYPES = [
  'order.confirmed',
  'order.declined',
  'order.fulfilled',
  'order.partially_fulfilled',
  'order.refunded',
  'order.partially_refunded',
  'order.voided',
  'order.cancelled',
  'order.expired',
  'checkout_link.expired',
] as const;

const LEGACY_EVENT_ALIAS = 'order.completed';
const DELIVERY_STATUSES = ['Pending', 'Succeeded', 'Failed'] as const;
const MAX_DESCRIPTION_LENGTH = 200;

function checkEndpointUrl(errors: FieldErrors, value: unknown, required: boolean): string | undefined {
  const url = required ? errors.requiredString('url', value) : errors.optionalString('url', value);
  if (url === null || url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    errors.add('url', 'must be an absolute https:// URL');
    return undefined;
  }
  if (parsed.protocol !== 'https:') {
    errors.add('url', 'must use https://');
    return undefined;
  }
  return url;
}

function checkDescription(errors: FieldErrors, value: unknown): string | undefined {
  const description = errors.optionalString('description', value);
  if (description !== undefined && description.length > MAX_DESCRIPTION_LENGTH) {
    errors.add('description', `must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
    return undefined;
  }
  return description;
}

function checkEvents(errors: FieldErrors, value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    errors.add('events', 'must be an array of event names');
    return undefined;
  }
  const known: readonly string[] = [...WEBHOOK_EVENT_TYPES, LEGACY_EVENT_ALIAS];
  const events: string[] = [];
  value.forEach((entry: unknown, index: number) => {
    if (typeof entry !== 'string' || !known.includes(entry)) {
      errors.add(`events[${index}]`, `must be one of ${WEBHOOK_EVENT_TYPES.join(', ')}`);
      return;
    }
    events.push(entry);
  });
  return events;
}

export function buildCreateWebhookEndpointBody(request: CreateWebhookEndpointRequest): Record<string, unknown> {
  const errors = new FieldErrors();
  const r: Raw = isRecord(request) ? request : {};
  const url = checkEndpointUrl(errors, r['url'], true);
  const description = checkDescription(errors, r['description']);
  const events = checkEvents(errors, r['events']);
  errors.throwIfAny();
  const body: Record<string, unknown> = { url };
  if (description !== undefined) body['description'] = description;
  if (events !== undefined) body['events'] = events;
  return body;
}

export function buildUpdateWebhookEndpointBody(request: UpdateWebhookEndpointRequest): Record<string, unknown> {
  const errors = new FieldErrors();
  const r: Raw = isRecord(request) ? request : {};
  const url = checkEndpointUrl(errors, r['url'], false);
  const description = checkDescription(errors, r['description']);
  const events = checkEvents(errors, r['events']);
  const isActive = errors.boolean('isActive', r['isActive']);
  errors.throwIfAny();
  const body: Record<string, unknown> = {};
  if (url !== undefined) body['url'] = url;
  if (description !== undefined) body['description'] = description;
  if (events !== undefined) body['events'] = events;
  if (isActive !== undefined) body['isActive'] = isActive;
  return body;
}

function endpointPath(id: string): string {
  return `/merchant/webhooks/${encodeURIComponent(requireId(id))}`;
}

function withSecret(raw: RawResponse, context: string): WebhookEndpointWithSecret {
  const data = dataRecord(raw);
  const secret = str(data, 'secret');
  if (secret === null || secret === '') {
    throw new ApiError(`Unexpected response from ${context}: no secret in the envelope data`, {
      code: raw.envelope?.code ?? null,
      httpStatus: raw.status,
      requestId: raw.requestId,
    });
  }
  const rest: Raw = { ...data };
  delete rest['secret'];
  return {
    ...mapWebhookEndpoint(rest, requiredId(rest, raw, context, 'endpoint id')),
    secret,
    requestId: raw.requestId,
    replayed: raw.replayed,
  };
}

function endpointResult(raw: RawResponse, context: string): WebhookEndpointResult {
  const data = dataRecord(raw);
  return { ...mapWebhookEndpoint(data, requiredId(data, raw, context, 'endpoint id')), requestId: raw.requestId, replayed: raw.replayed };
}

export class WebhookEndpointsResource {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async create(request: CreateWebhookEndpointRequest, options: RequestOptions = {}): Promise<WebhookEndpointWithSecret> {
    const body = buildCreateWebhookEndpointBody(request);
    const raw = await this.transport.request({
      method: 'POST',
      path: '/merchant/webhooks',
      body,
      idempotencyKey: options.idempotencyKey,
    });
    return withSecret(raw, 'webhookEndpoints.create');
  }

  async list(): Promise<WebhookEndpointList> {
    const raw = await this.transport.request({ method: 'GET', path: '/merchant/webhooks' });
    const data = raw.envelope?.data;
    const rows = Array.isArray(data) ? data.filter(isRecord) : records(dataRecord(raw), 'items');
    return {
      items: rows.map((row) => mapWebhookEndpoint(row, requiredId(row, raw, 'webhookEndpoints.list', 'endpoint id'))),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async get(id: string): Promise<WebhookEndpointResult> {
    const raw = await this.transport.request({ method: 'GET', path: endpointPath(id) });
    return endpointResult(raw, 'webhookEndpoints.get');
  }

  async update(id: string, request: UpdateWebhookEndpointRequest, options: RequestOptions = {}): Promise<WebhookEndpointResult> {
    const body = buildUpdateWebhookEndpointBody(request);
    const raw = await this.transport.request({
      method: 'PUT',
      path: endpointPath(id),
      body,
      idempotencyKey: options.idempotencyKey,
    });
    return endpointResult(raw, 'webhookEndpoints.update');
  }

  async delete(id: string, options: RequestOptions = {}): Promise<void> {
    await this.transport.request({ method: 'DELETE', path: endpointPath(id), idempotencyKey: options.idempotencyKey });
  }

  async rotateSecret(id: string, options: RequestOptions = {}): Promise<WebhookEndpointWithSecret> {
    const raw = await this.transport.request({
      method: 'POST',
      path: `${endpointPath(id)}/rotate-secret`,
      idempotencyKey: options.idempotencyKey,
    });
    return withSecret(raw, 'webhookEndpoints.rotateSecret');
  }

  async ping(id: string, options: RequestOptions = {}): Promise<WebhookPingResult> {
    const raw = await this.transport.request({
      method: 'POST',
      path: `${endpointPath(id)}/ping`,
      idempotencyKey: options.idempotencyKey,
    });
    const data = dataRecord(raw);
    return { eventId: str(data, 'eventId'), endpointId: str(data, 'endpointId'), requestId: raw.requestId, replayed: raw.replayed };
  }

  async listDeliveries(id: string, params: ListWebhookDeliveriesParams = {}): Promise<Page<WebhookDelivery>> {
    const errors = new FieldErrors();
    const p: Raw = isRecord(params) ? params : {};
    const status = errors.oneOf('status', p['status'], DELIVERY_STATUSES);
    const page = errors.integer('page', p['page'], { min: 1 });
    const pageSize = errors.integer('pageSize', p['pageSize'], { min: 1 });
    errors.throwIfAny();
    const raw = await this.transport.request({
      method: 'GET',
      path: `${endpointPath(id)}/deliveries`,
      query: { status, page, pageSize },
    });
    const data = dataRecord(raw);
    const rows = Array.isArray(data['data']) ? records(data, 'data') : records(data, 'items');
    return {
      items: rows.map((row) => mapWebhookDelivery(row, requiredId(row, raw, 'webhookEndpoints.listDeliveries', 'delivery id'))),
      pagination: mapPagination(data),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async replayDelivery(id: string, deliveryId: string, options: RequestOptions = {}): Promise<WebhookDeliveryResult> {
    const raw = await this.transport.request({
      method: 'POST',
      path: `${endpointPath(id)}/deliveries/${encodeURIComponent(requireId(deliveryId, 'deliveryId'))}/replay`,
      idempotencyKey: options.idempotencyKey,
    });
    const data = dataRecord(raw);
    return {
      ...mapWebhookDelivery(data, requiredId(data, raw, 'webhookEndpoints.replayDelivery', 'delivery id')),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }
}
