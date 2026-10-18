export interface FieldError {
  field: string | null;
  message: string | null;
}

export type WebhookFailureReason =
  | 'missing_header'
  | 'malformed_header'
  | 'timestamp_outside_tolerance'
  | 'signature_mismatch';

export interface QasimhaErrorInit {
  code?: string | null;
  httpStatus?: number | null;
  requestId?: string | null;
  errors?: FieldError[] | null;
  raw?: unknown;
  cause?: unknown;
}

export class QasimhaError extends Error {
  override readonly name: string = 'QasimhaError';
  readonly code: string | null;
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly errors: FieldError[];
  readonly raw: unknown;

  constructor(message: string, init: QasimhaErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = init.code ?? null;
    this.httpStatus = init.httpStatus ?? null;
    this.requestId = init.requestId ?? null;
    this.errors = init.errors ?? [];
    this.raw = init.raw;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      requestId: this.requestId,
      errors: this.errors,
    };
  }
}

export class ConfigurationError extends QasimhaError {
  override readonly name = 'ConfigurationError';
}

export class ValidationError extends QasimhaError {
  override readonly name = 'ValidationError';
}

export class AuthenticationError extends QasimhaError {
  override readonly name = 'AuthenticationError';
}

export class PermissionError extends QasimhaError {
  override readonly name = 'PermissionError';
}

export class NotFoundError extends QasimhaError {
  override readonly name = 'NotFoundError';
}

export class ConflictError extends QasimhaError {
  override readonly name: string = 'ConflictError';
}

export interface DuplicateOrderReferenceErrorInit extends QasimhaErrorInit {
  existingOrderId: string | null;
  existingPaymentUrl: string | null;
}

export class DuplicateOrderReferenceError extends ConflictError {
  override readonly name = 'DuplicateOrderReferenceError';
  readonly existingOrderId: string | null;
  readonly existingPaymentUrl: string | null;

  constructor(message: string, init: DuplicateOrderReferenceErrorInit) {
    super(message, init);
    this.existingOrderId = init.existingOrderId;
    this.existingPaymentUrl = init.existingPaymentUrl;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), existingOrderId: this.existingOrderId, existingPaymentUrl: this.existingPaymentUrl };
  }
}

export interface OrderDeclinedErrorInit extends QasimhaErrorInit {
  orderId: string | null;
}

export class OrderDeclinedError extends QasimhaError {
  override readonly name = 'OrderDeclinedError';
  readonly orderId: string | null;

  constructor(message: string, init: OrderDeclinedErrorInit) {
    super(message, init);
    this.orderId = init.orderId;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), orderId: this.orderId };
  }
}

export interface RateLimitErrorInit extends QasimhaErrorInit {
  retryAfter: number | null;
}

export class RateLimitError extends QasimhaError {
  override readonly name = 'RateLimitError';
  readonly retryAfter: number | null;

  constructor(message: string, init: RateLimitErrorInit) {
    super(message, init);
    this.retryAfter = init.retryAfter;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), retryAfter: this.retryAfter };
  }
}

export class ApiError extends QasimhaError {
  override readonly name: string = 'ApiError';
}

export class ServerError extends ApiError {
  override readonly name = 'ServerError';
}

export class ConnectionError extends QasimhaError {
  override readonly name = 'ConnectionError';
}

export class WebhookSignatureError extends QasimhaError {
  override readonly name = 'WebhookSignatureError';
  readonly reason: WebhookFailureReason;

  constructor(message: string, reason: WebhookFailureReason) {
    super(message, { code: reason });
    this.reason = reason;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), reason: this.reason };
  }
}
