import { ValidationError, type FieldError } from './errors.js';
import { canonicalAmount, isTwoDecimalAmount } from './money.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

export class FieldErrors {
  readonly list: FieldError[] = [];

  add(field: string, message: string): void {
    this.list.push({ field, message });
  }

  get any(): boolean {
    return this.list.length > 0;
  }

  throwIfAny(): void {
    if (!this.any) return;
    const summary = this.list.map((e) => `${e.field}: ${e.message}`).join('; ');
    throw new ValidationError(`Request refused before sending: ${summary}`, {
      code: 'VALIDATION_ERROR',
      errors: this.list,
    });
  }

  requiredString(field: string, value: unknown, maxLength?: number): string | null {
    if (isAbsent(value) || (typeof value === 'string' && value.trim() === '')) {
      this.add(field, 'is required');
      return null;
    }
    if (typeof value !== 'string') {
      this.add(field, 'must be a string');
      return null;
    }
    if (maxLength !== undefined && value.length > maxLength) {
      this.add(field, `must be at most ${maxLength} characters`);
      return null;
    }
    return value;
  }

  optionalString(field: string, value: unknown): string | undefined {
    if (isAbsent(value)) return undefined;
    if (typeof value !== 'string') {
      this.add(field, 'must be a string');
      return undefined;
    }
    return value;
  }

  amount(field: string, value: unknown, options: { required?: boolean; defaultValue?: number } = {}): number | null {
    if (isAbsent(value)) {
      if (options.defaultValue !== undefined) return options.defaultValue;
      if (options.required) this.add(field, 'is required');
      return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.add(field, 'must be a finite number');
      return null;
    }
    if (value < 0) {
      this.add(field, 'must not be negative');
      return null;
    }
    if (!isTwoDecimalAmount(value)) {
      this.add(field, 'must have at most two decimal places');
      return null;
    }
    return canonicalAmount(value);
  }

  integer(field: string, value: unknown, options: { min?: number; required?: boolean; defaultValue?: number } = {}): number | null {
    if (isAbsent(value)) {
      if (options.defaultValue !== undefined) return options.defaultValue;
      if (options.required) this.add(field, 'is required');
      return null;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.add(field, 'must be an integer');
      return null;
    }
    if (options.min !== undefined && value < options.min) {
      this.add(field, `must be at least ${options.min}`);
      return null;
    }
    return value;
  }

  oneOf<T extends string>(field: string, value: unknown, allowed: readonly T[], options: { required?: boolean; defaultValue?: T } = {}): T | null {
    if (isAbsent(value)) {
      if (options.defaultValue !== undefined) return options.defaultValue;
      if (options.required) this.add(field, 'is required');
      return null;
    }
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.add(field, `must be one of ${allowed.join(', ')}`);
      return null;
    }
    return value as T;
  }

  boolean(field: string, value: unknown): boolean | undefined {
    if (isAbsent(value)) return undefined;
    if (typeof value !== 'boolean') {
      this.add(field, 'must be a boolean');
      return undefined;
    }
    return value;
  }

  requiredObject(field: string, value: unknown): Record<string, unknown> | null {
    if (isAbsent(value)) {
      this.add(field, 'is required');
      return null;
    }
    if (!isRecord(value)) {
      this.add(field, 'must be an object');
      return null;
    }
    return value;
  }

  optionalObject(field: string, value: unknown): Record<string, unknown> | undefined {
    if (isAbsent(value)) return undefined;
    if (!isRecord(value)) {
      this.add(field, 'must be an object');
      return undefined;
    }
    return value;
  }

  nonEmptyArray(field: string, value: unknown): unknown[] | null {
    if (!Array.isArray(value) || value.length === 0) {
      this.add(field, 'must contain at least one entry');
      return null;
    }
    return value;
  }
}

export const NATIONAL_ID_PATTERN = /^[12]\d{9}$/;
