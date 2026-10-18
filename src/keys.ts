import type { Environment } from './client.js';
import { ConfigurationError } from './errors.js';

export const API_KEY_PATTERN = /^sk_(test|live)_[A-Za-z0-9]+$/;
export const PUBLISHABLE_KEY_PATTERN = /^pk_(test|live)_[A-Za-z0-9]+$/;

export function keyEnvironment(key: string): Environment {
  return /^[sp]k_live_/.test(key) ? 'production' : 'sandbox';
}

export function maskApiKey(apiKey: string): string {
  const prefix = /^([sp]k_(?:test|live)_)/.exec(apiKey)?.[1] ?? '';
  return `${prefix}…${apiKey.slice(-4)}`;
}

export function checkPublishableKey(value: unknown, secretKeyEnvironment: Environment): string {
  if (typeof value !== 'string' || !PUBLISHABLE_KEY_PATTERN.test(value)) {
    throw new ConfigurationError('publishableKey must look like pk_test_… or pk_live_…');
  }
  if (keyEnvironment(value) !== secretKeyEnvironment) {
    const expected = secretKeyEnvironment === 'production' ? 'pk_live_' : 'pk_test_';
    throw new ConfigurationError(`publishableKey ${maskApiKey(value)} does not belong to the apiKey's environment (expected ${expected}…)`);
  }
  return value;
}
