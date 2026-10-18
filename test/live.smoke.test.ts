import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  DuplicateOrderReferenceError,
  NotFoundError,
  OrderDeclinedError,
  Qasimha,
  ValidationError,
  type CreateSessionRequest,
  type Item,
  type QasimhaOptions,
} from '../src/index.js';

const apiKey = process.env['QASIMHA_API_KEY'];
const webhooksApiKey = process.env['QASIMHA_WEBHOOKS_API_KEY'];
const publishableKey = process.env['QASIMHA_PUBLISHABLE_KEY'];
const baseUrl = process.env['QASIMHA_BASE_URL'];
const enabled = Boolean(apiKey && baseUrl);
const webhooksEnabled = Boolean(webhooksApiKey && baseUrl);
const plansEnabled = Boolean(apiKey && publishableKey && baseUrl);

const WEBHOOK_TEST_URL = 'https://example.com/qasimha-sdk-test';

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

async function installTestOnlyDispatcher(): Promise<void> {
  const resolveTo = process.env['QASIMHA_RESOLVE_TO'];
  const insecure = process.env['QASIMHA_TLS_INSECURE'] === '1';
  if (!resolveTo && !insecure) return;
  const { Agent, setGlobalDispatcher } = await import('undici');
  const connect: Record<string, unknown> = {};
  if (resolveTo) {
    const family = resolveTo.includes(':') ? 6 : 4;
    connect['lookup'] = (_hostname: string, options: { all?: boolean } | LookupCallback, callback?: LookupCallback) => {
      const done = typeof options === 'function' ? options : callback;
      const all = typeof options === 'object' && options !== null && options.all === true;
      if (!done) return;
      if (all) done(null, [{ address: resolveTo, family }]);
      else done(null, resolveTo, family);
    };
  }
  if (insecure) connect['rejectUnauthorized'] = false;
  setGlobalDispatcher(new Agent({ connect }));
}

function liveClient(key: string, publicKey?: string): Qasimha {
  const options: QasimhaOptions = {
    apiKey: key,
    baseUrl: baseUrl as string,
    timeout: 60_000,
    logger: (level, message, fields) => {
      if (level !== 'debug') console.log(level, message, JSON.stringify(fields));
    },
  };
  if (publicKey !== undefined) options.publishableKey = publicKey;
  return new Qasimha(options);
}

function item(referenceId: string, name: string, type: 'physical' | 'digital', quantity: number, unitPrice: number): Item {
  return {
    referenceId,
    name,
    type,
    sku: referenceId,
    quantity,
    unitPrice,
    totalAmount: Math.round(quantity * unitPrice * 100) / 100,
    taxAmount: 0,
    discountAmount: 0,
    imageUrl: null,
  };
}

