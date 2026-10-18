import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError,
  ConfigurationError,
  NotFoundError,
  PermissionError,
  ValidationError,
  WEBHOOK_EVENT_TYPES,
  type CreateWebhookEndpointRequest,
  type LogLevel,
} from '../src/index.js';
import { fixture } from './helpers/fixtures.js';
import { TestServer, envelope, failure, makeClient, reply } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

const ENDPOINT = 'a81cce0b-35c7-45e0-a212-0c9f0969ddf4';
const DELIVERY = '6e44f7d4-a878-4e1c-9148-e7f8745fb50d';
const WEBHOOKS = '/api/v1/merchant/webhooks';
const ENDPOINT_PATH = `${WEBHOOKS}/${ENDPOINT}`;

type Envelope = { uuid: string; data: Record<string, unknown> };
const createFixture = fixture<Envelope>('webhook-endpoint-create.json');
const listFixture = fixture<{ uuid: string; data: Record<string, unknown>[] }>('webhook-endpoint-list.json');
const getFixture = fixture<Envelope>('webhook-endpoint-get.json');
const updateFixture = fixture<Envelope>('webhook-endpoint-update.json');
const deleteFixture = fixture<{ uuid: string; data: null }>('webhook-endpoint-delete.json');
const rotateFixture = fixture<Envelope>('webhook-endpoint-rotate-secret.json');
const pingFixture = fixture<Envelope>('webhook-endpoint-ping.json');
const deliveriesFixture = fixture<Envelope>('webhook-endpoint-deliveries.json');
const replayFixture = fixture<Envelope>('webhook-endpoint-replay.json');

const CREATE_REQUEST: CreateWebhookEndpointRequest = {
  url: 'https://example.com/qasimha-webhook',
  description: 'SDK fixture endpoint',
  events: ['order.confirmed', 'order.refunded'],
};

