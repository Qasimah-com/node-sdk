import { inspect } from 'node:util';
import { ConfigurationError } from './errors.js';
import { Transport } from './http.js';
import { API_KEY_PATTERN, checkPublishableKey, maskApiKey } from './keys.js';
import type { Logger } from './logger.js';
import { CheckoutResource } from './resources/checkout.js';
import { CheckoutLinksResource } from './resources/checkoutLinks.js';
import { OrdersResource } from './resources/orders.js';
import { SettlementsResource } from './resources/settlements.js';
import { WebhookEndpointsResource } from './resources/webhookEndpoints.js';
import { WebhooksResource } from './resources/webhooks.js';
import { isRecord } from './validation.js';
import { VERSION } from './version.js';

export type Environment = 'sandbox' | 'production';

export type Language = 'ar' | 'en';

export const ENVIRONMENT_BASE_URLS: Readonly<Record<Environment, string>> = Object.freeze({
  production: 'https://api.qasimha.com',
  sandbox: 'https://merchant-api-uat.qasimha.com',
});

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RETRIES_LIMIT = 5;

const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

export { maskApiKey };

export interface QasimhaOptions {
  apiKey: string;
  environment?: Environment;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  webhookSecret?: string;
  publishableKey?: string;
  language?: Language;
  userAgentSuffix?: string;
  logger?: Logger;
  /** @internal */
  sleep?: (ms: number) => Promise<void>;
  /** @internal */
  random?: () => number;
}

export function buildUserAgent(suffix: string | undefined): string {
  const base = `qasimha-sdk-node/${VERSION} (node/${process.versions.node}; ${process.platform})`;
  return suffix ? `${base} ${suffix}` : base;
}

function normaliseBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError('baseUrl must be an absolute https:// URL');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError('baseUrl must be an absolute https:// URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new ConfigurationError('baseUrl must use https:// (http:// is accepted only for localhost and 127.0.0.1)');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new ConfigurationError('baseUrl must not carry a query string or fragment');
  }
  return url.href.replace(/\/+$/, '');
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Qasimha {
  readonly environment: Environment;
  readonly baseUrl: string;
  readonly language: Language;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly userAgent: string;
  readonly checkout: CheckoutResource;
  readonly checkoutLinks: CheckoutLinksResource;
  readonly orders: OrdersResource;
  readonly settlements: SettlementsResource;
  readonly webhooks: WebhooksResource;
  readonly webhookEndpoints: WebhookEndpointsResource;
  readonly #apiKey: string;
  readonly #publishableKey: string | null;

  constructor(options: QasimhaOptions) {
    if (!isRecord(options)) throw new ConfigurationError('Client options are required');

    const apiKey = options['apiKey'];
    if (typeof apiKey !== 'string' || !API_KEY_PATTERN.test(apiKey)) {
      throw new ConfigurationError('apiKey is required and must look like sk_test_… or sk_live_…');
    }
    const inferred: Environment = apiKey.startsWith('sk_live_') ? 'production' : 'sandbox';

    const environment = options['environment'];
    if (environment !== undefined) {
      if (environment !== 'sandbox' && environment !== 'production') {
        throw new ConfigurationError('environment must be "sandbox" or "production"');
      }
      if (options['baseUrl'] === undefined && environment !== inferred) {
        const prefix = inferred === 'production' ? 'sk_live_' : 'sk_test_';
        throw new ConfigurationError(`environment "${environment}" contradicts the ${prefix} key prefix`);
      }
    }

    const publishableKey = options['publishableKey'] === undefined ? null : checkPublishableKey(options['publishableKey'], inferred);

    const timeout = options['timeout'] ?? DEFAULT_TIMEOUT_MS;
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
      throw new ConfigurationError('timeout must be a positive number of milliseconds');
    }

    const maxRetries = options['maxRetries'] ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_RETRIES_LIMIT) {
      throw new ConfigurationError(`maxRetries must be an integer between 0 and ${MAX_RETRIES_LIMIT}`);
    }

    const language = options['language'] ?? 'en';
    if (language !== 'ar' && language !== 'en') {
      throw new ConfigurationError('language must be "ar" or "en"');
    }

    const suffix = options['userAgentSuffix'];
    if (suffix !== undefined && (typeof suffix !== 'string' || !PRINTABLE_ASCII.test(suffix))) {
      throw new ConfigurationError('userAgentSuffix must be a printable ASCII string');
    }

    const logger = options['logger'];
    if (logger !== undefined && typeof logger !== 'function') {
      throw new ConfigurationError('logger must be a function');
    }

    const webhookSecret = options['webhookSecret'];
    if (webhookSecret !== undefined && typeof webhookSecret !== 'string') {
      throw new ConfigurationError('webhookSecret must be a string');
    }

    this.#apiKey = apiKey;
    this.#publishableKey = publishableKey;
    this.environment = environment ?? inferred;
    this.baseUrl = options['baseUrl'] === undefined ? ENVIRONMENT_BASE_URLS[this.environment] : normaliseBaseUrl(options['baseUrl']);
    this.language = language;
    this.timeout = timeout;
    this.maxRetries = maxRetries;
    this.userAgent = buildUserAgent(suffix);

    const transport = new Transport({
      apiKey,
      baseUrl: this.baseUrl,
      timeout,
      maxRetries,
      language,
      userAgent: this.userAgent,
      logger: logger ?? null,
      sleep: options['sleep'] ?? defaultSleep,
      random: options['random'] ?? Math.random,
    });

    this.checkout = new CheckoutResource(transport, logger ?? null, { secretKeyEnvironment: inferred, language, publishableKey });
    this.checkoutLinks = new CheckoutLinksResource(transport);
    this.orders = new OrdersResource(transport);
    this.settlements = new SettlementsResource(transport);
    this.webhooks = new WebhooksResource(webhookSecret ?? null);
    this.webhookEndpoints = new WebhookEndpointsResource(transport);
  }

  maskedKey(): string {
    return maskApiKey(this.#apiKey);
  }

  maskedPublishableKey(): string | null {
    return this.#publishableKey === null ? null : maskApiKey(this.#publishableKey);
  }

  toJSON(): { environment: Environment; baseUrl: string; apiKey: string; publishableKey: string | null } {
    return {
      environment: this.environment,
      baseUrl: this.baseUrl,
      apiKey: this.maskedKey(),
      publishableKey: this.maskedPublishableKey(),
    };
  }

  toString(): string {
    return `Qasimha(${this.environment}, ${this.baseUrl}, ${this.maskedKey()})`;
  }

  [inspect.custom](): string {
    return this.toString();
  }
}
