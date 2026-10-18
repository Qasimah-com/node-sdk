import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConfigurationError, NotFoundError, PermissionError, ValidationError, type Order } from '../src/index.js';
import { encodeReferencePath, parseContentDispositionFileName } from '../src/resources/orders.js';
import { fixture } from './helpers/fixtures.js';
import { TestServer, envelope, failure, makeClient, reply } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

const ORDER = '5c4a3eb5-c2b1-4d0f-b32a-062c379cfeac';
const REFERENCE = 'CART-101412-9299-G';
const listFixture = fixture<{ data: { data: unknown[]; pagination: unknown } }>('orders-list.json');
const detailFixture = fixture<{ data: Record<string, unknown> }>('order-detail.declined.json');
const byReferenceFixture = fixture<{ data: Record<string, unknown> }>('order-by-reference.json');

const PLATFORM_INTERNALS = [
  'declinedReason',
  'declinedCode',
  'decisionGateTrace',
  'decisionFeatures',
  'decisionReasons',
  'decisionId',
  'decisionStatus',
  'score',
  'riskBand',
  'mdrRate',
  'apr',
  'adminFee',
  'processingFee',
  'planOffersJson',
  'contractAcceptedIp',
  'domainEvents',
  'isDeleted',
  'createdBy',
  'lynkStatus',
  'sanadId',
  'promissoryNoteStatus',
  'dpdDays',
  'writeOffReason',
  'merchant',
  'merchantId',
];

function expectRecordedDeclinedOrder(order: Order, requestId: string): void {
  expect(order).toMatchObject({
    id: ORDER,
    orderReferenceId: REFERENCE,
    status: 'Declined',
    paymentType: 'PayByInstalments',
    channel: 'Online',
    checkoutChannel: null,
    totalAmount: 250,
    taxAmount: 0,
    shippingAmount: 0,
    discountAmount: 0,
    currencyCode: 'SAR',
    countryCode: 'SA',
    description: 'Cart contract test',
    instalments: 4,
    downPaymentAmount: 0,
    approvedAmount: null,
    capturedAmount: 0,
    fulfilledAmount: 0,
    refundedAmount: 0,
    refundableAmount: 0,
    collectedAmount: 0,
    voidedAmount: 0,
    reversedAmount: 0,
    paymentUrl: null,
    providerSessionId: null,
    providerOrderId: null,
    createdAt: '2026-09-25T10:14:13.592218Z',
    confirmedAt: null,
    settledAt: null,
    ejarContractNumber: null,
    notificationLanguage: null,
    contractNumber: null,
    requestId,
    replayed: false,
  });
  expect(order.customer).toEqual({
    id: 'd28f47d0-4435-4604-9b76-70d129c20372',
    name: 'Noura Al-Shammari',
    email: 'cart-shopper@qasimha.test',
    phone: '+966512349999',
  });
  expect('nationalId' in (order.customer as object)).toBe(false);
  expect(order.items).toEqual([
    {
      referenceId: 'SKU-AR',
      name: 'سماعات لاسلكية',
      type: 'physical',
      sku: 'SKU-AR',
      quantity: 1,
      unitPrice: 250,
      totalAmount: 250,
      taxAmount: 0,
      discountAmount: 0,
      imageUrl: null,
    },
  ]);
  expect(order.installments).toEqual([]);
  expect(order.fulfillments).toEqual([]);
  expect(order.reversals).toEqual([]);
  expect(order.voids).toEqual([]);
  expect(order.statusHistory).toEqual([
    { fromStatus: 'Draft', toStatus: 'Draft', trigger: 'DecisionEvaluated', createdAt: '2026-09-25T10:14:13.623728Z' },
    { fromStatus: 'Draft', toStatus: 'Draft', trigger: 'DecisionDeclined', createdAt: '2026-09-25T10:14:13.623743Z' },
    { fromStatus: 'Draft', toStatus: 'Declined', trigger: 'DecisionDeclined', createdAt: '2026-09-25T10:14:13.623747Z' },
  ]);
  for (const internal of PLATFORM_INTERNALS) {
    expect(internal in order, internal).toBe(false);
    expect(internal in order.raw, `raw.${internal}`).toBe(false);
  }
}