const EXPECTED_ENDPOINT = {
  id: ENDPOINT,
  url: 'https://example.com/qasimha-webhook',
  description: 'SDK fixture endpoint',
  events: ['order.confirmed', 'order.refunded'],
  isActive: true,
  secretHint: 'b877',
  previousSecretExpiresAt: null,
};

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('webhookEndpoints.create', () => {
  it('sends url, description and events and maps the created endpoint with its secret', async () => {
    server.on('POST', WEBHOOKS, (_req, res) => reply(res, 201, createFixture));
    const created = await makeClient(server).webhookEndpoints.create(CREATE_REQUEST);
    expect(created).toMatchObject({
      ...EXPECTED_ENDPOINT,
      secret: 'whsec_REDACTED_b877',
      createdAt: '2026-09-25T23:42:29.5562693Z',
      updatedAt: null,
      requestId: createFixture.uuid,
      replayed: false,
    });
    expect(server.last.json).toEqual({
      url: 'https://example.com/qasimha-webhook',
      description: 'SDK fixture endpoint',
      events: ['order.confirmed', 'order.refunded'],
    });
    expect(server.last.headers['idempotency-key']).toBeDefined();
    expect(server.last.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('carries the secret exactly once and never hands it to the logger', async () => {
    server.on('POST', WEBHOOKS, (_req, res) => reply(res, 201, createFixture));
    const logged: string[] = [];
    const logger = (level: LogLevel, message: string, fields: Record<string, unknown>) => {
      logged.push(JSON.stringify({ level, message, fields }));
    };
    const created = await makeClient(server, { logger }).webhookEndpoints.create(CREATE_REQUEST);
    expect(created.secret).toBe('whsec_REDACTED_b877');
    expect('secret' in created.raw).toBe(false);
    expect(countOccurrences(JSON.stringify(created), 'whsec_REDACTED_b877')).toBe(1);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line).not.toContain('whsec_');
  });

  it('sends only the url when description and events are omitted', async () => {
    server.on('POST', WEBHOOKS, (_req, res) => reply(res, 201, createFixture));
    await makeClient(server).webhookEndpoints.create({ url: 'https://example.com/hooks' });
    expect(server.last.json).toEqual({ url: 'https://example.com/hooks' });
  });

  it('accepts every §7 event name, the order.completed alias and an empty list', async () => {
    server.on('POST', WEBHOOKS, (_req, res) => reply(res, 201, createFixture));
    const client = makeClient(server);
    await client.webhookEndpoints.create({ url: 'https://example.com/hooks', events: [...WEBHOOK_EVENT_TYPES] });
    expect((server.last.json as { events: string[] }).events).toEqual([...WEBHOOK_EVENT_TYPES]);
    await client.webhookEndpoints.create({ url: 'https://example.com/hooks', events: ['order.completed' as never] });
    expect((server.last.json as { events: string[] }).events).toEqual(['order.completed']);
    await client.webhookEndpoints.create({ url: 'https://example.com/hooks', events: [] });
    expect((server.last.json as { events: string[] }).events).toEqual([]);
  });

  it('refuses a non-https, relative or missing url before sending', async () => {
    const client = makeClient(server);
    for (const [url, message] of [
      ['http://example.com/hooks', 'must use https://'],
      ['ftp://example.com/hooks', 'must use https://'],
      ['/relative/hooks', 'must be an absolute https:// URL'],
      ['', 'is required'],
      [undefined, 'is required'],
    ] as const) {
      const error = await client.webhookEndpoints.create({ url: url as string }).catch((e: unknown) => e);
      expect(error, String(url)).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).errors).toEqual([{ field: 'url', message }]);
      expect((error as ValidationError).httpStatus).toBeNull();
    }
    expect(server.requests).toHaveLength(0);
  });

  it('refuses unknown event names, naming each entry', async () => {
    const error = await makeClient(server)
      .webhookEndpoints.create({ url: 'https://example.com/hooks', events: ['order.confirmed', 'order.reversed', 'ping', 42] as never })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors.map((e) => e.field)).toEqual(['events[1]', 'events[2]', 'events[3]']);
    expect((error as ValidationError).errors[0]?.message).toContain('order.confirmed');
    expect(server.requests).toHaveLength(0);
  });

  it('refuses a description over 200 characters and a non-array events value', async () => {
    const error = await makeClient(server)
      .webhookEndpoints.create({ url: 'https://example.com/hooks', description: 'x'.repeat(201), events: 'order.confirmed' as never })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toEqual([
      { field: 'description', message: 'must be at most 200 characters' },
      { field: 'events', message: 'must be an array of event names' },
    ]);
  });

  it('maps a missing webhooks:manage scope to PermissionError', async () => {
    server.on('POST', WEBHOOKS, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    await expect(makeClient(server).webhookEndpoints.create(CREATE_REQUEST)).rejects.toBeInstanceOf(PermissionError);
  });

  it('maps the API-side 400 codes to ValidationError with the code', async () => {
    server.once('POST', WEBHOOKS, (_req, res) => reply(res, 400, failure('LIMIT_EXCEEDED', 'Maximum 5 webhook endpoints per account.')));
    server.once('POST', WEBHOOKS, (_req, res) => reply(res, 400, failure('URL_PRIVATE', 'url must point at a public host, not a private or local address.')));
    const client = makeClient(server);
    await expect(client.webhookEndpoints.create(CREATE_REQUEST)).rejects.toMatchObject({ name: 'ValidationError', code: 'LIMIT_EXCEEDED', httpStatus: 400 });
    await expect(client.webhookEndpoints.create({ url: 'https://10.0.0.1/hooks' })).rejects.toMatchObject({ name: 'ValidationError', code: 'URL_PRIVATE' });
  });

  it('rejects a 201 that carries no secret', async () => {
    server.on('POST', WEBHOOKS, (_req, res) => reply(res, 201, envelope('WEBHOOK_CREATED', { id: ENDPOINT, url: 'https://example.com/hooks' })));
    const error = await makeClient(server).webhookEndpoints.create(CREATE_REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toContain('no secret');
  });
});

describe('webhookEndpoints.list', () => {
  it('maps the recorded list, which is the envelope data array', async () => {
    server.on('GET', WEBHOOKS, (_req, res) => reply(res, 200, listFixture));
    const list = await makeClient(server).webhookEndpoints.list();
    expect(list.requestId).toBe(listFixture.uuid);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ ...EXPECTED_ENDPOINT, createdAt: '2026-09-25T23:42:29.556269Z', updatedAt: null });
    expect('secret' in (list.items[0] as object)).toBe(false);
    expect(list.items[0]?.raw).toEqual(listFixture.data[0]);
  });

  it('returns no items for an empty account', async () => {
    server.on('GET', WEBHOOKS, (_req, res) => reply(res, 200, envelope('SUCCESS', [])));
    expect((await makeClient(server).webhookEndpoints.list()).items).toEqual([]);
  });

  it('maps a missing webhooks:manage scope to PermissionError', async () => {
    server.on('GET', WEBHOOKS, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    await expect(makeClient(server).webhookEndpoints.list()).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('webhookEndpoints.get', () => {
  it('maps the recorded endpoint', async () => {
    server.on('GET', ENDPOINT_PATH, (_req, res) => reply(res, 200, getFixture));
    const endpoint = await makeClient(server).webhookEndpoints.get(ENDPOINT);
    expect(endpoint).toMatchObject({ ...EXPECTED_ENDPOINT, createdAt: '2026-09-25T23:42:29.556269Z', updatedAt: null, requestId: getFixture.uuid, replayed: false });
    expect(endpoint.raw).toEqual(getFixture.data);
  });

  it('maps 404 to NotFoundError and 403 to PermissionError', async () => {
    server.once('GET', ENDPOINT_PATH, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Webhook endpoint not found')));
    server.once('GET', ENDPOINT_PATH, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    const client = makeClient(server);
    await expect(client.webhookEndpoints.get(ENDPOINT)).rejects.toMatchObject({ name: 'NotFoundError', code: 'NOT_FOUND' });
    await expect(client.webhookEndpoints.get(ENDPOINT)).rejects.toBeInstanceOf(PermissionError);
  });

  it('refuses an empty id before sending and url-encodes the id', async () => {
    const client = makeClient(server);
    await expect(client.webhookEndpoints.get('')).rejects.toBeInstanceOf(ConfigurationError);
    expect(server.requests).toHaveLength(0);
    server.on('GET', `${WEBHOOKS}/a%20b`, (_req, res) => reply(res, 200, envelope('SUCCESS', { id: 'a b' })));
    expect((await client.webhookEndpoints.get('a b')).id).toBe('a b');
  });
});

describe('webhookEndpoints.update', () => {
  it('PUTs only the provided fields and maps the updated endpoint', async () => {
    server.on('PUT', ENDPOINT_PATH, (_req, res) => reply(res, 200, updateFixture));
    const updated = await makeClient(server).webhookEndpoints.update(ENDPOINT, { isActive: false, description: 'SDK fixture endpoint (paused)' });
    expect(server.last.method).toBe('PUT');
    expect(server.last.json).toEqual({ description: 'SDK fixture endpoint (paused)', isActive: false });
    expect(server.last.headers['idempotency-key']).toBeDefined();
    expect(updated).toMatchObject({
      id: ENDPOINT,
      description: 'SDK fixture endpoint (paused)',
      isActive: false,
      updatedAt: '2026-09-25T23:42:37.3003779Z',
      requestId: updateFixture.uuid,
    });
    expect(updated.raw).toEqual(updateFixture.data);
  });

  it('sends every field when all are given and an empty body when none are', async () => {
    server.on('PUT', ENDPOINT_PATH, (_req, res) => reply(res, 200, updateFixture));
    const client = makeClient(server);
    await client.webhookEndpoints.update(ENDPOINT, { url: 'https://example.com/v2', description: 'v2', events: ['order.confirmed'], isActive: true });
    expect(server.last.json).toEqual({ url: 'https://example.com/v2', description: 'v2', events: ['order.confirmed'], isActive: true });
    await client.webhookEndpoints.update(ENDPOINT, {});
    expect(server.last.json).toEqual({});
  });

  it('validates url, events and isActive before sending', async () => {
    const error = await makeClient(server)
      .webhookEndpoints.update(ENDPOINT, { url: 'http://example.com/v2', events: ['order.nope'] as never, isActive: 'no' as never })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toEqual([
      { field: 'url', message: 'must use https://' },
      { field: 'events[0]', message: `must be one of ${WEBHOOK_EVENT_TYPES.join(', ')}` },
      { field: 'isActive', message: 'must be a boolean' },
    ]);
    expect(server.requests).toHaveLength(0);
  });

  it('maps 404 to NotFoundError and 403 to PermissionError', async () => {
    server.once('PUT', ENDPOINT_PATH, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Webhook endpoint not found')));
    server.once('PUT', ENDPOINT_PATH, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    const client = makeClient(server);
    await expect(client.webhookEndpoints.update(ENDPOINT, { isActive: false })).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.webhookEndpoints.update(ENDPOINT, { isActive: false })).rejects.toBeInstanceOf(PermissionError);
  });

  it('retries a PUT on 503 with the same Idempotency-Key', async () => {
    server.once('PUT', ENDPOINT_PATH, (_req, res) => reply(res, 503, failure('UNAVAILABLE', 'try later')));
    server.once('PUT', ENDPOINT_PATH, (_req, res) => reply(res, 200, updateFixture));
    const updated = await makeClient(server).webhookEndpoints.update(ENDPOINT, { isActive: false });
    expect(updated.isActive).toBe(false);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]?.headers['idempotency-key']).toBe(server.requests[1]?.headers['idempotency-key']);
  });
});

describe('webhookEndpoints.delete', () => {
  it('sends DELETE and resolves with nothing', async () => {
    server.on('DELETE', ENDPOINT_PATH, (_req, res) => reply(res, 200, deleteFixture));
    await expect(makeClient(server).webhookEndpoints.delete(ENDPOINT)).resolves.toBeUndefined();
    expect(server.last.method).toBe('DELETE');
    expect(server.last.body).toBe('');
    expect(server.last.headers['idempotency-key']).toBeDefined();
  });

  it('maps 404 to NotFoundError and 403 to PermissionError', async () => {
    server.once('DELETE', ENDPOINT_PATH, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Webhook endpoint not found')));
    server.once('DELETE', ENDPOINT_PATH, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    const client = makeClient(server);
    await expect(client.webhookEndpoints.delete(ENDPOINT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.webhookEndpoints.delete(ENDPOINT)).rejects.toBeInstanceOf(PermissionError);
  });

  it('refuses an empty id before sending', async () => {
    await expect(makeClient(server).webhookEndpoints.delete(' ')).rejects.toBeInstanceOf(ConfigurationError);
    expect(server.requests).toHaveLength(0);
  });
});

describe('webhookEndpoints.rotateSecret', () => {
  it('returns the new secret once with the previous-secret window', async () => {
    server.on('POST', `${ENDPOINT_PATH}/rotate-secret`, (_req, res) => reply(res, 200, rotateFixture));
    const rotated = await makeClient(server).webhookEndpoints.rotateSecret(ENDPOINT);
    expect(rotated).toMatchObject({
      id: ENDPOINT,
      secret: 'whsec_REDACTED_be3e',
      secretHint: 'be3e',
      isActive: false,
      previousSecretExpiresAt: '2026-09-26T23:42:37.8012856Z',
      requestId: rotateFixture.uuid,
    });
    expect('secret' in rotated.raw).toBe(false);
    expect(countOccurrences(JSON.stringify(rotated), 'whsec_REDACTED_be3e')).toBe(1);
    expect(server.last.body).toBe('');
    expect(server.last.headers['idempotency-key']).toBeDefined();
  });

  it('maps 404 to NotFoundError and 403 to PermissionError', async () => {
    server.once('POST', `${ENDPOINT_PATH}/rotate-secret`, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Webhook endpoint not found')));
    server.once('POST', `${ENDPOINT_PATH}/rotate-secret`, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    const client = makeClient(server);
    await expect(client.webhookEndpoints.rotateSecret(ENDPOINT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.webhookEndpoints.rotateSecret(ENDPOINT)).rejects.toBeInstanceOf(PermissionError);
  });

  it('rejects a response that carries no secret', async () => {
    server.on('POST', `${ENDPOINT_PATH}/rotate-secret`, (_req, res) => reply(res, 200, envelope('SECRET_ROTATED', { id: ENDPOINT, secret: '' })));
    await expect(makeClient(server).webhookEndpoints.rotateSecret(ENDPOINT)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('webhookEndpoints.ping', () => {
  it('queues a ping and returns the event and endpoint ids', async () => {
    server.on('POST', `${ENDPOINT_PATH}/ping`, (_req, res) => reply(res, 202, pingFixture));
    const ping = await makeClient(server).webhookEndpoints.ping(ENDPOINT);
    expect(ping).toEqual({ eventId: 'evt_a05fd3fddfea4ac8bf76a442e3cf441d', endpointId: ENDPOINT, requestId: pingFixture.uuid, replayed: false });
    expect(server.last.body).toBe('');
    expect(server.last.headers['idempotency-key']).toBeDefined();
  });

  it('maps 404 to NotFoundError and 403 to PermissionError', async () => {
    server.once('POST', `${ENDPOINT_PATH}/ping`, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Webhook endpoint not found')));
    server.once('POST', `${ENDPOINT_PATH}/ping`, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    const client = makeClient(server);
    await expect(client.webhookEndpoints.ping(ENDPOINT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.webhookEndpoints.ping(ENDPOINT)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('webhookEndpoints.listDeliveries', () => {
  it('maps the recorded delivery page and sends the filters', async () => {
    server.on('GET', `${ENDPOINT_PATH}/deliveries`, (_req, res) => reply(res, 200, deliveriesFixture));
    const page = await makeClient(server).webhookEndpoints.listDeliveries(ENDPOINT, { status: 'Pending', page: 1, pageSize: 5 });
    expect(server.last.query.get('status')).toBe('Pending');
    expect(server.last.query.get('page')).toBe('1');
    expect(server.last.query.get('pageSize')).toBe('5');
    expect(page.requestId).toBe(deliveriesFixture.uuid);
    expect(page.pagination).toEqual({ totalItems: 1, page: 1, pageSize: 5, totalPages: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: DELIVERY,
      eventId: 'a05fd3fd-dfea-4ac8-bf76-a442e3cf441d',
      eventType: 'ping',
      orderId: null,
      orderReferenceId: null,
      status: 'Pending',
      attempts: 1,
      maxAttempts: 11,
      nextAttemptAt: '2026-09-25T23:43:33.380257Z',
      lastAttemptAt: '2026-09-25T23:42:33.380257Z',
      lastStatusCode: 405,
      lastError: 'HTTP 405',
      durationMs: 759,
      succeededAt: null,
      replayOfId: null,
      createdAt: '2026-09-25T23:42:32.433581Z',
    });
    expect(page.items[0]?.responseSnippet?.startsWith('<!doctype html>')).toBe(true);
    expect(page.items[0]?.raw).toEqual((deliveriesFixture.data['data'] as Record<string, unknown>[])[0]);
  });

  it('omits unset filters and normalises an integer status', async () => {
    server.on('GET', `${ENDPOINT_PATH}/deliveries`, (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { data: [{ id: 'd1', status: 1 }, { id: 'd2', status: 'failed' }], pagination: { totalItems: 2, page: 1, pageSize: 20, totalPages: 1 } })),
    );
    const page = await makeClient(server).webhookEndpoints.listDeliveries(ENDPOINT);
    expect([...server.last.query.keys()]).toEqual([]);
    expect(page.items.map((d) => d.status)).toEqual(['Succeeded', 'Failed']);
  });

  it('refuses an unknown status or a non-positive page before sending', async () => {
    const client = makeClient(server);
    const error = await client.webhookEndpoints.listDeliveries(ENDPOINT, { status: 'Done' as never, page: 0, pageSize: 1.5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors.map((e) => e.field)).toEqual(['status', 'page', 'pageSize']);
    expect(server.requests).toHaveLength(0);
  });

  it('maps 404 to NotFoundError and 403 to PermissionError', async () => {
    server.once('GET', `${ENDPOINT_PATH}/deliveries`, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Webhook endpoint not found')));
    server.once('GET', `${ENDPOINT_PATH}/deliveries`, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    const client = makeClient(server);
    await expect(client.webhookEndpoints.listDeliveries(ENDPOINT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.webhookEndpoints.listDeliveries(ENDPOINT)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('webhookEndpoints.replayDelivery', () => {
  it('queues the replay and maps the new delivery with replayOfId', async () => {
    server.on('POST', `${ENDPOINT_PATH}/deliveries/${DELIVERY}/replay`, (_req, res) => reply(res, 202, replayFixture));
    const replayed = await makeClient(server).webhookEndpoints.replayDelivery(ENDPOINT, DELIVERY);
    expect(replayed).toMatchObject({
      id: '2743654e-550b-458d-bfe2-ad3338d47807',
      eventId: 'a05fd3fd-dfea-4ac8-bf76-a442e3cf441d',
      eventType: 'ping',
      status: 'Pending',
      attempts: 0,
      maxAttempts: 11,
      lastAttemptAt: null,
      lastStatusCode: null,
      replayOfId: DELIVERY,
      createdAt: '2026-09-25T23:42:36.7925582Z',
      requestId: replayFixture.uuid,
      replayed: false,
    });
    expect(replayed.raw).toEqual(replayFixture.data);
    expect(server.last.body).toBe('');
    expect(server.last.headers['idempotency-key']).toBeDefined();
  });

  it('maps 404 to NotFoundError and 403 to PermissionError', async () => {
    server.once('POST', `${ENDPOINT_PATH}/deliveries/${DELIVERY}/replay`, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Delivery not found')));
    server.once('POST', `${ENDPOINT_PATH}/deliveries/${DELIVERY}/replay`, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    const client = makeClient(server);
    await expect(client.webhookEndpoints.replayDelivery(ENDPOINT, DELIVERY)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.webhookEndpoints.replayDelivery(ENDPOINT, DELIVERY)).rejects.toBeInstanceOf(PermissionError);
  });

  it('refuses an empty delivery id before sending', async () => {
    await expect(makeClient(server).webhookEndpoints.replayDelivery(ENDPOINT, '')).rejects.toBeInstanceOf(ConfigurationError);
    expect(server.requests).toHaveLength(0);
  });
});
