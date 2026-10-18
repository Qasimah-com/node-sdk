import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigurationError, ValidationError, WebhookSignatureError } from '../errors.js';
import { num, record, str } from '../mappers.js';
import type { WebhookEvent } from '../models.js';
import { isRecord } from '../validation.js';

export type WebhookBody = string | Buffer | Uint8Array;

export type HeaderValue = string | string[] | null | undefined;

export interface WebhookHeaderValues {
  signature?: HeaderValue;
  timestamp?: HeaderValue;
  eventId?: HeaderValue;
  event?: HeaderValue;
}

export interface HeadersLike {
  get(name: string): string | null;
}

export type WebhookHeaders = Record<string, HeaderValue> | HeadersLike | WebhookHeaderValues;

export interface WebhookVerifyOptions {
  tolerance?: number;
  now?: number | Date;
  timestampHeader?: HeaderValue;
}

export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

const HEX_64 = /^[0-9a-fA-F]{64}$/;
const HEADER_NAMES: Record<keyof WebhookHeaderValues, string> = {
  signature: 'x-qasimha-signature',
  timestamp: 'x-qasimha-timestamp',
  eventId: 'x-qasimha-event-id',
  event: 'x-qasimha-event',
};

function flatten(value: HeaderValue): string | null {
  if (value === null || value === undefined) return null;
  const joined = Array.isArray(value) ? value.join(',') : value;
  const trimmed = joined.trim();
  return trimmed === '' ? null : trimmed;
}

function isHeadersLike(headers: WebhookHeaders): headers is HeadersLike {
  return typeof (headers as HeadersLike).get === 'function';
}

function isHeaderValues(headers: WebhookHeaders): headers is WebhookHeaderValues {
  return (
    !isHeadersLike(headers) && (Object.keys(HEADER_NAMES) as (keyof WebhookHeaderValues)[]).some((key) => key in headers)
  );
}

export function readWebhookHeader(headers: WebhookHeaders, name: keyof WebhookHeaderValues): string | null {
  if (isHeadersLike(headers)) return flatten(headers.get(HEADER_NAMES[name]));
  if (isHeaderValues(headers)) return flatten(headers[name]);
  const wanted = HEADER_NAMES[name];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return flatten(value);
  }
  return null;
}

function bodyBytes(body: WebhookBody): Buffer {
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

function hmacHex(secret: string, ...parts: Buffer[]): string {
  const hmac = createHmac('sha256', secret);
  for (const part of parts) hmac.update(part);
  return hmac.digest('hex');
}

function hexEquals(expectedHex: string, candidateHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const candidate = Buffer.from(candidateHex, 'hex');
  if (expected.length !== candidate.length || expected.length === 0) return false;
  return timingSafeEqual(expected, candidate);
}

function nowSeconds(now: number | Date | undefined): number {
  if (now instanceof Date) return Math.floor(now.getTime() / 1000);
  if (typeof now === 'number' && Number.isFinite(now)) return Math.floor(now);
  return Math.floor(Date.now() / 1000);
}

function parseTimestamp(value: string, label: string): number {
  if (!/^\d{1,12}$/.test(value)) {
    throw new WebhookSignatureError(`${label} is not a unix timestamp in seconds`, 'malformed_header');
  }
  return Number(value);
}

function checkTolerance(now: number, timestamp: number, tolerance: number): void {
  if (Math.abs(now - timestamp) > tolerance) {
    throw new WebhookSignatureError(
      `Delivery timestamp ${timestamp} is outside the ${tolerance} s tolerance (now ${now})`,
      'timestamp_outside_tolerance',
    );
  }
}

function verifyV0(header: string, body: Buffer, secret: string, options: WebhookVerifyOptions, now: number, tolerance: number): void {
  const given = header.slice('sha256='.length).trim();
  if (!HEX_64.test(given)) {
    throw new WebhookSignatureError('The sha256= signature is not a 64-character hex digest', 'malformed_header');
  }
  const timestampHeader = flatten(options.timestampHeader);
  if (timestampHeader !== null) {
    checkTolerance(now, parseTimestamp(timestampHeader, 'X-Qasimha-Timestamp'), tolerance);
  }
  if (!hexEquals(hmacHex(secret, body), given)) {
    throw new WebhookSignatureError('The signature does not match the body', 'signature_mismatch');
  }
}

function verifyV1(header: string, body: Buffer, secret: string, now: number, tolerance: number): void {
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      throw new WebhookSignatureError(`Unreadable signature element "${trimmed}"`, 'malformed_header');
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key === 't') {
      if (timestamp !== null) throw new WebhookSignatureError('More than one t= element', 'malformed_header');
      timestamp = value;
    } else if (key === 'v1') {
      if (!HEX_64.test(value)) {
        throw new WebhookSignatureError('A v1= signature is not a 64-character hex digest', 'malformed_header');
      }
      signatures.push(value);
    }
  }
  if (timestamp === null) throw new WebhookSignatureError('The signature header has no t= element', 'malformed_header');
  if (signatures.length === 0) {
    throw new WebhookSignatureError('The signature header has no v1= element', 'malformed_header');
  }
  checkTolerance(now, parseTimestamp(timestamp, 't='), tolerance);
  const expected = hmacHex(secret, Buffer.from(`${timestamp}.`, 'utf8'), body);
  let matched = false;
  for (const candidate of signatures) {
    if (hexEquals(expected, candidate)) matched = true;
  }
  if (!matched) throw new WebhookSignatureError('No v1= signature matches the body', 'signature_mismatch');
}

