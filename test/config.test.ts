import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import Qasimha, { Client, ConfigurationError, ENVIRONMENT_BASE_URLS, VERSION, maskApiKey } from '../src/index.js';

const LIVE_KEY = 'sk_live_9f8e7d6c5b4aAbCd';
const PUBLISHABLE_TEST_KEY = 'pk_test_9f8e7d6c5b4aAbCd';
const PUBLISHABLE_LIVE_KEY = 'pk_live_1a2b3c4d5e6fWxYz';

describe('client construction', () => {
  it('refuses a missing or malformed API key', () => {
    expect(() => new Qasimha({} as never)).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: '' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'pk_test_abc' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_prod_abc' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc-def' })).toThrow(ConfigurationError);
    expect(() => new Qasimha(undefined as never)).toThrow(ConfigurationError);
  });

  it('infers the environment and base URL from the key prefix', () => {
    const sandbox = new Qasimha({ apiKey: 'sk_test_abc' });
    expect(sandbox.environment).toBe('sandbox');
    expect(sandbox.baseUrl).toBe('https://api-uat.qasimha.com');

    const production = new Qasimha({ apiKey: LIVE_KEY });
    expect(production.environment).toBe('production');
    expect(production.baseUrl).toBe('https://api.qasimha.com');
    expect(ENVIRONMENT_BASE_URLS).toEqual({
      production: 'https://api.qasimha.com',
      sandbox: 'https://api-uat.qasimha.com',
    });
  });

  it('rejects an environment that contradicts the key prefix', () => {
    expect(() => new Qasimha({ apiKey: LIVE_KEY, environment: 'sandbox' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', environment: 'production' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', environment: 'staging' as never })).toThrow(ConfigurationError);
    expect(new Qasimha({ apiKey: 'sk_test_abc', environment: 'sandbox' }).environment).toBe('sandbox');
  });

  it('lets a baseUrl override skip the prefix check but still requires TLS', () => {
    const client = new Qasimha({ apiKey: 'sk_test_abc', environment: 'production', baseUrl: 'https://example.com/' });
    expect(client.baseUrl).toBe('https://example.com');
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', baseUrl: 'http://example.com' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', baseUrl: 'not a url' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', baseUrl: 'https://example.com/?x=1' })).toThrow(ConfigurationError);
    expect(new Qasimha({ apiKey: 'sk_test_abc', baseUrl: 'http://localhost:4300' }).baseUrl).toBe('http://localhost:4300');
    expect(new Qasimha({ apiKey: 'sk_test_abc', baseUrl: 'http://127.0.0.1:4300/' }).baseUrl).toBe('http://127.0.0.1:4300');
  });

  it('validates timeout, maxRetries, language, suffix and logger', () => {
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', timeout: 0 })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', timeout: -5 })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', timeout: Number.NaN })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', maxRetries: -1 })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', maxRetries: 6 })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', maxRetries: 1.5 })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', language: 'fr' as never })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', userAgentSuffix: 'bad\nsuffix' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', logger: 'nope' as never })).toThrow(ConfigurationError);
    const client = new Qasimha({ apiKey: 'sk_test_abc', maxRetries: 5, timeout: 1, language: 'ar' });
    expect(client.maxRetries).toBe(5);
    expect(client.timeout).toBe(1);
    expect(client.language).toBe('ar');
  });

  it('accepts a publishable key only from the secret key environment', () => {
    expect(new Qasimha({ apiKey: 'sk_test_abc', publishableKey: PUBLISHABLE_TEST_KEY }).maskedPublishableKey()).toBe('pk_test_…AbCd');
    expect(new Qasimha({ apiKey: LIVE_KEY, publishableKey: PUBLISHABLE_LIVE_KEY }).maskedPublishableKey()).toBe('pk_live_…WxYz');
    expect(new Qasimha({ apiKey: 'sk_test_abc' }).maskedPublishableKey()).toBeNull();
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', publishableKey: PUBLISHABLE_LIVE_KEY })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: LIVE_KEY, publishableKey: PUBLISHABLE_TEST_KEY })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', publishableKey: '' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', publishableKey: 'sk_test_abc' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', publishableKey: 'pk_prod_abc' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', publishableKey: 'pk_test_abc-def' })).toThrow(ConfigurationError);
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', publishableKey: 123 as never })).toThrow(ConfigurationError);
    const overridden = new Qasimha({ apiKey: 'sk_test_abc', environment: 'production', baseUrl: 'https://example.com', publishableKey: PUBLISHABLE_TEST_KEY });
    expect(overridden.maskedPublishableKey()).toBe('pk_test_…AbCd');
    expect(() => new Qasimha({ apiKey: 'sk_test_abc', environment: 'production', baseUrl: 'https://example.com', publishableKey: PUBLISHABLE_LIVE_KEY })).toThrow(ConfigurationError);
  });

  it('applies the documented defaults', () => {
    const client = new Qasimha({ apiKey: 'sk_test_abc' });
    expect(client.timeout).toBe(30_000);
    expect(client.maxRetries).toBe(2);
    expect(client.language).toBe('en');
  });

  it('exposes the same class as the default export and as Client', () => {
    expect(Client).toBe(Qasimha);
    expect(new Client({ apiKey: 'sk_test_abc' })).toBeInstanceOf(Qasimha);
  });
});

describe('key masking', () => {
  it('masks to prefix plus the last four characters', () => {
    expect(maskApiKey(LIVE_KEY)).toBe('sk_live_…AbCd');
    expect(new Qasimha({ apiKey: LIVE_KEY }).maskedKey()).toBe('sk_live_…AbCd');
    expect(new Qasimha({ apiKey: 'sk_test_ABCDEF' }).maskedKey()).toBe('sk_test_…CDEF');
    expect(maskApiKey(PUBLISHABLE_TEST_KEY)).toBe('pk_test_…AbCd');
    expect(maskApiKey(PUBLISHABLE_LIVE_KEY)).toBe('pk_live_…WxYz');
  });

  it('never leaks the key through JSON, inspect or string conversion', () => {
    const client = new Qasimha({ apiKey: LIVE_KEY, publishableKey: PUBLISHABLE_LIVE_KEY });
    const rendered = [JSON.stringify(client), inspect(client), String(client), `${client}`, inspect(client, { showHidden: true, depth: 10 })];
    for (const text of rendered) {
      expect(text).not.toContain(LIVE_KEY);
      expect(text).not.toContain(PUBLISHABLE_LIVE_KEY);
      expect(text).toContain('sk_live_…AbCd');
    }
    expect(JSON.stringify(client)).toContain('pk_live_…WxYz');
    expect(Object.keys(client)).not.toContain('apiKey');
    expect(Object.keys(client)).not.toContain('publishableKey');
    const mismatch = (() => {
      try {
        new Qasimha({ apiKey: 'sk_test_abc', publishableKey: PUBLISHABLE_LIVE_KEY });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(mismatch).not.toContain(PUBLISHABLE_LIVE_KEY);
    expect(mismatch).toContain('pk_live_…WxYz');
  });
});

describe('version', () => {
  it('matches the package manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });

  it('is carried by the User-Agent', () => {
    const client = new Qasimha({ apiKey: 'sk_test_abc', userAgentSuffix: 'woocommerce/1.2.0' });
    expect(client.userAgent).toMatch(new RegExp(`^qasimha-sdk-node/${VERSION.replace(/\./g, '\\.')} \\(node/\\d+\\.\\d+\\.\\d+; [a-z0-9]+\\) woocommerce/1\\.2\\.0$`));
  });
});