function cart(ref: string, total: number, tax: number, shipping: number, discount: number, items: Item[]): CreateSessionRequest {
  return {
    orderReferenceId: ref,
    totalAmount: total,
    taxAmount: tax,
    shippingAmount: shipping,
    discountAmount: discount,
    currencyCode: 'SAR',
    countryCode: 'SA',
    description: 'Cart contract test',
    paymentType: 'pay_by_instalments',
    instalments: 4,
    items,
    consumer: { firstName: 'Noura', lastName: 'Al-Shammari', phoneNumber: '+966512349999', email: 'cart-shopper@qasimha.test' },
    shippingAddress: {
      firstName: 'Noura',
      lastName: 'Al-Shammari',
      line1: 'King Fahd Rd',
      line2: null,
      city: 'Riyadh',
      region: 'Riyadh',
      postalCode: '12345',
      countryCode: 'SA',
      phoneNumber: '+966512349999',
    },
    billingAddress: null,
    riskAssessment: null,
  };
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(6, 14);

describe.skipIf(!enabled)('live smoke test against QASIMHA_BASE_URL', () => {
  const items = [
    item('SKU-1', 'Wireless Headphones', 'physical', 1, 899.0),
    item('SKU-2', 'USB-C Cable', 'physical', 3, 45.0),
    item('SKU-3', 'Extended Warranty', 'digital', 1, 120.0),
  ];
  const referenceA = `SDK-${stamp}-A`;
  let client: Qasimha;
  let orderId: string;

  beforeAll(async () => {
    await installTestOnlyDispatcher();
    client = liveClient(apiKey as string);
  });

  it('A. creates a session for the three-line basket, or is declined with the order id', async () => {
    try {
      const session = await client.checkout.createSession(cart(referenceA, 1302.1, 173.1, 25.0, 50.0, items));
      expect(session.paymentUrl).toMatch(/^https:\/\//);
      expect(session.orderId).toMatch(/^[0-9a-f-]{36}$/);
      orderId = session.orderId;
    } catch (error) {
      expect(error).toBeInstanceOf(OrderDeclinedError);
      const declined = error as OrderDeclinedError;
      expect(declined.httpStatus).toBe(422);
      expect(declined.orderId).toMatch(/^[0-9a-f-]{36}$/);
      orderId = declined.orderId as string;
    }
  }, 60_000);

  it('B. reads the basket back on the order', async () => {
    const order = await client.orders.get(orderId);
    expect(order.id).toBe(orderId);
    expect(order.orderReferenceId).toBe(referenceA);
    expect(order.items).toHaveLength(3);
    const cable = order.items.find((i) => i.sku === 'SKU-2');
    expect(cable?.quantity).toBe(3);
    expect(order.items.some((i) => i.type === 'digital')).toBe(true);
    expect(['New', 'Approved', 'Declined', 'AwaitingCheckout']).toContain(order.status);
    expect(order.totalAmount).toBe(1302.1);
  }, 60_000);

  it('looks the order up by its reference and answers NotFoundError for an unknown one', async () => {
    const order = await client.orders.getByReference(referenceA);
    expect(order.id).toBe(orderId);
    expect(order.orderReferenceId).toBe(referenceA);
    expect(order.items).toHaveLength(3);
    expect(order.totalAmount).toBe(1302.1);
    await expect(client.orders.getByReference(`${referenceA}-missing`)).rejects.toBeInstanceOf(NotFoundError);
  }, 60_000);

  it('lists orders and finds the reference by search', async () => {
    const page = await client.orders.list({ search: referenceA, pageSize: 5 });
    expect(page.items.some((row) => row.id === orderId)).toBe(true);
    expect(page.pagination.page).toBe(1);
    const all = await client.orders.list();
    expect(all.pagination.totalItems).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('returns the dashboard counts', async () => {
    const counts = await client.orders.counts();
    for (const key of ['all', 'approved', 'authorised', 'captured', 'refunded', 'cancelled'] as const) {
      expect(typeof counts[key]).toBe('number');
    }
    expect(counts.all).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('C. refuses a basket that does not add up before sending', async () => {
    const error = await client.checkout
      .createSession(cart(`SDK-${stamp}-C`, 10.0, 0, 0, 0, [item('SKU-9', 'Laptop', 'physical', 1, 5000.0)]))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors[0]?.field).toBe('totalAmount');
  });

  it('F. answers the double-submit with the order already open', async () => {
    const error = await client.checkout.createSession(cart(referenceA, 1302.1, 173.1, 25.0, 50.0, items)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DuplicateOrderReferenceError);
    expect((error as DuplicateOrderReferenceError).httpStatus).toBe(409);
    expect((error as DuplicateOrderReferenceError).existingOrderId).toBe(orderId);
  }, 60_000);

  it('G. preserves an Arabic product name', async () => {
    const referenceG = `SDK-${stamp}-G`;
    let id: string;
    try {
      id = (await client.checkout.createSession(cart(referenceG, 250.0, 0, 0, 0, [item('SKU-AR', 'سماعات لاسلكية', 'physical', 1, 250.0)]))).orderId;
    } catch (error) {
      expect(error).toBeInstanceOf(OrderDeclinedError);
      id = (error as OrderDeclinedError).orderId as string;
    }
    const order = await client.orders.get(id);
    expect(order.items[0]?.name).toBe('سماعات لاسلكية');
    expect((await client.orders.getByReference(referenceG)).id).toBe(id);
  }, 60_000);
});

describe.skipIf(!plansEnabled)('live plan quotes with QASIMHA_PUBLISHABLE_KEY', () => {
  let client: Qasimha;

  beforeAll(async () => {
    await installTestOnlyDispatcher();
    client = liveClient(apiKey as string, publishableKey as string);
  });

  it('quotes three plans for 1200 and none for an amount below the minimum', async () => {
    const quote = await client.checkout.getPlans(1200);
    expect(quote.currency).toBe('SAR');
    expect(quote.merchantName).toBeTruthy();
    expect(quote.minAmount).toBe(100);
    expect(quote.maxAmount).toBeGreaterThanOrEqual(1200);
    expect(quote.plans).toHaveLength(3);
    expect(quote.plans.map((plan) => plan.instalments)).toEqual([2, 3, 4]);
    for (const plan of quote.plans) {
      expect(plan.frequency).toBe('monthly');
      expect(plan.instalmentAmount).toBeGreaterThan(0);
      expect(plan.firstInstalmentAmount).toBeGreaterThan(0);
      expect(plan.lastInstalmentAmount).toBeGreaterThan(0);
      expect(plan.feesIncludingVat).toBeGreaterThanOrEqual(0);
      expect(plan.totalPayable).toBeGreaterThanOrEqual(1200);
      expect(plan.shariaCompliant).toBe(true);
    }
    expect(quote.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const below = await client.checkout.getPlans(50, { lang: 'ar' });
    expect(below.minAmount).toBe(100);
    expect(below.plans).toEqual([]);
  }, 60_000);

  it('answers AuthenticationError for an unknown publishable key', async () => {
    const error = await client.checkout.getPlans(1200, { publishableKey: 'pk_test_unknown0000000000' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error).toMatchObject({ httpStatus: 401, code: 'INVALID_PUBLIC_KEY' });
  }, 60_000);
});

describe.skipIf(!webhooksEnabled)('live webhook endpoints round-trip with QASIMHA_WEBHOOKS_API_KEY', () => {
  let client: Qasimha;
  let endpointId: string | null = null;

  beforeAll(async () => {
    await installTestOnlyDispatcher();
    client = liveClient(webhooksApiKey as string);
    const leftovers = (await client.webhookEndpoints.list()).items.filter((e) => e.url?.endsWith('/qasimha-sdk-test'));
    for (const leftover of leftovers) await client.webhookEndpoints.delete(leftover.id);
  }, 60_000);

  afterAll(async () => {
    if (endpointId) await client.webhookEndpoints.delete(endpointId).catch(() => undefined);
  }, 60_000);

  it('create → get/list → ping → listDeliveries → replayDelivery → update → rotateSecret → delete', async () => {
    const description = `SDK smoke ${stamp}`;
    const created = await client.webhookEndpoints.create({ url: WEBHOOK_TEST_URL, description, events: ['order.confirmed', 'order.refunded'] });
    endpointId = created.id;
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(created.secretHint).toBe(created.secret.slice(-4));
    expect('secret' in created.raw).toBe(false);
    expect(created).toMatchObject({ url: WEBHOOK_TEST_URL, description, events: ['order.confirmed', 'order.refunded'], isActive: true, previousSecretExpiresAt: null });
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const fetched = await client.webhookEndpoints.get(created.id);
    expect(fetched).toMatchObject({ id: created.id, url: WEBHOOK_TEST_URL, secretHint: created.secretHint, isActive: true });
    expect('secret' in fetched.raw).toBe(false);
    const list = await client.webhookEndpoints.list();
    expect(list.items.some((e) => e.id === created.id)).toBe(true);

    const ping = await client.webhookEndpoints.ping(created.id);
    expect(ping.eventId).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(ping.endpointId).toBe(created.id);

    let deliveries = await client.webhookEndpoints.listDeliveries(created.id, { pageSize: 5 });
    for (let attempt = 0; attempt < 15 && deliveries.items.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      deliveries = await client.webhookEndpoints.listDeliveries(created.id, { pageSize: 5 });
    }
    expect(deliveries.items.length).toBeGreaterThanOrEqual(1);
    expect(deliveries.pagination.page).toBe(1);
    const delivery = deliveries.items[0]!;
    expect(delivery.eventType).toBe('ping');
    expect(['Pending', 'Succeeded', 'Failed']).toContain(delivery.status);
    expect(delivery.maxAttempts).toBeGreaterThan(0);
    const pending = await client.webhookEndpoints.listDeliveries(created.id, { status: 'Succeeded', pageSize: 5 });
    expect(pending.items.every((d) => d.status === 'Succeeded')).toBe(true);

    const replayed = await client.webhookEndpoints.replayDelivery(created.id, delivery.id);
    expect(replayed.id).not.toBe(delivery.id);
    expect(replayed.replayOfId).toBe(delivery.id);
    expect(replayed.eventType).toBe('ping');

    const updated = await client.webhookEndpoints.update(created.id, { isActive: false, description: `${description} (paused)` });
    expect(updated).toMatchObject({ id: created.id, isActive: false, description: `${description} (paused)`, events: ['order.confirmed', 'order.refunded'] });
    expect(updated.updatedAt).not.toBeNull();

    const rotated = await client.webhookEndpoints.rotateSecret(created.id);
    expect(rotated.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.secretHint).toBe(rotated.secret.slice(-4));
    expect(rotated.previousSecretExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect('secret' in rotated.raw).toBe(false);
    expect((await client.webhookEndpoints.get(created.id)).secretHint).toBe(rotated.secretHint);

    await client.webhookEndpoints.delete(created.id);
    endpointId = null;
    await expect(client.webhookEndpoints.get(created.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await client.webhookEndpoints.list()).items.some((e) => e.id === created.id)).toBe(false);
  }, 120_000);

  it('refuses a plain-http URL locally and an over-long URL on the API', async () => {
    await expect(client.webhookEndpoints.create({ url: 'http://example.com/qasimha-sdk-test' })).rejects.toBeInstanceOf(ValidationError);
    const tooLong = `https://example.com/${'x'.repeat(1100)}/qasimha-sdk-test`;
    const error = await client.webhookEndpoints.create({ url: tooLong }).catch((e: unknown) => e);
    if (!(error instanceof Error) && error !== null && typeof error === 'object' && 'id' in error) {
      await client.webhookEndpoints.delete(String((error as { id: unknown }).id));
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ httpStatus: 400, code: 'URL_TOO_LONG' });
  }, 60_000);
});
