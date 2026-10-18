import { randomUUID } from 'node:crypto';
import {
  ApiError,
  AuthenticationError,
  ConflictError,
  ConnectionError,
  DuplicateOrderReferenceError,
  NotFoundError,
  OrderDeclinedError,
  PermissionError,
  QasimhaError,
  RateLimitError,
  ServerError,
  ValidationError,
  type FieldError,
} from './errors.js';
import type { Logger } from './logger.js';
import { isRecord } from './validation.js';

export interface Envelope {
  success?: boolean;
  isSuccess?: boolean;
  uuid?: string | null;
  code?: string | null;
  message?: string | null;
  data?: unknown;
  errors?: FieldError[] | null;
}

export interface ResultMeta {
  requestId: string | null;
  replayed: boolean;
}

export interface RequestOptions {
  idempotencyKey?: string | false;
}

export type QueryValue = string | number | boolean | null | undefined;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface SendRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotencyKey?: string | false;
  binary?: boolean;
  publicKey?: string;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  envelope: Envelope | null;
  text: string | null;
  bytes: Buffer | null;
  requestId: string | null;
  replayed: boolean;
  attempt: number;
}

export interface TransportConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  language: string;
  userAgent: string;
  logger: Logger | null;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 30_000;

export function backoffMs(retryIndex: number, random: () => number): number {
  return Math.min(2 ** retryIndex * 500, MAX_BACKOFF_MS) + Math.floor(random() * 250);
}

export function parseRetryAfter(value: string | null, nowMs: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

export function envelopeSuccess(envelope: Envelope | null): boolean | null {
  if (envelope === null) return null;
  if (typeof envelope.success === 'boolean') return envelope.success;
  if (typeof envelope.isSuccess === 'boolean') return envelope.isSuccess;
  return null;
}

export function isSuccess(raw: RawResponse): boolean {
  return raw.status >= 200 && raw.status < 300 && envelopeSuccess(raw.envelope) !== false;
}

export function dataRecord(raw: RawResponse): Record<string, unknown> {
  const data = raw.envelope?.data;
  return isRecord(data) ? data : {};
}

function stringOrNull(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function defaultMessage(status: number, code: string | null): string {
  const suffix = code ? ` ${code}` : '';
  if (status >= 300 && status < 400) return `Unexpected redirect (HTTP ${status})`;
  return `Request failed with HTTP ${status}${suffix}`;
}

export function mapError(raw: RawResponse): QasimhaError {
  const envelope = raw.envelope;
  const code = envelope?.code ?? null;
  const data = dataRecord(raw);
  const init = {
    code,
    httpStatus: raw.status,
    requestId: raw.requestId,
    errors: envelope?.errors ?? [],
    raw: envelope ?? raw.text,
  };
  const message = envelope?.message || defaultMessage(raw.status, code);
  const status = raw.status;

  if (status >= 200 && status < 300) return new ApiError(message, init);
  if (status === 400) return new ValidationError(message, init);
  if (status === 401) return new AuthenticationError(envelope?.message || 'The API key was rejected (401)', init);
  if (status === 403) return new PermissionError(envelope?.message || 'The API key lacks the scope this call needs (403)', init);
  if (status === 404) return new NotFoundError(message, init);
  if (status === 409) {
    if (code === 'DUPLICATE_ORDER_REFERENCE') {
      return new DuplicateOrderReferenceError(message, {
        ...init,
        existingOrderId: stringOrNull(data, 'installmentId'),
        existingPaymentUrl: stringOrNull(data, 'paymentUrl'),
      });
    }
    return new ConflictError(message, init);
  }
  if (status === 422 && code === 'ORDER_DECLINED') {
    return new OrderDeclinedError(message, { ...init, orderId: stringOrNull(data, 'installmentId') });
  }
  if (status === 429) {
    return new RateLimitError(message, { ...init, retryAfter: parseRetryAfter(raw.headers.get('retry-after')) });
  }
  if (status >= 500) return new ServerError(message, init);
  return new ApiError(message, init);
}

function describeCause(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (current.message && !parts.includes(current.message)) parts.push(current.message);
    current = current.cause;
  }
  return parts.length > 0 ? parts.join(': ') : String(error);
}

function toConnectionError(error: unknown, request: SendRequest, timeout: number): ConnectionError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ConnectionError(`${request.method} ${request.path} timed out after ${timeout} ms`, { cause: error });
  }
  return new ConnectionError(`${request.method} ${request.path} failed: ${describeCause(error)}`, { cause: error });
}