describe('orders.list', () => {
  it('maps the recorded list fixture with enum names and pagination', async () => {
    server.on('GET', '/api/v1/merchant/orders', (_req, res) => reply(res, 200, listFixture));
    const page = await makeClient(server).orders.list({ status: 'approved', search: 'CART', page: 1, pageSize: 2 });
    expect(page.requestId).toBe('08bd4a65-79dd-46ee-8ee9-e6806313b740');
    expect(page.pagination).toEqual({ totalItems: 19, page: 1, pageSize: 2, totalPages: 10 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      id: ORDER,
      orderReferenceId: REFERENCE,
      status: 'Declined',
      channel: 'Online',
      policyCode: 'BNPL_POLICY_V41',
      policyType: 'BNPL',
      totalAmount: 250,
      currencyCode: 'SAR',
      createdAt: '2026-09-25T10:14:13.592218Z',
      customerId: 'd28f47d0-4435-4604-9b76-70d129c20372',
      customerName: 'Noura Al-Shammari',
      customerEmail: 'cart-shopper@qasimha.test',
      customerPhone: '+966512349999',
      instalments: 4,
      capturedAmount: 0,
      refundedAmount: 0,
      ejarContractNumber: null,
    });
    expect(page.items[1]).toMatchObject({ id: 'c1e4f312-f61c-445f-bce4-8551984db9f3', orderReferenceId: 'CART-101412-9299-A', totalAmount: 1302.1 });
    expect(page.items[0]?.raw['status']).toBe('Declined');
    const query = server.last.query;
    expect(query.get('status')).toBe('approved');
    expect(query.get('search')).toBe('CART');
    expect(query.get('page')).toBe('1');
    expect(query.get('pageSize')).toBe('2');
  });

  it('omits unset query parameters and normalises integer-encoded enums', async () => {
    server.on('GET', '/api/v1/merchant/orders', (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { data: [{ id: 'a', status: 5, channel: 2 }], pagination: { totalItems: 1, page: 1, pageSize: 20, totalPages: 1 } })),
    );
    const page = await makeClient(server).orders.list();
    expect([...server.last.query.keys()]).toEqual([]);
    expect(page.items[0]).toMatchObject({ id: 'a', status: 'Confirmed', channel: 'QrCode' });
  });
});

describe('orders.get', () => {
  it('maps the recorded declined order into the curated model and keeps everything in raw', async () => {
    server.on('GET', `/api/v1/merchant/orders/${ORDER}`, (_req, res) => reply(res, 200, detailFixture));
    const order = await makeClient(server).orders.get(ORDER);
    expectRecordedDeclinedOrder(order, '44d0220d-09a5-4c0e-9e08-288ca3f71f3c');
    expect(order.raw).toEqual(detailFixture.data);
  });

  it('maps nested collections and integer enums on a fuller order', async () => {
    server.on('GET', `/api/v1/merchant/orders/${ORDER}`, (_req, res) =>
      reply(
        res,
        200,
        envelope('SUCCESS', {
          id: ORDER,
          status: 'FullyFulfilled',
          paymentType: 'PayNow',
          channel: 1,
          installments: [
            { sequence: 1, dueDate: '2026-10-25T00:00:00Z', amount: 325.53, principal: 325.53, profit: 0, status: 1, paidAmount: 325.53, paidAt: '2026-09-25T10:00:00Z', providerRef: 'p1' },
            { sequence: 2, dueDate: '2026-11-25T00:00:00Z', amount: 325.52, principal: 325.52, profit: 0, status: 'Scheduled', paidAmount: 0, paidAt: null, providerRef: null },
          ],
          fulfillments: [{ id: 'f1', amount: 1302.1, currencyCode: 'SAR', shippingCompany: 'Aramex', trackingNumber: 'ARX1', trackingUrl: 'https://t', providerCaptureId: null, createdAt: '2026-09-26T00:00:00Z' }],
          reversals: [{ id: 'r1', amount: 100, currencyCode: 'SAR', comment: 'return', fulfillmentId: 'f1', providerRefundId: null, createdAt: '2026-09-27T00:00:00Z' }],
          voids: [{ id: 'v1', amount: 5, currencyCode: 'SAR', reason: 'x', providerCancelId: null, createdAt: '2026-09-28T00:00:00Z' }],
          statusHistory: [{ fromStatus: 5, toStatus: 6, trigger: 'Fulfilled', createdAt: '2026-09-26T00:00:00Z' }],
          customer: null,
        }),
      ),
    );
    const order = await makeClient(server).orders.get(ORDER);
    expect(order.status).toBe('FullyFulfilled');
    expect(order.paymentType).toBe('PayNow');
    expect(order.channel).toBe('InStore');
    expect(order.customer).toBeNull();
    expect(order.installments.map((i) => i.status)).toEqual(['Paid', 'Scheduled']);
    expect(order.installments[0]).toMatchObject({ sequence: 1, amount: 325.53, providerRef: 'p1' });
    expect(order.fulfillments[0]).toMatchObject({ id: 'f1', shippingCompany: 'Aramex', trackingNumber: 'ARX1' });
    expect(order.reversals[0]).toMatchObject({ id: 'r1', comment: 'return', fulfillmentId: 'f1' });
    expect(order.voids[0]).toMatchObject({ id: 'v1', reason: 'x' });
    expect(order.statusHistory[0]).toMatchObject({ fromStatus: 'Confirmed', toStatus: 'FullyFulfilled' });
  });

  it('refuses an empty id before sending', async () => {
    await expect(makeClient(server).orders.get('')).rejects.toBeInstanceOf(ConfigurationError);
    expect(server.requests).toHaveLength(0);
  });

  it('url-encodes the id', async () => {
    server.on('GET', '/api/v1/merchant/orders/a%20b', (_req, res) => reply(res, 200, envelope('SUCCESS', { id: 'a b' })));
    expect((await makeClient(server).orders.get('a b')).id).toBe('a b');
  });
});

