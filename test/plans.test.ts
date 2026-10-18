import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthenticationError, ConfigurationError, RateLimitError, ValidationError } from '../src/index.js';
import { fixture } from './helpers/fixtures.js';
import { TestServer, envelope, failure, makeClient, reply, sleepRecorder } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

const PLANS = '/api/v1/widget/plans';
const PUBLISHABLE_KEY = 'pk_test_9f8e7d6c5b4aAbCd';
const OTHER_KEY = 'pk_test_ZZZZ0000';

interface PlansFixture {
  uuid: string;
  data: {
    merchantName: string;
    currency: string;
    minAmount: number;
    maxAmount: number;
    plans: Record<string, unknown>[];
  };
}

const PLANS_FIXTURE = fixture<PlansFixture>('widget-plans.json');

function serveFixture(): void {
  server.on('GET', PLANS, (_req, res) => reply(res, 200, PLANS_FIXTURE));
}

describe('checkout.getPlans', () => {
  it('returns the typed quote from the fixture with amounts as numbers', async () => {
    serveFixture();
    const quote = await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(1200);

    expect(quote).toMatchObject({
      merchantName: PLANS_FIXTURE.data.merchantName,
      currency: 'SAR',
      minAmount: 100,
      maxAmount: 4000,
      requestId: PLANS_FIXTURE.uuid,
      replayed: false,
    });
    expect(quote.plans).toHaveLength(3);
    expect(quote.plans[0]).toEqual({
      instalments: 2,
      frequency: 'monthly',
      instalmentAmount: 614.38,
      firstInstalmentAmount: 614.38,
      lastInstalmentAmount: 614.37,
      feesIncludingVat: 28.75,
      totalPayable: 1228.75,
      shariaCompliant: true,
    });
    expect(quote.plans.map((plan) => plan.instalments)).toEqual([2, 3, 4]);
    for (const plan of quote.plans) {
      for (const key of ['instalmentAmount', 'firstInstalmentAmount', 'lastInstalmentAmount', 'feesIncludingVat', 'totalPayable'] as const) {
        expect(typeof plan[key]).toBe('number');
      }
    }
    expect(quote.raw['merchantName']).toBe(PLANS_FIXTURE.data.merchantName);

    expect(server.last.method).toBe('GET');
    expect(server.last.path).toBe(PLANS);
    expect(server.last.query.get('amount')).toBe('1200');
    expect(server.last.query.get('currency')).toBe('SAR');
    expect(server.last.query.get('lang')).toBe('en');
  });

  it('authenticates with X-Public-Key only and keeps Accept-Language', async () => {
    serveFixture();
    await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(1200);
    const { headers } = server.last;
    expect(headers['x-public-key']).toBe(PUBLISHABLE_KEY);
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['accept-language']).toBe('en');
    expect(headers['accept']).toBe('application/json');
    expect(headers['idempotency-key']).toBeUndefined();

    await makeClient(server, { publishableKey: PUBLISHABLE_KEY, language: 'ar' }).checkout.getPlans(1200);
    expect(server.last.headers['accept-language']).toBe('ar');
    expect(server.last.query.get('lang')).toBe('ar');
  });

  it('sends a two-decimal amount at its canonical value', async () => {
    serveFixture();
    await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(0.1 + 0.2);
    expect(server.last.query.get('amount')).toBe('0.3');
    await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(1302.1);
    expect(server.last.query.get('amount')).toBe('1302.1');
  });

  it('takes a per-call publishable key and language', async () => {
    serveFixture();
    await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(1200, { publishableKey: OTHER_KEY, lang: 'ar' });
    expect(server.last.headers['x-public-key']).toBe(OTHER_KEY);
    expect(server.last.headers['x-api-key']).toBeUndefined();
    expect(server.last.headers['accept-language']).toBe('en');
    expect(server.last.query.get('lang')).toBe('ar');

    const quote = await makeClient(server).checkout.getPlans(1200, { publishableKey: OTHER_KEY });
    expect(quote.plans).toHaveLength(3);
    expect(server.last.headers['x-public-key']).toBe(OTHER_KEY);
  });

  it('returns an empty plans list as a result, not an error', async () => {
    server.on('GET', PLANS, (_req, res) =>
      reply(res, 200, envelope('OK', { merchantName: 'Shop', currency: 'SAR', minAmount: 100, maxAmount: 4000, plans: [] }, 'Plans quoted', 'u-empty')),
    );
    const quote = await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(50);
    expect(quote.plans).toEqual([]);
    expect(quote).toMatchObject({ minAmount: 100, maxAmount: 4000, requestId: 'u-empty' });

    server.on('GET', PLANS, (_req, res) => reply(res, 200, envelope('OK', { merchantName: 'Shop', currency: 'SAR', minAmount: 100, maxAmount: 4000, plans: null })));
    expect((await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(50)).plans).toEqual([]);
  });

  it('maps 401 PUBLIC_KEY_REQUIRED and INVALID_PUBLIC_KEY to AuthenticationError', async () => {
    server.on('GET', PLANS, (_req, res) => reply(res, 401, failure('PUBLIC_KEY_REQUIRED', 'Send your publishable key in the X-Public-Key header.')));
    const required = await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(1200).catch((e: unknown) => e);
    expect(required).toBeInstanceOf(AuthenticationError);
    expect(required).toMatchObject({ httpStatus: 401, code: 'PUBLIC_KEY_REQUIRED', message: 'Send your publishable key in the X-Public-Key header.' });

    server.on('GET', PLANS, (_req, res) => reply(res, 401, failure('INVALID_PUBLIC_KEY', 'The publishable key is unknown, revoked or expired.')));
    const invalid = await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(1200).catch((e: unknown) => e);
    expect(invalid).toBeInstanceOf(AuthenticationError);
    expect(invalid).toMatchObject({ httpStatus: 401, code: 'INVALID_PUBLIC_KEY' });
    expect(server.requests).toHaveLength(2);
  });

  it('maps 400 INVALID_AMOUNT and UNSUPPORTED_CURRENCY to ValidationError', async () => {
    server.on('GET', PLANS, (_req, res) => reply(res, 400, failure('INVALID_AMOUNT', 'amount must be a positive number with at most two decimals.')));
    const amount = await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(1200).catch((e: unknown) => e);
    expect(amount).toBeInstanceOf(ValidationError);
    expect(amount).toMatchObject({ httpStatus: 400, code: 'INVALID_AMOUNT' });

    server.on('GET', PLANS, (_req, res) => reply(res, 400, failure('UNSUPPORTED_CURRENCY', 'Only SAR is supported.')));
    const currency = await makeClient(server, { publishableKey: PUBLISHABLE_KEY }).checkout.getPlans(1200).catch((e: unknown) => e);
    expect(currency).toBeInstanceOf(ValidationError);
    expect(currency).toMatchObject({ httpStatus: 400, code: 'UNSUPPORTED_CURRENCY' });
  });

  it('throws ConfigurationError without a publishable key and sends nothing', async () => {
    serveFixture();
    const error = await makeClient(server).checkout.getPlans(1200).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).message).toMatch(/publishableKey/);
    expect(server.requests).toHaveLength(0);
  });

  it('refuses a malformed or mismatched per-call key before sending', async () => {
    serveFixture();
    const client = makeClient(server, { publishableKey: PUBLISHABLE_KEY });
    await expect(client.checkout.getPlans(1200, { publishableKey: 'sk_test_abc' })).rejects.toBeInstanceOf(ConfigurationError);
    await expect(client.checkout.getPlans(1200, { publishableKey: 'pk_live_abc' })).rejects.toBeInstanceOf(ConfigurationError);
    await expect(client.checkout.getPlans(1200, { publishableKey: '' })).rejects.toBeInstanceOf(ConfigurationError);
    expect(server.requests).toHaveLength(0);
  });

  it('refuses an amount with three decimals, zero, a negative or a non-number locally', async () => {
    serveFixture();
    const client = makeClient(server, { publishableKey: PUBLISHABLE_KEY });
    for (const amount of [10.555, 0, -5, Number.NaN, '1200' as never, undefined as never]) {
      const error = await client.checkout.getPlans(amount).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).httpStatus).toBeNull();
      expect((error as ValidationError).errors[0]?.field).toBe('amount');
    }
    const lang = await client.checkout.getPlans(1200, { lang: 'fr' as never }).catch((e: unknown) => e);
    expect(lang).toBeInstanceOf(ValidationError);
    expect((lang as ValidationError).errors[0]?.field).toBe('lang');
    expect(server.requests).toHaveLength(0);
  });

  it('retries on 429 like every GET and keeps the publishable key on the retry', async () => {
    server.once('GET', PLANS, (_req, res) => reply(res, 429, failure('RATE_LIMITED', 'slow'), { 'retry-after': '1' }));
    server.once('GET', PLANS, (_req, res) => reply(res, 503, undefined));
    serveFixture();
    const { sleep, delays } = sleepRecorder();
    const quote = await makeClient(server, { publishableKey: PUBLISHABLE_KEY, sleep }).checkout.getPlans(1200);
    expect(quote.plans).toHaveLength(3);
    expect(delays).toEqual([1000, 1000]);
    expect(server.requests).toHaveLength(3);
    for (const request of server.requests) {
      expect(request.headers['x-public-key']).toBe(PUBLISHABLE_KEY);
      expect(request.headers['x-api-key']).toBeUndefined();
    }
    expect(server.requests[0]?.headers['x-correlation-id']).toBe(server.requests[2]?.headers['x-correlation-id']);

    server.reset();
    server.on('GET', PLANS, (_req, res) => reply(res, 429, failure('RATE_LIMITED', 'slow'), { 'retry-after': '1' }));
    await expect(makeClient(server, { publishableKey: PUBLISHABLE_KEY, maxRetries: 1 }).checkout.getPlans(1200)).rejects.toBeInstanceOf(RateLimitError);
    expect(server.requests).toHaveLength(2);
  });

  it('never passes the publishable key to the logger', async () => {
    server.once('GET', PLANS, (_req, res) => reply(res, 503, failure('UNAVAILABLE', 'down')));
    serveFixture();
    const lines: { level: string; message: string; fields: Record<string, unknown> }[] = [];
    await makeClient(server, {
      publishableKey: PUBLISHABLE_KEY,
      logger: (level, message, fields) => lines.push({ level, message, fields }),
    }).checkout.getPlans(1200, { publishableKey: OTHER_KEY });
    const serialised = JSON.stringify(lines);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(serialised).not.toContain(PUBLISHABLE_KEY);
    expect(serialised).not.toContain(OTHER_KEY);
    expect(serialised).not.toContain('pk_test');
    expect(serialised).not.toContain('sk_test');
    expect(serialised).not.toContain('amount=');
    expect(lines.find((l) => l.message === 'request completed')?.fields).toMatchObject({ method: 'GET', path: PLANS, status: 200, attempt: 2 });
  });
});
