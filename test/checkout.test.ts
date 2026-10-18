import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DuplicateOrderReferenceError, OrderDeclinedError, ValidationError } from '../src/index.js';
import { THREE_LINE_BASKET, item, sampleSession } from './helpers/fixtures.js';
import { TestServer, envelope, failure, makeClient, reply } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

const ORDER = '76c94cf2-db05-4c5a-b8da-bb05d1ae7cbc';
const SESSION = '/api/v1/pay/session/create';
const POS = '/api/v1/pay/pos/create';
const QR = '/api/v1/pay/qr/create';

describe('checkout.createSession', () => {
  it('sends the documented body with defaults and returns the Session', async () => {
    server.on('POST', SESSION, (_req, res) =>
      reply(
        res,
        201,
        envelope('SESSION_CREATED', { installmentId: ORDER, providerSessionId: 'sess_1', paymentUrl: 'https://pay.example/abc', status: 'New' }, 'created', 'u-1'),
      ),
    );
    const request = sampleSession();
    delete (request as { taxAmount?: number }).taxAmount;
    delete (request as { shippingAmount?: number }).shippingAmount;
    delete (request as { discountAmount?: number }).discountAmount;
    delete (request as { currencyCode?: string }).currencyCode;
    delete (request as { countryCode?: string }).countryCode;
    delete (request as { paymentType?: string }).paymentType;
    delete (request as { instalments?: number }).instalments;
    request.totalAmount = 1154;

    const session = await makeClient(server).checkout.createSession(request);
    expect(session).toMatchObject({
      orderId: ORDER,
      paymentUrl: 'https://pay.example/abc',
      providerSessionId: 'sess_1',
      status: 'New',
      requestId: 'u-1',
      replayed: false,
    });
    expect(session.raw['installmentId']).toBe(ORDER);

    const sent = server.last.json as Record<string, unknown>;
    expect(sent).toMatchObject({
      orderReferenceId: 'CART-TEST-A',
      totalAmount: 1154,
      taxAmount: 0,
      shippingAmount: 0,
      discountAmount: 0,
      currencyCode: 'SAR',
      countryCode: 'SA',
      paymentType: 'pay_by_instalments',
      instalments: 4,
      description: 'Cart contract test',
      consumer: { firstName: 'Noura', lastName: 'Al-Shammari', phoneNumber: '+966512349999', email: 'cart-shopper@qasimha.test', nationalId: null },
      shippingAddress: { line1: 'King Fahd Rd', city: 'Riyadh', countryCode: 'SA' },
      billingAddress: null,
    });
    expect(sent['merchantId']).toBeUndefined();
    expect(sent['decisionFeatures']).toBeUndefined();
    expect(sent['merchantUrl']).toBeUndefined();
    expect(sent['riskAssessment']).toBeUndefined();
    expect((sent['items'] as unknown[]).length).toBe(3);
    expect((sent['items'] as Record<string, unknown>[])[1]).toEqual({
      referenceId: 'SKU-2',
      name: 'USB-C Cable',
      type: 'physical',
      sku: 'SKU-2',
      quantity: 3,
      unitPrice: 45,
      totalAmount: 135,
      taxAmount: 0,
      discountAmount: 0,
      imageUrl: null,
    });
  });

  it('sends merchantUrl and riskAssessment when given', async () => {
    server.on('POST', SESSION, (_req, res) => reply(res, 201, envelope('SESSION_CREATED', { installmentId: ORDER, paymentUrl: 'https://p' })));
    await makeClient(server).checkout.createSession(
      sampleSession({
        merchantUrl: { success: 'https://shop.example/ok', failure: 'https://shop.example/fail', cancel: 'https://shop.example/cancel' },
        riskAssessment: { isExistingCustomer: true, totalOrderCount: 3, customerDob: '1990-01-01' },
        billingAddress: { firstName: 'N', lastName: 'A', line1: 'x', city: 'Riyadh', countryCode: 'SA' },
      }),
    );
    const sent = server.last.json as Record<string, unknown>;
    expect(sent['merchantUrl']).toEqual({
      success: 'https://shop.example/ok',
      failure: 'https://shop.example/fail',
      cancel: 'https://shop.example/cancel',
    });
    expect(sent['riskAssessment']).toEqual({ isExistingCustomer: true, totalOrderCount: 3, customerDob: '1990-01-01' });
    expect(sent['billingAddress']).toMatchObject({ line1: 'x', line2: null });
  });

  it('serialises float noise at the canonical two-decimal value', async () => {
    server.on('POST', SESSION, (_req, res) => reply(res, 201, envelope('SESSION_CREATED', { installmentId: ORDER, paymentUrl: 'https://p' })));
    const noisy = 0.1 + 0.2;
    expect(noisy).not.toBe(0.3);
    await makeClient(server).checkout.createSession(
      sampleSession({ totalAmount: noisy, taxAmount: 0, shippingAmount: 0, discountAmount: 0, items: [{ ...item('A', 'a', 'physical', 1, noisy), totalAmount: noisy }] }),
    );
    expect(server.last.body).toContain('"totalAmount":0.3');
    expect(server.last.body).not.toContain('0.30000000000000004');
  });

  it('throws DuplicateOrderReferenceError on a first-attempt 409', async () => {
    server.on('POST', SESSION, (_req, res) => reply(res, 409, failure('DUPLICATE_ORDER_REFERENCE', 'dup', { data: { installmentId: ORDER, paymentUrl: 'https://p/1' } })));
    const error = await makeClient(server).checkout.createSession(sampleSession()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DuplicateOrderReferenceError);
    expect((error as DuplicateOrderReferenceError).existingOrderId).toBe(ORDER);
    expect(server.requests).toHaveLength(1);
  });

  it('returns a Session when the 409 duplicate arrives on a retry of the same call', async () => {
    server.once('POST', SESSION, (_req, res) => reply(res, 503, undefined));
    server.on('POST', SESSION, (_req, res) =>
      reply(res, 409, failure('DUPLICATE_ORDER_REFERENCE', 'dup', { data: { installmentId: ORDER, paymentUrl: 'https://p/1', status: 'New' }, uuid: 'u-dup' })),
    );
    const lines: string[] = [];
    const session = await makeClient(server, { logger: (level, message) => lines.push(`${level}:${message}`) }).checkout.createSession(sampleSession());
    expect(session).toMatchObject({ orderId: ORDER, paymentUrl: 'https://p/1', status: 'New', requestId: 'u-dup' });
    expect(server.requests).toHaveLength(2);
    expect(lines).toContain('info:duplicate order reference on a retry: the earlier attempt had succeeded');
  });

  it('still throws when the retry 409 carries no order id', async () => {
    server.once('POST', SESSION, (_req, res) => reply(res, 503, undefined));
    server.on('POST', SESSION, (_req, res) => reply(res, 409, failure('DUPLICATE_ORDER_REFERENCE', 'dup')));
    await expect(makeClient(server).checkout.createSession(sampleSession())).rejects.toBeInstanceOf(DuplicateOrderReferenceError);
  });

  it('throws OrderDeclinedError on 422 ORDER_DECLINED', async () => {
    server.on('POST', SESSION, (_req, res) => reply(res, 422, failure('ORDER_DECLINED', 'declined', { data: { installmentId: ORDER } })));
    const error = await makeClient(server).checkout.createSession(sampleSession()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderDeclinedError);
    expect((error as OrderDeclinedError).orderId).toBe(ORDER);
  });

  it('refuses a mismatched basket before sending anything', async () => {
    const error = await makeClient(server)
      .checkout.createSession(sampleSession({ totalAmount: 10, items: [item('SKU-9', 'Laptop', 'physical', 1, 5000)] }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toEqual([
      { field: 'totalAmount', message: 'must equal the sum of item totals + taxAmount + shippingAmount - discountAmount (expected 5148.10, got 10.00)' },
    ]);
    expect(server.requests).toHaveLength(0);
  });
});

describe('checkout.createPosSession', () => {
  it('requires the consumer email and applies the basket identity', async () => {
    const client = makeClient(server);
    const missingEmail = await client.checkout
      .createPosSession({ orderReferenceId: 'POS-1', totalAmount: 1154, items: THREE_LINE_BASKET, consumer: { firstName: 'N', lastName: 'A', phoneNumber: '+9665' } as never })
      .catch((e: unknown) => e);
    expect(missingEmail).toBeInstanceOf(ValidationError);
    expect((missingEmail as ValidationError).errors).toEqual([{ field: 'consumer.email', message: 'is required' }]);

    const mismatch = await client.checkout
      .createPosSession({ orderReferenceId: 'POS-1', totalAmount: 1000, items: THREE_LINE_BASKET, consumer: { firstName: 'N', lastName: 'A', phoneNumber: '+9665', email: 'a@b.c' } })
      .catch((e: unknown) => e);
    expect((mismatch as ValidationError).errors[0]?.field).toBe('totalAmount');
    expect(server.requests).toHaveLength(0);
  });

  it('returns the PosSession with the hosted checkout URL', async () => {
    server.on('POST', POS, (_req, res) =>
      reply(res, 201, envelope('SESSION_CREATED', { installmentId: ORDER, providerSessionId: null, checkoutUrl: `https://checkout.example/pay/${ORDER}`, status: 'AwaitingCheckout' })),
    );
    const pos = await makeClient(server).checkout.createPosSession({
      orderReferenceId: 'POS-1',
      totalAmount: 1154,
      items: THREE_LINE_BASKET,
      consumer: { firstName: 'N', lastName: 'A', phoneNumber: '+966500000000', email: 'a@b.c' },
    });
    expect(pos).toMatchObject({ orderId: ORDER, checkoutUrl: `https://checkout.example/pay/${ORDER}`, status: 'AwaitingCheckout', providerSessionId: null });
    const sent = server.last.json as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['consumer', 'countryCode', 'currencyCode', 'items', 'orderReferenceId', 'totalAmount']);
    expect(sent['consumer']).toMatchObject({ email: 'a@b.c' });
  });

  it('sends merchantUrl on the POS create when given', async () => {
    server.on('POST', POS, (_req, res) => reply(res, 201, envelope('SESSION_CREATED', { installmentId: ORDER, checkoutUrl: 'https://c/pay/x' })));
    await makeClient(server).checkout.createPosSession({
      orderReferenceId: 'POS-2',
      totalAmount: 1154,
      items: THREE_LINE_BASKET,
      consumer: { firstName: 'N', lastName: 'A', phoneNumber: '+966500000000', email: 'a@b.c' },
      merchantUrl: { success: 'myshop://qasimha/return', failure: 'myshop://qasimha/return' },
    });
    expect((server.last.json as Record<string, unknown>)['merchantUrl']).toEqual({ success: 'myshop://qasimha/return', failure: 'myshop://qasimha/return' });
  });
});

describe('checkout.createQrSession', () => {
  it('returns the QrSession', async () => {
    server.on('POST', QR, (_req, res) =>
      reply(res, 201, envelope('SESSION_CREATED', { installmentId: ORDER, providerSessionId: 'q', qrCodeUrl: 'https://qr.example/x', status: 'New' })),
    );
    const qr = await makeClient(server).checkout.createQrSession({ orderReferenceId: 'QR-1', totalAmount: 1154, items: THREE_LINE_BASKET });
    expect(qr).toMatchObject({ orderId: ORDER, qrCodeUrl: 'https://qr.example/x', status: 'New' });
    const sent = server.last.json as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['countryCode', 'currencyCode', 'items', 'orderReferenceId', 'totalAmount']);

    await makeClient(server).checkout.createQrSession({ orderReferenceId: 'QR-1', totalAmount: 1154, items: THREE_LINE_BASKET, merchantUrl: { success: 'https://s', failure: 'https://f', cancel: 'http://localhost:3000/cart' } });
    expect((server.last.json as Record<string, unknown>)['merchantUrl']).toEqual({ success: 'https://s', failure: 'https://f', cancel: 'http://localhost:3000/cart' });
  });

  it('normalises a 201 with status Declined to OrderDeclinedError', async () => {
    server.on('POST', QR, (_req, res) =>
      reply(res, 201, envelope('SESSION_CREATED', { installmentId: ORDER, providerSessionId: null, qrCodeUrl: '', status: 'Declined' }, 'created', 'u-qr')),
    );
    const error = await makeClient(server).checkout.createQrSession({ orderReferenceId: 'QR-2', totalAmount: 1154, items: THREE_LINE_BASKET }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderDeclinedError);
    expect((error as OrderDeclinedError).orderId).toBe(ORDER);
    expect((error as OrderDeclinedError).code).toBe('ORDER_DECLINED');
    expect((error as OrderDeclinedError).httpStatus).toBe(201);
    expect((error as OrderDeclinedError).requestId).toBe('u-qr');
  });

  it('maps a 422 ORDER_DECLINED the same way as the online session', async () => {
    server.on('POST', QR, (_req, res) => reply(res, 422, failure('ORDER_DECLINED', 'declined', { data: { installmentId: ORDER } })));
    await expect(makeClient(server).checkout.createQrSession({ orderReferenceId: 'QR-3', totalAmount: 1154, items: THREE_LINE_BASKET })).rejects.toBeInstanceOf(OrderDeclinedError);
  });
});
