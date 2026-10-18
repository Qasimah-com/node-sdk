import type { Environment, Language } from '../client.js';
import { ConfigurationError, OrderDeclinedError } from '../errors.js';
import { dataRecord, type RawResponse, type RequestOptions, type Transport } from '../http.js';
import { checkPublishableKey } from '../keys.js';
import type { Logger } from '../logger.js';
import { mapPlans, requiredId, str, type Raw } from '../mappers.js';
import type {
  CreatePosSessionRequest,
  CreateQrSessionRequest,
  CreateSessionRequest,
  GetPlansOptions,
  Plans,
  PosSession,
  QrSession,
  Session,
} from '../models.js';
import { FieldErrors, isRecord } from '../validation.js';
import {
  buildAddress,
  buildConsumer,
  buildItems,
  buildMerchantUrl,
  buildRiskAssessment,
  checkBasket,
} from './baskets.js';

export const PAYMENT_TYPES = ['pay_by_instalments', 'pay_now', 'pay_next_month', 'pay_in_full'] as const;

const LANGUAGES = ['ar', 'en'] as const;

export interface CheckoutSettings {
  secretKeyEnvironment: Environment;
  language: Language;
  publishableKey: string | null;
}

function input(request: unknown): Raw {
  return isRecord(request) ? request : {};
}

export function buildSessionBody(request: CreateSessionRequest): Record<string, unknown> {
  const errors = new FieldErrors();
  const r = input(request);
  const orderReferenceId = errors.requiredString('orderReferenceId', r['orderReferenceId'], 255);
  const totalAmount = errors.amount('totalAmount', r['totalAmount'], { required: true });
  const taxAmount = errors.amount('taxAmount', r['taxAmount'], { defaultValue: 0 });
  const shippingAmount = errors.amount('shippingAmount', r['shippingAmount'], { defaultValue: 0 });
  const discountAmount = errors.amount('discountAmount', r['discountAmount'], { defaultValue: 0 });
  const currencyCode = errors.optionalString('currencyCode', r['currencyCode']) ?? 'SAR';
  const countryCode = errors.optionalString('countryCode', r['countryCode']) ?? 'SA';
  const description = errors.optionalString('description', r['description']);
  const paymentType = errors.oneOf('paymentType', r['paymentType'], PAYMENT_TYPES, {
    defaultValue: 'pay_by_instalments',
  });
  const instalments = errors.integer('instalments', r['instalments'], { min: 1, defaultValue: 4 });
  const built = buildItems(errors, r['items']);
  const consumer = buildConsumer(errors, r['consumer'], { emailRequired: false });
  const shippingAddress = buildAddress(errors, 'shippingAddress', r['shippingAddress'], true);
  const billingAddress = buildAddress(errors, 'billingAddress', r['billingAddress'], false);
  const riskAssessment = buildRiskAssessment(errors, r['riskAssessment']);
  const merchantUrl = buildMerchantUrl(errors, r['merchantUrl']);
  checkBasket(errors, { totalAmount, taxAmount, shippingAmount, discountAmount }, built);
  errors.throwIfAny();

  return {
    orderReferenceId,
    totalAmount,
    taxAmount,
    shippingAmount,
    discountAmount,
    currencyCode,
    countryCode,
    description: description ?? null,
    paymentType,
    instalments,
    items: built.items,
    consumer,
    shippingAddress,
    billingAddress: billingAddress ?? null,
    riskAssessment,
    merchantUrl,
  };
}

export function buildPosSessionBody(request: CreatePosSessionRequest): Record<string, unknown> {
  const errors = new FieldErrors();
  const r = input(request);
  const orderReferenceId = errors.requiredString('orderReferenceId', r['orderReferenceId'], 255);
  const totalAmount = errors.amount('totalAmount', r['totalAmount'], { required: true });
  const currencyCode = errors.optionalString('currencyCode', r['currencyCode']) ?? 'SAR';
  const countryCode = errors.optionalString('countryCode', r['countryCode']) ?? 'SA';
  const built = buildItems(errors, r['items']);
  const consumer = buildConsumer(errors, r['consumer'], { emailRequired: true });
  const merchantUrl = buildMerchantUrl(errors, r['merchantUrl']);
  checkBasket(errors, { totalAmount, taxAmount: 0, shippingAmount: 0, discountAmount: 0 }, built);
  errors.throwIfAny();
  return { orderReferenceId, totalAmount, currencyCode, countryCode, items: built.items, consumer, merchantUrl };
}