export function verifyWebhookSignature(
  rawBody: WebhookBody,
  signatureHeader: HeaderValue,
  secret: string,
  options: WebhookVerifyOptions = {},
): void {
  if (typeof secret !== 'string' || secret === '') {
    throw new ConfigurationError('A webhook secret is required to verify a signature');
  }
  const header = flatten(signatureHeader);
  if (header === null) {
    throw new WebhookSignatureError('The delivery carries no X-Qasimha-Signature header', 'missing_header');
  }
  const tolerance = options.tolerance ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const now = nowSeconds(options.now);
  const body = bodyBytes(rawBody);
  if (header.startsWith('sha256=')) {
    verifyV0(header, body, secret, options, now, tolerance);
    return;
  }
  if (/(^|,)\s*t=/.test(header)) {
    verifyV1(header, body, secret, now, tolerance);
    return;
  }
  throw new WebhookSignatureError('The signature header is neither sha256=… nor t=…,v1=…', 'malformed_header');
}

export function constructWebhookEvent(
  rawBody: WebhookBody,
  headers: WebhookHeaders,
  secret: string,
  options: WebhookVerifyOptions = {},
): WebhookEvent {
  const signature = readWebhookHeader(headers, 'signature');
  const timestamp = options.timestampHeader ?? readWebhookHeader(headers, 'timestamp');
  verifyWebhookSignature(rawBody, signature, secret, { ...options, timestampHeader: timestamp });

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyBytes(rawBody).toString('utf8'));
  } catch (error) {
    throw new ValidationError('The webhook body is not valid JSON', { cause: error });
  }
  if (!isRecord(parsed)) throw new ValidationError('The webhook body is not a JSON object');

  const order = record(record(parsed['data'])['order']);
  return {
    id: str(parsed, 'eventId') ?? str(parsed, 'id') ?? readWebhookHeader(headers, 'eventId'),
    type: str(parsed, 'eventType') ?? str(parsed, 'type') ?? readWebhookHeader(headers, 'event'),
    orderId: str(parsed, 'orderId') ?? str(order, 'id'),
    orderReferenceId: str(parsed, 'orderReferenceId') ?? str(order, 'orderReferenceId'),
    status: str(parsed, 'status') ?? str(order, 'status'),
    amount: num(parsed, 'amount') ?? num(order, 'totalAmount'),
    currency: str(parsed, 'currency') ?? str(order, 'currencyCode'),
    occurredAt: str(parsed, 'occurredAt') ?? str(parsed, 'createdAt'),
    raw: parsed,
  };
}

export class WebhooksResource {
  private readonly defaultSecret: string | null;

  constructor(defaultSecret: string | null) {
    this.defaultSecret = defaultSecret;
  }

  constructEvent(
    rawBody: WebhookBody,
    headers: WebhookHeaders,
    secret?: string | null,
    options: WebhookVerifyOptions = {},
  ): WebhookEvent {
    return constructWebhookEvent(rawBody, headers, this.resolveSecret(secret), options);
  }

  verifySignature(
    rawBody: WebhookBody,
    signatureHeader: HeaderValue,
    secret?: string | null,
    options: WebhookVerifyOptions = {},
  ): void {
    verifyWebhookSignature(rawBody, signatureHeader, this.resolveSecret(secret), options);
  }

  private resolveSecret(secret: string | null | undefined): string {
    const resolved = secret ?? this.defaultSecret;
    if (!resolved) {
      throw new ConfigurationError('No webhook secret: pass one to the call or set webhookSecret on the client');
    }
    return resolved;
  }
}
