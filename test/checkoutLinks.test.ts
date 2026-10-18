import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../src/index.js';
import { TestServer, envelope, failure, makeClient, reply } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

const LINK = '0d3f9f2e-1a2b-4c3d-8e4f-000000000abc';
const LINKS = '/api/v1/merchant/checkout-links';

describe('checkoutLinks.create', () => {
  it('sends the request and maps the created link', async () => {
    server.on('POST', LINKS, (_req, res) =>
      reply(
        res,
        201,
        envelope('LINK_CREATED', {
          id: LINK,
          url: `https://checkout.example/pay/${LINK}`,
          channel: 'Link',
          amount: 250,
          currency: 'SAR',
          phone: '+966500000000',
          language: 'ar',
          orderReferenceId: 'MERCHANT-ORDER-12345',
          ejarContractNumber: null,
          items: [{ name: 'Shoes', sku: 'SH-1', quantity: 1, unitPrice: 250, total: 250, imageUrl: null }],
          status: 'AwaitingCheckout',
          expiresAt: '2026-09-25T11:00:00Z',
        }),
      ),
    );
    const link = await makeClient(server).checkoutLinks.create({
      amount: 250,
      channel: 'Link',
      phone: '+966500000000',
      language: 'ar',
      orderReferenceId: 'MERCHANT-ORDER-12345',
      items: [{ name: 'Shoes', sku: 'SH-1', quantity: 1, unitPrice: 250 }],
    });
    expect(link).toMatchObject({
      id: LINK,
      url: `https://checkout.example/pay/${LINK}`,
      channel: 'Link',
      amount: 250,
      currency: 'SAR',
      status: 'AwaitingCheckout',
      expiresAt: '2026-09-25T11:00:00Z',
      ejarContractNumber: null,
      replayed: false,
    });
    expect(link.items).toEqual([{ name: 'Shoes', sku: 'SH-1', quantity: 1, unitPrice: 250, total: 250, imageUrl: null }]);
    expect(link.completed).toBeUndefined();
    expect(server.last.json).toEqual({
      amount: 250,
      channel: 'Link',
      phone: '+966500000000',
      language: 'ar',
      orderReferenceId: 'MERCHANT-ORDER-12345',
      items: [{ name: 'Shoes', sku: 'SH-1', quantity: 1, unitPrice: 250, imageUrl: null }],
    });
    expect(server.last.headers['idempotency-key']).toBeDefined();
  });

  it('requires a phone for the Link channel but not for Qr', async () => {
    const client = makeClient(server);
    const error = await client.checkoutLinks.create({ amount: 10, channel: 'Link' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toEqual([{ field: 'phone', message: 'is required' }]);
    expect(server.requests).toHaveLength(0);

    server.on('POST', LINKS, (_req, res) => reply(res, 201, envelope('LINK_CREATED', { id: LINK, url: 'https://c/pay/x', channel: 'Qr' })));
    const qr = await client.checkoutLinks.create({ amount: 10, channel: 'Qr' });
    expect(qr.channel).toBe('Qr');
    expect(server.last.json).toEqual({ amount: 10, channel: 'Qr' });

    await client.checkoutLinks.create({ amount: 10, channel: 'Qr', merchantUrl: { success: 'https://s', failure: 'https://f' } });
    expect(server.last.json).toEqual({ amount: 10, channel: 'Qr', merchantUrl: { success: 'https://s', failure: 'https://f' } });
  });

  it('validates channel, language, amount and items', async () => {
    const client = makeClient(server);
    const error = await client.checkoutLinks
      .create({ amount: 1.999, channel: 'Sms' as never, language: 'fr' as never, phone: '+9665', items: [{ name: '', quantity: 0, unitPrice: -1 }] })
      .catch((e: unknown) => e);
    expect((error as ValidationError).errors.map((e) => e.field)).toEqual([
      'amount',
      'channel',
      'language',
      'items[0].name',
      'items[0].quantity',
      'items[0].unitPrice',
    ]);
  });

  it('maps the documented create errors', async () => {
    server.once('POST', LINKS, (_req, res) => reply(res, 400, failure('PHONE_REQUIRED', 'phone')));
    server.once('POST', LINKS, (_req, res) => reply(res, 404, failure('MERCHANT_NOT_FOUND', 'no merchant')));
    server.once('POST', LINKS, (_req, res) => reply(res, 409, failure('MERCHANT_SUSPENDED', 'suspended')));
    const client = makeClient(server);
    const request = { amount: 10, channel: 'Qr' as const };
    await expect(client.checkoutLinks.create(request)).rejects.toMatchObject({ name: 'ValidationError', code: 'PHONE_REQUIRED' });
    await expect(client.checkoutLinks.create(request)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.checkoutLinks.create(request)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('checkoutLinks reads and cancel', () => {
  it('lists the latest links from data.items with the waiting flag', async () => {
    server.on('GET', LINKS, (_req, res) =>
      reply(
        res,
        200,
        envelope('SUCCESS', {
          items: [
            { id: LINK, orderReferenceId: 'LINK-20260925-ABCDEF', amount: 250, currency: 'SAR', phone: '*****999', channel: 'Link', status: 'AwaitingCheckout', decisionStatus: null, expiresAt: '2026-09-25T11:00:00Z', createdAt: '2026-09-25T09:00:00Z', waiting: true },
            { id: 'other', status: 'Expired', waiting: false },
          ],
        }),
      ),
    );
    const list = await makeClient(server).checkoutLinks.list();
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toMatchObject({ id: LINK, phone: '*****999', channel: 'Link', status: 'AwaitingCheckout', waiting: true, decisionStatus: null });
    expect(list.items[0]?.url).toBeUndefined();
    expect(list.items[1]).toMatchObject({ id: 'other', status: 'Expired', waiting: false });
  });

  it('gets a link status with completed and declined flags', async () => {
    server.on('GET', `${LINKS}/${LINK}`, (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: LINK, orderReferenceId: 'X', amount: 250, currency: 'SAR', phone: '*****999', channel: 'Qr', status: 5, decisionStatus: 'APPROVED', expiresAt: null, createdAt: '2026-09-25T09:00:00Z', completed: true, declined: false })),
    );
    const link = await makeClient(server).checkoutLinks.get(LINK);
    expect(link).toMatchObject({ id: LINK, status: 'Confirmed', decisionStatus: 'APPROVED', completed: true, declined: false, expiresAt: null });
    expect(link.waiting).toBeUndefined();
  });

  it('cancels an open link and maps 409 NOT_OPEN', async () => {
    server.once('POST', `${LINKS}/${LINK}/cancel`, (_req, res) => reply(res, 200, envelope('LINK_CANCELLED', { id: LINK, status: 'Cancelled', completed: false, declined: false })));
    server.once('POST', `${LINKS}/${LINK}/cancel`, (_req, res) => reply(res, 409, failure('NOT_OPEN', 'Cannot cancel — status Confirmed.')));
    const client = makeClient(server);
    expect(await client.checkoutLinks.cancel(LINK)).toMatchObject({ id: LINK, status: 'Cancelled' });
    const error = await client.checkoutLinks.cancel(LINK).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe('NOT_OPEN');
  });
});
