# Changelog

All notable changes to `@qasimha/sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `checkout.getPlans(amount, { lang?, publishableKey? })` — `GET /widget/plans`, the plan quote
  the widget shows for an amount, returned as `Plans { merchantName, currency, minAmount,
  maxAmount, plans: Plan[] }`; an empty `plans` list is returned, not thrown. The request carries
  the publishable key as `X-Public-Key` and no `X-Api-Key`, and retries like every `GET`.
- `publishableKey` client option (`pk_test_…` / `pk_live_…`), validated at construction against
  the secret key's environment; `getPlans` may also take the key per call. `maskApiKey` masks a
  publishable key the same way and `maskedPublishableKey()` exposes it for your own logs.
- `orders.getByReference(orderReferenceId)` — `GET /merchant/orders/by-reference/{orderReferenceId}`,
  the same `Order` as `orders.get`; each segment of the reference is percent-encoded and `/` is
  kept as the separator.
- `webhookEndpoints` resource for per-merchant webhook endpoints (scope `webhooks:manage`):
  `create`, `list`, `get`, `update`, `delete`, `rotateSecret`, `ping`, `listDeliveries` and
  `replayDelivery`, with the `WebhookEndpoint`, `WebhookEndpointWithSecret`, `WebhookDelivery` and
  `WebhookPingResult` models. `url` must be `https://` and `events` must be known event names
  (`WEBHOOK_EVENT_TYPES`) before a request is sent. The signing secret is carried once on the
  `create` / `rotateSecret` result, never in `raw` and never in a log.
- `WEBHOOK_DELIVERY_STATUS_NAMES` and `normaliseWebhookDeliveryStatus` for delivery statuses.

### Changed

- `PUT` and `DELETE` requests carry an `Idempotency-Key` and retry like `POST`.
- README: the return URLs, per-merchant webhook secrets and the `t=…,v1=…` signature format are
  documented as available since the merchant API release of 2026-09-25.
- Unit tests follow the re-recorded order fixtures (typed responses, enum names, no decision
  internals).

## [0.1.0] - 2026-09-25

### Added

- `Qasimha` client with `checkout`, `checkoutLinks`, `orders`, `settlements` and `webhooks`
  resources against the merchant API v1, for Node.js 18 and later, shipped as ESM and CommonJS
  with TypeScript declarations and no runtime dependencies.
- `merchantUrl` return URLs on all four create calls, validated locally to the return-URL contract
  (absolute, at most 1024 characters, no fragment, `https` / local `http` / custom app scheme,
  `notification` reserved).
- Environment inference from the key prefix (`sk_test_` → sandbox, `sk_live_` → production),
  with a TLS-only `baseUrl` override for test servers.
- Request conventions: `X-Api-Key`, `Accept-Language`, versioned `User-Agent`, a UUID v4
  `Idempotency-Key` on every `POST` and a UUID v4 `X-Correlation-Id` per logical call; results
  expose `requestId` and `replayed`.
- Retries on connection failures, `429`, `502`, `503`, `504` and `409 REQUEST_IN_PROGRESS` with
  exponential backoff, jitter and `Retry-After` support; a duplicate-reference `409` on a retry of
  the same create call is returned as the session that had already been created.
- Client-side basket validation to the halala: line identity, basket identity, quantities,
  two-decimal amounts, payment types, national id format and required fields, reported as one
  `ValidationError` naming every failing field.
- Typed error model: `ValidationError`, `AuthenticationError`, `PermissionError`,
  `NotFoundError`, `ConflictError`, `DuplicateOrderReferenceError`, `OrderDeclinedError`,
  `RateLimitError`, `ApiError`, `ServerError`, `ConnectionError`, `ConfigurationError` and
  `WebhookSignatureError`, all extending `QasimhaError`.
- Curated `Order` model with enum names for integer-encoded statuses, channels and payment types,
  keeping the untyped envelope reachable through `raw`.
- Webhook verification for both signature formats (`sha256=` and `t=…,v1=…` with secret
  rotation), constant-time comparison, replay tolerance and `constructEvent`.
- Optional logger callback that never receives the API key, the webhook secret, request bodies or
  consumer data.
