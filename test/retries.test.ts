import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, ConnectionError, RateLimitError, ServerError, ValidationError } from '../src/index.js';
import { backoffMs, parseRetryAfter } from '../src/http.js';
import { sampleSession } from './helpers/fixtures.js';
import { TestServer, envelope, failure, makeClient, reply, sleepRecorder } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

const COUNTS = '/api/v1/merchant/orders/counts';
const ORDER = '76c94cf2-db05-4c5a-b8da-bb05d1ae7cbc';

describe('backoff arithmetic', () => {
  it('doubles from 500 ms and caps at 8 s, with 0-250 ms jitter', () => {
    const noJitter = () => 0;
    expect([0, 1, 2, 3, 4, 5].map((i) => backoffMs(i, noJitter))).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    expect(backoffMs(0, () => 0.999)).toBe(749);
    expect(backoffMs(4, () => 0.5)).toBe(8125);
  });

  it('parses Retry-After as seconds or as an HTTP date', () => {
    expect(parseRetryAfter('12')).toBe(12);
    expect(parseRetryAfter(' 3 ')).toBe(3);
    const now = Date.parse('2026-09-25T09:00:00Z');
    expect(parseRetryAfter('Fri, 25 Sep 2026 09:00:10 GMT', now)).toBe(10);
    expect(parseRetryAfter('Fri, 25 Sep 2026 08:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe('retry policy', () => {
  it('retries a GET on 503 and succeeds, sleeping the backoff', async () => {
    server.once('GET', COUNTS, (_req, res) => reply(res, 503, failure('UNAVAILABLE', 'down')));
    server.on('GET', COUNTS, (_req, res) => reply(res, 200, envelope('SUCCESS', { all: 4 })));
    const { sleep, delays } = sleepRecorder();
    const counts = await makeClient(server, { sleep }).orders.counts();
    expect(counts.all).toBe(4);
    expect(server.requests).toHaveLength(2);
    expect(delays).toEqual([500]);
  });

  it('walks the backoff schedule across 502/503/504 and gives up after maxRetries', async () => {
    server.once('GET', COUNTS, (_req, res) => reply(res, 502, undefined));
    server.once('GET', COUNTS, (_req, res) => reply(res, 503, undefined));
    server.once('GET', COUNTS, (_req, res) => reply(res, 504, undefined));
    server.on('GET', COUNTS, (_req, res) => reply(res, 504, undefined));
    const { sleep, delays } = sleepRecorder();
    await expect(makeClient(server, { sleep, maxRetries: 3 }).orders.counts()).rejects.toBeInstanceOf(ServerError);
    expect(server.requests).toHaveLength(4);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it('honours Retry-After on 429 in seconds, capped at 30 s', async () => {
    server.once('GET', COUNTS, (_req, res) => reply(res, 429, undefined, { 'retry-after': '2' }));
    server.once('GET', COUNTS, (_req, res) => reply(res, 429, undefined, { 'retry-after': '120' }));
    server.on('GET', COUNTS, (_req, res) => reply(res, 200, envelope('SUCCESS', { all: 1 })));
    const { sleep, delays } = sleepRecorder();
    await makeClient(server, { sleep, maxRetries: 2 }).orders.counts();
    expect(delays).toEqual([2000, 30_000]);
  });

  it('honours an HTTP-date Retry-After and falls back to backoff when unparsable', async () => {
    server.once('GET', COUNTS, (_req, res) =>
      reply(res, 429, undefined, { 'retry-after': new Date(Date.now() + 5000).toUTCString() }),
    );
    server.once('GET', COUNTS, (_req, res) => reply(res, 429, undefined, { 'retry-after': 'later' }));
    server.on('GET', COUNTS, (_req, res) => reply(res, 200, envelope('SUCCESS', { all: 1 })));
    const { sleep, delays } = sleepRecorder();
    await makeClient(server, { sleep, maxRetries: 2 }).orders.counts();
    expect(delays[0]).toBeGreaterThanOrEqual(4000);
    expect(delays[0]).toBeLessThanOrEqual(5000);
    expect(delays[1]).toBe(1000);
  });

  it('surfaces RateLimitError once retries are exhausted', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 429, failure('RATE_LIMITED', 'slow'), { 'retry-after': '1' }));
    const { sleep, delays } = sleepRecorder();
    await expect(makeClient(server, { sleep, maxRetries: 1 }).orders.counts()).rejects.toBeInstanceOf(RateLimitError);
    expect(delays).toEqual([1000]);
    expect(server.requests).toHaveLength(2);
  });

  it('never retries a 500 or a 400', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 500, failure('INTERNAL', 'x')));
    const { sleep, delays } = sleepRecorder();
    await expect(makeClient(server, { sleep }).orders.counts()).rejects.toBeInstanceOf(ServerError);
    server.on('GET', COUNTS, (_req, res) => reply(res, 400, failure('INVALID_STATUS', 'x')));
    await expect(makeClient(server, { sleep }).orders.counts()).rejects.toBeInstanceOf(ValidationError);
    expect(delays).toEqual([]);
    expect(server.requests).toHaveLength(2);
  });

  it('retries a POST with the same Idempotency-Key and X-Correlation-Id', async () => {
    server.once('POST', '/api/v1/pay/session/create', (_req, res) => reply(res, 503, undefined));
    server.on('POST', '/api/v1/pay/session/create', (_req, res) =>
      reply(res, 201, envelope('SESSION_CREATED', { installmentId: ORDER, paymentUrl: 'https://pay.example/1', providerSessionId: 's', status: 'New' })),
    );
    const session = await makeClient(server).checkout.createSession(sampleSession());
    expect(session.orderId).toBe(ORDER);
    expect(server.requests).toHaveLength(2);
    const [first, second] = server.requests;
    expect(first?.headers['idempotency-key']).toBe(second?.headers['idempotency-key']);
    expect(first?.headers['x-correlation-id']).toBe(second?.headers['x-correlation-id']);
    expect(first?.body).toBe(second?.body);
  });

  it('does not retry a POST when idempotency is disabled', async () => {
    server.on('POST', '/api/v1/pay/session/create', (_req, res) => reply(res, 503, undefined));
    const { sleep, delays } = sleepRecorder();
    await expect(
      makeClient(server, { sleep }).checkout.createSession(sampleSession(), { idempotencyKey: false }),
    ).rejects.toBeInstanceOf(ServerError);
    expect(server.requests).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('treats 409 REQUEST_IN_PROGRESS as retryable and ends in ConflictError', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/capture`, (_req, res) =>
      reply(res, 409, { success: false, code: 'REQUEST_IN_PROGRESS' }),
    );
    const { sleep, delays } = sleepRecorder();
    const error = await makeClient(server, { sleep, maxRetries: 2 })
      .orders.capture(ORDER)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe('REQUEST_IN_PROGRESS');
    expect(delays).toEqual([500, 1000]);
    expect(server.requests).toHaveLength(3);
  });

  it('retries a connection failure and reports ConnectionError with the cause', async () => {
    const { sleep, delays } = sleepRecorder();
    const client = makeClient(server, { sleep, maxRetries: 1, baseUrl: 'http://127.0.0.1:1' });
    const error = await client.orders.counts().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).httpStatus).toBeNull();
    expect((error as ConnectionError).message).toMatch(/GET \/merchant\/orders\/counts failed/);
    expect((error as ConnectionError).cause).toBeDefined();
    expect(delays).toEqual([500]);
  });

  it('turns a per-attempt timeout into ConnectionError', async () => {
    server.on('GET', COUNTS, () => {});
    const { sleep, delays } = sleepRecorder();
    const client = makeClient(server, { sleep, timeout: 150, maxRetries: 1 });
    const error = await client.orders.counts().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).message).toMatch(/timed out after 150 ms/);
    expect(delays).toEqual([500]);
    expect(server.requests).toHaveLength(2);
  });

  it('makes a single attempt when maxRetries is 0', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 503, undefined));
    await expect(makeClient(server, { maxRetries: 0 }).orders.counts()).rejects.toBeInstanceOf(ServerError);
    expect(server.requests).toHaveLength(1);
  });

  it('logs method, path, status, duration, request id, attempt and code, never the key or the body', async () => {
    server.once('GET', COUNTS, (_req, res) => reply(res, 503, failure('UNAVAILABLE', 'down', { uuid: 'u-1' })));
    server.on('GET', COUNTS, (_req, res) => reply(res, 200, envelope('SUCCESS', { all: 4 }, 'ok', 'u-2')));
    const lines: { level: string; message: string; fields: Record<string, unknown> }[] = [];
    await makeClient(server, { logger: (level, message, fields) => lines.push({ level, message, fields }) }).orders.list({
      search: 'cart-shopper@qasimha.test',
    }).catch(() => undefined);
    await makeClient(server, { logger: (level, message, fields) => lines.push({ level, message, fields }) }).orders.counts();
    const serialised = JSON.stringify(lines);
    expect(serialised).not.toContain('sk_test');
    expect(serialised).not.toContain('cart-shopper');
    const levels = lines.map((l) => l.level);
    expect(levels).toContain('warn');
    expect(levels).toContain('info');
    expect(levels).toContain('debug');
    const success = lines.find((l) => l.message === 'request completed');
    expect(success?.fields).toMatchObject({ method: 'GET', path: COUNTS, status: 200, requestId: 'u-2', attempt: 2, code: 'SUCCESS' });
    expect(typeof success?.fields['durationMs']).toBe('number');
    const retry = lines.find((l) => l.message === 'retrying request');
    expect(retry?.fields).toMatchObject({ attempt: 1, delayMs: 500, status: 503, code: 'UNAVAILABLE' });
  });
});