describe('orders.getByReference', () => {
  it('maps the recorded by-reference fixture to the same Order model as get', async () => {
    server.on('GET', `/api/v1/merchant/orders/by-reference/${REFERENCE}`, (_req, res) => reply(res, 200, byReferenceFixture));
    const order = await makeClient(server).orders.getByReference(REFERENCE);
    expectRecordedDeclinedOrder(order, '22e61620-9158-4afd-ac79-a362a10ac7d5');
    expect(order.raw).toEqual(byReferenceFixture.data);
    expect([...server.last.query.keys()]).toEqual([]);
  });

  it('encodes each path segment and keeps / as the separator', async () => {
    server.on('GET', '/api/v1/merchant/orders/by-reference/ORDER/2026/1', (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: 'o1', orderReferenceId: 'ORDER/2026/1' })),
    );
    server.on('GET', '/api/v1/merchant/orders/by-reference/A%20B%231%26x%3Dy%3F/c%25d', (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: 'o2', orderReferenceId: 'A B#1&x=y?/c%d' })),
    );
    server.on('GET', '/api/v1/merchant/orders/by-reference/%D8%B7%D9%84%D8%A8-1', (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: 'o3', orderReferenceId: 'طلب-1' })),
    );
    const client = makeClient(server);
    expect((await client.orders.getByReference('ORDER/2026/1')).id).toBe('o1');
    expect((await client.orders.getByReference('A B#1&x=y?/c%d')).orderReferenceId).toBe('A B#1&x=y?/c%d');
    expect([...server.last.query.keys()]).toEqual([]);
    expect((await client.orders.getByReference('طلب-1')).id).toBe('o3');
    expect(encodeReferencePath('ORDER/2026/1')).toBe('ORDER/2026/1');
    expect(encodeReferencePath('a b/c%d')).toBe('a%20b/c%25d');
  });

  it('maps an unknown or foreign reference to NotFoundError', async () => {
    server.on('GET', '/api/v1/merchant/orders/by-reference/NOPE', (_req, res) => reply(res, 404, failure('NOT_FOUND', 'Order not found')));
    const error = await makeClient(server).orders.getByReference('NOPE').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('maps a key without orders:read to PermissionError', async () => {
    server.on('GET', `/api/v1/merchant/orders/by-reference/${REFERENCE}`, (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    await expect(makeClient(server).orders.getByReference(REFERENCE)).rejects.toBeInstanceOf(PermissionError);
  });

  it('refuses an empty reference before sending', async () => {
    const client = makeClient(server);
    await expect(client.orders.getByReference('')).rejects.toBeInstanceOf(ConfigurationError);
    await expect(client.orders.getByReference('   ')).rejects.toBeInstanceOf(ConfigurationError);
    expect(server.requests).toHaveLength(0);
  });
});

describe('order mutations', () => {
  it('captures', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/capture`, (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: ORDER, status: 5, confirmedAt: '2026-09-25T09:30:00Z' })),
    );
    const result = await makeClient(server).orders.capture(ORDER);
    expect(result).toMatchObject({ id: ORDER, status: 'Confirmed', confirmedAt: '2026-09-25T09:30:00Z' });
    expect(server.last.body).toBe('');
    expect(server.last.headers['idempotency-key']).toBeDefined();
  });

  it('cancels', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/cancel`, (_req, res) => reply(res, 200, envelope('SUCCESS', { id: ORDER, status: 'Voided' })));
    expect(await makeClient(server).orders.cancel(ORDER)).toMatchObject({ id: ORDER, status: 'Voided' });
  });

  it('refunds with amount and reason and validates the amount', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/refund`, (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: ORDER, status: 9, refundedAmount: 300 })),
    );
    const client = makeClient(server);
    const result = await client.orders.refund(ORDER, { amount: 300, reason: 'Customer return' });
    expect(result).toMatchObject({ id: ORDER, status: 'PartiallyReversed', refundedAmount: 300 });
    expect(server.last.json).toEqual({ amount: 300, reason: 'Customer return' });

    await client.orders.refund(ORDER, { amount: 10 });
    expect(server.last.json).toEqual({ amount: 10 });

    for (const amount of [0, -1, 1.005, Number.NaN]) {
      const error = await client.orders.refund(ORDER, { amount }).catch((e: unknown) => e);
      expect(error, String(amount)).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).errors[0]?.field).toBe('amount');
    }
  });

  it('fulfils with optional shipping details', async () => {
    server.on('POST', `/api/v1/merchant/orders/${ORDER}/fulfill`, (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { id: ORDER, status: 'PartiallyFulfilled', fulfilledAmount: 1200 })),
    );
    const client = makeClient(server);
    const result = await client.orders.fulfill(ORDER, { shippedAmount: 1200, shippingCompany: 'Aramex', trackingNumber: 'ARX123', trackingUrl: 'https://track.example/ARX123' });
    expect(result).toMatchObject({ id: ORDER, status: 'PartiallyFulfilled', fulfilledAmount: 1200 });
    expect(server.last.json).toEqual({ shippedAmount: 1200, shippingCompany: 'Aramex', trackingNumber: 'ARX123', trackingUrl: 'https://track.example/ARX123' });

    await client.orders.fulfill(ORDER);
    expect(server.last.json).toEqual({});
    expect(server.last.headers['content-type']).toBe('application/json; charset=utf-8');

    await expect(client.orders.fulfill(ORDER, { shippedAmount: 12.345 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns counts', async () => {
    server.on('GET', '/api/v1/merchant/orders/counts', (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { all: 7, approved: 1, authorised: 2, captured: 3, refunded: 0, cancelled: 1 })),
    );
    expect(await makeClient(server).orders.counts()).toMatchObject({ all: 7, approved: 1, authorised: 2, captured: 3, refunded: 0, cancelled: 1 });
  });

  it('downloads the contract as bytes with its content type and file name', async () => {
    const pdf = Buffer.from('%PDF-1.7 fake');
    server.on('GET', `/api/v1/merchant/orders/${ORDER}/contract`, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="contract-${ORDER}.pdf"`, 'x-request-id': 'req-pdf' });
      res.end(pdf);
    });
    const doc = await makeClient(server).orders.contract(ORDER);
    expect(Buffer.compare(doc.bytes, pdf)).toBe(0);
    expect(doc.contentType).toBe('application/pdf');
    expect(doc.fileName).toBe(`contract-${ORDER}.pdf`);
    expect(doc.requestId).toBe('req-pdf');
    expect(server.last.headers['accept']).toBe('*/*');
  });

  it('maps a JSON error on the contract endpoint', async () => {
    server.on('GET', `/api/v1/merchant/orders/${ORDER}/contract`, (_req, res) =>
      reply(res, 404, { success: false, uuid: 'u', code: 'NOT_FOUND', message: 'No contract on this order.', data: null, errors: null }),
    );
    await expect(makeClient(server).orders.contract(ORDER)).rejects.toMatchObject({ name: 'NotFoundError', code: 'NOT_FOUND' });
  });

  it('parses content-disposition file names', () => {
    expect(parseContentDispositionFileName('attachment; filename="a b.pdf"')).toBe('a b.pdf');
    expect(parseContentDispositionFileName('attachment; filename=plain.pdf')).toBe('plain.pdf');
    expect(parseContentDispositionFileName("attachment; filename*=UTF-8''%D8%B9%D9%82%D8%AF.pdf; filename=fallback.pdf")).toBe('عقد.pdf');
    expect(parseContentDispositionFileName('inline')).toBeNull();
    expect(parseContentDispositionFileName(null)).toBeNull();
  });
});