export class Transport {
  private readonly config: TransportConfig;

  constructor(config: TransportConfig) {
    this.config = config;
  }

  async request(request: SendRequest): Promise<RawResponse> {
    const raw = await this.send(request);
    this.throwIfError(raw);
    return raw;
  }

  throwIfError(raw: RawResponse): void {
    if (!isSuccess(raw)) throw mapError(raw);
  }

  async send(request: SendRequest): Promise<RawResponse> {
    const correlationId = randomUUID();
    const idempotencyKey =
      request.method !== 'GET' && request.idempotencyKey !== false ? (request.idempotencyKey ?? randomUUID()) : null;
    const retriesAllowed = request.method === 'GET' || idempotencyKey !== null;
    const maxAttempts = retriesAllowed ? this.config.maxRetries + 1 : 1;
    const url = this.buildUrl(request.path, request.query);
    const logPath = new URL(url).pathname;
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    const headers = this.buildHeaders(request, body !== undefined, correlationId, idempotencyKey);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = performance.now();
      let raw: RawResponse;
      try {
        raw = await this.attempt(url, request, headers, body, attempt);
      } catch (error) {
        const failure = toConnectionError(error, request, this.config.timeout);
        this.log('warn', 'request failed', {
          method: request.method,
          path: logPath,
          status: null,
          durationMs: Math.round(performance.now() - startedAt),
          requestId: null,
          attempt,
          code: null,
          error: failure.message,
        });
        if (attempt >= maxAttempts) throw failure;
        await this.pause(request.method, logPath, attempt, null);
        continue;
      }

      const ok = isSuccess(raw);
      this.log(ok ? 'debug' : 'warn', ok ? 'request completed' : 'request rejected', {
        method: request.method,
        path: logPath,
        status: raw.status,
        durationMs: Math.round(performance.now() - startedAt),
        requestId: raw.requestId,
        attempt,
        code: raw.envelope?.code ?? null,
      });
      if (ok || attempt >= maxAttempts || !this.isRetryable(raw)) return raw;
      await this.pause(request.method, logPath, attempt, raw);
    }
    throw new ConnectionError(`${request.method} ${request.path} exhausted its attempts`);
  }

  private isRetryable(raw: RawResponse): boolean {
    if (RETRYABLE_STATUSES.has(raw.status)) return true;
    return raw.status === 409 && raw.envelope?.code === 'REQUEST_IN_PROGRESS';
  }

  private async pause(method: string, path: string, attempt: number, raw: RawResponse | null): Promise<void> {
    let delayMs = backoffMs(attempt - 1, this.config.random);
    if (raw?.status === 429) {
      const retryAfter = parseRetryAfter(raw.headers.get('retry-after'));
      if (retryAfter !== null) delayMs = Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
    }
    this.log('info', 'retrying request', {
      method,
      path,
      status: raw?.status ?? null,
      requestId: raw?.requestId ?? null,
      attempt,
      code: raw?.envelope?.code ?? null,
      delayMs,
    });
    await this.config.sleep(delayMs);
  }

  private async attempt(
    url: string,
    request: SendRequest,
    headers: Record<string, string>,
    body: string | undefined,
    attempt: number,
  ): Promise<RawResponse> {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.config.timeout),
    });

    let text: string | null = null;
    let bytes: Buffer | null = null;
    let envelope: Envelope | null = null;
    if (request.binary && response.ok) {
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      text = await response.text();
      if (text.length > 0) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (isRecord(parsed)) envelope = parsed as Envelope;
        } catch {
          envelope = null;
        }
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      envelope,
      text,
      bytes,
      requestId: envelope?.uuid ?? response.headers.get('x-request-id') ?? null,
      replayed: (response.headers.get('idempotent-replay') ?? '').toLowerCase() === 'true',
      attempt,
    };
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${this.config.baseUrl}/api/v1${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private buildHeaders(
    request: SendRequest,
    hasBody: boolean,
    correlationId: string,
    idempotencyKey: string | null,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...(request.publicKey === undefined ? { 'X-Api-Key': this.config.apiKey } : { 'X-Public-Key': request.publicKey }),
      Accept: request.binary ? '*/*' : 'application/json',
      'Accept-Language': this.config.language,
      'User-Agent': this.config.userAgent,
      'X-Correlation-Id': correlationId,
    };
    if (hasBody) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (idempotencyKey !== null) headers['Idempotency-Key'] = idempotencyKey;
    return headers;
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown>): void {
    this.config.logger?.(level, message, fields);
  }
}
