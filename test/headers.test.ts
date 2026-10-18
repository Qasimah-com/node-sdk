import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';
import { TEST_API_KEY, TestServer, UUID_V4, envelope, makeClient, reply } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

const ORDER = '76c94cf2-db05-4c5a-b8da-bb05d1ae7cbc';

describe('request headers', () => {
  it('sends the key, accept, language, user-agent and correlation id on a GET', async () => {
    server.on('GET', '/api/v1/merchant/orders/counts', (_req, res) => reply(res, 200, envelope('SUCCESS', { all: 1 })));
    const client = makeClient(server, { userAgentSuffix: 'woocommerce/1.2.0' });
    await client.orders.counts();

    const { headers } = server.last;
    expect(headers['x-api-key']).toBe(TEST_API_KEY);
    expect(headers['accept']).toBe('application/json');
    expect(headers['accept-language']).toBe('en');
    expect(headers['user-agent']).toBe(`qasimha-sdk-node/${VERSION} (node/${process.versions.node}; ${process.platform}) woocommerce/1.2.0`);
    expect(headers['x-correlation-id']).toMatch(UUID_V4);
    expect(headers['idempotency-key']).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
  });

  it('sends Accept-Language ar when configured', async () => {
    server.on('GET', '/api/v1/merchant/orders/counts', (_req, res) => reply(res, 200, envelope('SUCCESS', {})));
    await makeClient(server, { language: 'ar' }).orders.counts();
    expect(server.last.headers['accept-language']).toBe('ar');
  });

  it('adds a UUID v4 Idempotency-Key and a JSON content type on POST', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/capture`, (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: ORDER, status: 'Confirmed', confirmedAt: '2026-09-25T09:00:00Z' })),
    );
    await makeClient(server).orders.capture(ORDER);
    const { headers } = server.last;
    expect(headers['idempotency-key']).toMatch(UUID_V4);
    expect(headers['content-type']).toBeUndefined();
  });

  it('sends the caller-chosen idempotency key, or none when disabled', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/refund`, (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: ORDER, status: 'PartiallyReversed', refundedAmount: 10 })),
    );
    const client = makeClient(server);
    await client.orders.refund(ORDER, { amount: 10 }, { idempotencyKey: 'my-own-key-0001' });
    expect(server.last.headers['idempotency-key']).toBe('my-own-key-0001');
    expect(server.last.headers['content-type']).toBe('application/json; charset=utf-8');

    await client.orders.refund(ORDER, { amount: 10 }, { idempotencyKey: false });
    expect(server.last.headers['idempotency-key']).toBeUndefined();
  });

  it('reports a replayed response and the request id from the envelope', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/capture`, (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: ORDER, status: 5 }, 'ok', 'aaaaaaaa-0000-4000-8000-000000000001'), {
        'idempotent-replay': 'true',
        'x-request-id': 'header-request-id',
      }),
    );
    const result = await makeClient(server).orders.capture(ORDER);
    expect(result.replayed).toBe(true);
    expect(result.requestId).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    expect(result.status).toBe('Confirmed');
  });

  it('falls back to X-Request-Id when the envelope has no uuid', async () => {
    server.on('GET', '/api/v1/merchant/orders/counts', (_req, res) =>
      reply(res, 200, { success: true, code: 'SUCCESS', data: { all: 3 } }, { 'x-request-id': 'req-123' }),
    );
    const counts = await makeClient(server).orders.counts();
    expect(counts.requestId).toBe('req-123');
    expect(counts.replayed).toBe(false);
    expect(counts.all).toBe(3);
  });

  it('accepts the isSuccess spelling of the envelope flag', async () => {
    server.on('GET', '/api/v1/merchant/orders/counts', (_req, res) =>
      reply(res, 200, { isSuccess: true, uuid: 'u', code: 'SUCCESS', data: { all: 9 } }),
    );
    expect((await makeClient(server).orders.counts()).all).toBe(9);
  });
});
