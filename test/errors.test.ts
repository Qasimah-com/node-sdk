import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError,
  AuthenticationError,
  ConflictError,
  DuplicateOrderReferenceError,
  NotFoundError,
  OrderDeclinedError,
  PermissionError,
  QasimhaError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../src/index.js';
import { sampleSession } from './helpers/fixtures.js';
import { TestServer, envelope, failure, makeClient, reply } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

const ORDER = '76c94cf2-db05-4c5a-b8da-bb05d1ae7cbc';
const COUNTS = '/api/v1/merchant/orders/counts';

async function capture<T extends Error>(promise: Promise<unknown>, type: new (...args: never[]) => T): Promise<T> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return error as T;
  }
  throw new Error(`expected ${type.name} to be thrown`);
}

describe('error mapping', () => {
  it('maps 400 VALIDATION_ERROR with the field errors passed through unchanged', async () => {
    server.on('POST', '/api/v1/pay/session/create', (_req, res) =>
      reply(
        res,
        400,
        failure('VALIDATION_ERROR', 'Validation failed', {
          uuid: 'req-400',
          errors: [
            { field: 'TotalAmount', message: 'Must be greater than 0' },
            { field: 'Items[0].Quantity', message: 'Must be at least 1' },
          ],
        }),
      ),
    );
    const error = await capture(makeClient(server).checkout.createSession(sampleSession()), ValidationError);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.httpStatus).toBe(400);
    expect(error.requestId).toBe('req-400');
    expect(error.message).toBe('Validation failed');
    expect(error.errors).toEqual([
      { field: 'TotalAmount', message: 'Must be greater than 0' },
      { field: 'Items[0].Quantity', message: 'Must be at least 1' },
    ]);
    expect(error).toBeInstanceOf(QasimhaError);
    expect((error.raw as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('maps every other 400 code to ValidationError too', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/capture`, (_req, res) =>
      reply(res, 400, failure('INVALID_STATUS', 'Order cannot be confirmed in status Confirmed')),
    );
    const error = await capture(makeClient(server).orders.capture(ORDER), ValidationError);
    expect(error.code).toBe('INVALID_STATUS');
    expect(error.message).toBe('Order cannot be confirmed in status Confirmed');
    expect(error.errors).toEqual([]);
  });

  it('maps an empty-body 401 with a WWW-Authenticate challenge', async () => {
    server.on('GET', COUNTS, (_req, res) => {
      res.writeHead(401, { 'www-authenticate': 'ApiKey realm="merchant-api"' });
      res.end();
    });
    const error = await capture(makeClient(server).orders.counts(), AuthenticationError);
    expect(error.httpStatus).toBe(401);
    expect(error.code).toBeNull();
    expect(error.requestId).toBeNull();
    expect(error.message).toContain('401');
    expect(error.message).not.toContain('sk_test');
  });

  it('maps a policy-level 403 with an empty body and a scope-level 403 with an envelope', async () => {
    server.once('GET', '/api/v1/merchant/settlements/overview', (_req, res) => {
      res.writeHead(403, { 'www-authenticate': 'ApiKey realm="merchant-api"' });
      res.end();
    });
    server.once('GET', '/api/v1/merchant/settlements/overview', (_req, res) =>
      reply(res, 403, failure('FORBIDDEN', "Your role isn't allowed to view settlements.")),
    );
    const client = makeClient(server);
    const empty = await capture(client.settlements.overview(), PermissionError);
    expect(empty.code).toBeNull();
    const scoped = await capture(client.settlements.overview(), PermissionError);
    expect(scoped.code).toBe('FORBIDDEN');
    expect(scoped.message).toBe("Your role isn't allowed to view settlements.");
  });

  it('maps 404', async () => {
    server.on('GET', `/api/v1/merchant/orders/${ORDER}`, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Order not found')));
    const error = await capture(makeClient(server).orders.get(ORDER), NotFoundError);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('maps 409 DUPLICATE_ORDER_REFERENCE with the existing order and a null payment URL', async () => {
    server.on('POST', '/api/v1/pay/session/create', (_req, res) =>
      reply(res, 409, failure('DUPLICATE_ORDER_REFERENCE', 'Order reference already used', { data: { installmentId: ORDER, paymentUrl: null } })),
    );
    const error = await capture(makeClient(server).checkout.createSession(sampleSession()), DuplicateOrderReferenceError);
    expect(error.existingOrderId).toBe(ORDER);
    expect(error.existingPaymentUrl).toBeNull();
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.toJSON()).toMatchObject({ name: 'DuplicateOrderReferenceError', existingOrderId: ORDER });
  });

  it('maps 409 DUPLICATE_ORDER_REFERENCE with a payment URL when the checkout is still open', async () => {
    server.on('POST', '/api/v1/pay/session/create', (_req, res) =>
      reply(res, 409, failure('DUPLICATE_ORDER_REFERENCE', 'dup', { data: { installmentId: ORDER, paymentUrl: 'https://pay.example/x' } })),
    );
    const error = await capture(makeClient(server).checkout.createSession(sampleSession()), DuplicateOrderReferenceError);
    expect(error.existingPaymentUrl).toBe('https://pay.example/x');
  });

  it('maps any other 409 to ConflictError', async () => {
    server.on('POST', '/api/v1/pay/session/create', (_req, res) => reply(res, 409, failure('MERCHANT_SUSPENDED', 'suspended')));
    const error = await capture(makeClient(server).checkout.createSession(sampleSession()), ConflictError);
    expect(error).not.toBeInstanceOf(DuplicateOrderReferenceError);
    expect(error.code).toBe('MERCHANT_SUSPENDED');
  });

  it('maps 422 ORDER_DECLINED carrying the order id', async () => {
    server.on('POST', '/api/v1/pay/session/create', (_req, res) =>
      reply(res, 422, failure('ORDER_DECLINED', 'The order was not approved', { data: { installmentId: ORDER, paymentUrl: null, status: 'Declined' } })),
    );
    const error = await capture(makeClient(server).checkout.createSession(sampleSession()), OrderDeclinedError);
    expect(error.orderId).toBe(ORDER);
    expect(error.httpStatus).toBe(422);
    expect(error.message).toBe('The order was not approved');
  });

  it('maps a 422 with another code to ApiError', async () => {
    server.on('POST', '/api/v1/pay/session/create', (_req, res) => reply(res, 422, failure('SOMETHING_ELSE', 'x')));
    const error = await capture(makeClient(server, { maxRetries: 0 }).checkout.createSession(sampleSession()), ApiError);
    expect(error).not.toBeInstanceOf(ServerError);
    expect(error.code).toBe('SOMETHING_ELSE');
  });

  it('maps 429 with retryAfter from the header', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 429, failure('RATE_LIMITED', 'slow down'), { 'retry-after': '7' }));
    const error = await capture(makeClient(server, { maxRetries: 0 }).orders.counts(), RateLimitError);
    expect(error.retryAfter).toBe(7);
    expect(error.httpStatus).toBe(429);
  });

  it('maps 429 without a Retry-After header to a null retryAfter', async () => {
    server.on('GET', COUNTS, (_req, res) => {
      res.writeHead(429);
      res.end();
    });
    const error = await capture(makeClient(server, { maxRetries: 0 }).orders.counts(), RateLimitError);
    expect(error.retryAfter).toBeNull();
    expect(error.code).toBeNull();
  });

  it('maps 500 to ServerError without retrying', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 500, failure('INTERNAL_ERROR', 'boom')));
    const error = await capture(makeClient(server).orders.counts(), ServerError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.httpStatus).toBe(500);
    expect(server.requests).toHaveLength(1);
  });

  it('maps a non-JSON 502 body after retries are exhausted', async () => {
    server.on('GET', COUNTS, (_req, res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html>bad gateway</html>');
    });
    const error = await capture(makeClient(server, { maxRetries: 1 }).orders.counts(), ServerError);
    expect(error.code).toBeNull();
    expect(error.raw).toBe('<html>bad gateway</html>');
    expect(server.requests).toHaveLength(2);
  });

  it('treats a 3xx as ApiError and never follows it', async () => {
    server.on('GET', COUNTS, (_req, res) => {
      res.writeHead(302, { location: `${server.baseUrl}/elsewhere` });
      res.end();
    });
    const error = await capture(makeClient(server).orders.counts(), ApiError);
    expect(error.httpStatus).toBe(302);
    expect(server.requests).toHaveLength(1);
  });

  it('treats a 2xx with success:false as an ApiError carrying the envelope code', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 200, failure('WEIRD_STATE', 'not really ok', { uuid: 'u-2xx' })));
    const error = await capture(makeClient(server).orders.counts(), ApiError);
    expect(error.code).toBe('WEIRD_STATE');
    expect(error.httpStatus).toBe(200);
    expect(error.requestId).toBe('u-2xx');
    expect(error.message).toBe('not really ok');
  });

  it('maps any other 4xx to ApiError', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 418, failure('TEAPOT', 'short and stout')));
    const error = await capture(makeClient(server).orders.counts(), ApiError);
    expect(error.httpStatus).toBe(418);
  });

  it('serialises errors without the raw envelope but with the identifying fields', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 404, failure('NOT_FOUND', 'nope', { uuid: 'u-404' })));
    const error = await capture(makeClient(server).orders.counts(), NotFoundError);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'NotFoundError',
      message: 'nope',
      code: 'NOT_FOUND',
      httpStatus: 404,
      requestId: 'u-404',
      errors: [],
    });
    expect(error.name).toBe('NotFoundError');
    expect(String(error)).toBe('NotFoundError: nope');
  });

  it('still reads the envelope on a successful response that repeats a business code', async () => {
    server.on('GET', COUNTS, (_req, res) => reply(res, 200, envelope('SUCCESS', { all: 0 })));
    await expect(makeClient(server).orders.counts()).resolves.toMatchObject({ all: 0 });
  });
});