export function buildQrSessionBody(request: CreateQrSessionRequest): Record<string, unknown> {
  const errors = new FieldErrors();
  const r = input(request);
  const orderReferenceId = errors.requiredString('orderReferenceId', r['orderReferenceId'], 255);
  const totalAmount = errors.amount('totalAmount', r['totalAmount'], { required: true });
  const currencyCode = errors.optionalString('currencyCode', r['currencyCode']) ?? 'SAR';
  const countryCode = errors.optionalString('countryCode', r['countryCode']) ?? 'SA';
  const built = buildItems(errors, r['items']);
  const merchantUrl = buildMerchantUrl(errors, r['merchantUrl']);
  checkBasket(errors, { totalAmount, taxAmount: 0, shippingAmount: 0, discountAmount: 0 }, built);
  errors.throwIfAny();
  return { orderReferenceId, totalAmount, currencyCode, countryCode, items: built.items, merchantUrl };
}

export class CheckoutResource {
  private readonly transport: Transport;
  private readonly logger: Logger | null;
  private readonly settings: CheckoutSettings;

  constructor(transport: Transport, logger: Logger | null, settings: CheckoutSettings) {
    this.transport = transport;
    this.logger = logger;
    this.settings = settings;
  }

  async getPlans(amount: number, options: GetPlansOptions = {}): Promise<Plans> {
    const o = input(options);
    const publishableKey =
      o['publishableKey'] === undefined
        ? this.settings.publishableKey
        : checkPublishableKey(o['publishableKey'], this.settings.secretKeyEnvironment);
    if (publishableKey === null) {
      throw new ConfigurationError(
        'checkout.getPlans needs a publishable key (pk_test_… or pk_live_…): set publishableKey on the client or pass { publishableKey } per call',
      );
    }
    const errors = new FieldErrors();
    const value = errors.amount('amount', amount, { required: true });
    if (value !== null && value <= 0) errors.add('amount', 'must be greater than zero');
    const lang = errors.oneOf('lang', o['lang'], LANGUAGES) ?? this.settings.language;
    errors.throwIfAny();

    const raw = await this.transport.request({
      method: 'GET',
      path: '/widget/plans',
      query: { amount: value, currency: 'SAR', lang },
      publicKey: publishableKey,
    });
    return mapPlans(dataRecord(raw), raw);
  }

  async createSession(request: CreateSessionRequest, options: RequestOptions = {}): Promise<Session> {
    const body = buildSessionBody(request);
    const raw = await this.transport.send({
      method: 'POST',
      path: '/pay/session/create',
      body,
      idempotencyKey: options.idempotencyKey,
    });
    const data = this.settle(raw, '/pay/session/create');
    return {
      orderId: requiredId(data, raw, 'checkout.createSession'),
      paymentUrl: str(data, 'paymentUrl'),
      providerSessionId: str(data, 'providerSessionId'),
      status: str(data, 'status'),
      raw: data,
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async createPosSession(request: CreatePosSessionRequest, options: RequestOptions = {}): Promise<PosSession> {
    const body = buildPosSessionBody(request);
    const raw = await this.transport.send({
      method: 'POST',
      path: '/pay/pos/create',
      body,
      idempotencyKey: options.idempotencyKey,
    });
    const data = this.settle(raw, '/pay/pos/create');
    return {
      orderId: requiredId(data, raw, 'checkout.createPosSession'),
      checkoutUrl: str(data, 'checkoutUrl'),
      providerSessionId: str(data, 'providerSessionId'),
      status: str(data, 'status'),
      raw: data,
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async createQrSession(request: CreateQrSessionRequest, options: RequestOptions = {}): Promise<QrSession> {
    const body = buildQrSessionBody(request);
    const raw = await this.transport.send({
      method: 'POST',
      path: '/pay/qr/create',
      body,
      idempotencyKey: options.idempotencyKey,
    });
    const data = this.settle(raw, '/pay/qr/create');
    if ((str(data, 'status') ?? '').toLowerCase() === 'declined') {
      throw new OrderDeclinedError(raw.envelope?.message || 'The order was declined', {
        code: 'ORDER_DECLINED',
        httpStatus: raw.status,
        requestId: raw.requestId,
        raw: raw.envelope,
        orderId: str(data, 'installmentId'),
      });
    }
    return {
      orderId: requiredId(data, raw, 'checkout.createQrSession'),
      qrCodeUrl: str(data, 'qrCodeUrl'),
      providerSessionId: str(data, 'providerSessionId'),
      status: str(data, 'status'),
      raw: data,
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  private settle(raw: RawResponse, path: string): Raw {
    if (raw.status === 409 && raw.envelope?.code === 'DUPLICATE_ORDER_REFERENCE' && raw.attempt > 1) {
      const data = dataRecord(raw);
      if (str(data, 'installmentId') !== null) {
        this.logger?.('info', 'duplicate order reference on a retry: the earlier attempt had succeeded', {
          method: 'POST',
          path: `/api/v1${path}`,
          status: raw.status,
          requestId: raw.requestId,
          attempt: raw.attempt,
          code: raw.envelope.code,
        });
        return data;
      }
    }
    this.transport.throwIfError(raw);
    return dataRecord(raw);
  }
}
