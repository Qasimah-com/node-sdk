# @qasimha/sdk

The Node.js server SDK for the Qasimha merchant API: quote instalment plans for an amount, create
instalment checkouts, follow orders through capture, fulfilment and refunds, issue payment links
and QR codes, read settlements, register webhook endpoints and verify webhooks.

- Node.js 18 or later (uses the runtime's native `fetch`), no runtime dependencies
- ESM and CommonJS builds, TypeScript declarations included
- Every hostname, header, error code and model in this package follows the published merchant API
  contract; the SDK adds no behaviour the API does not have

## Install

```bash
npm install @qasimha/sdk
```

```ts
import Qasimha from '@qasimha/sdk';           // ESM / TypeScript
const { Qasimha } = require('@qasimha/sdk');  // CommonJS
```

### API release of 2026-09-25

The return URLs (`merchantUrl`), the hosted `/pay/{orderId}` page as the `paymentUrl` of an online
session, per-merchant webhook endpoints with their own signing secrets and the `t=…,v1=…`
signature format, the lookup of an order by your own reference and the plan quote for an amount
(`checkout.getPlans`, with a publishable key) are available since the merchant API release of
2026-09-25. Confirm with your environment that it runs that release or a
later one; the SDK verifies both webhook signature formats, so nothing in your code depends on it.

## Configure

Create API keys in the Merchant Portal under Settings → API Keys. Sandbox keys start with
`sk_test_`, production keys with `sk_live_`; the SDK picks the host from the prefix.

```ts
import Qasimha from '@qasimha/sdk';

const qasimha = new Qasimha({
  apiKey: process.env.QASIMHA_API_KEY!,      // required: sk_test_… or sk_live_…
  webhookSecret: process.env.QASIMHA_WEBHOOK_SECRET,
  publishableKey: process.env.QASIMHA_PUBLISHABLE_KEY,   // optional: pk_test_… or pk_live_…, for checkout.getPlans
  language: 'en',                            // 'ar' | 'en' — Accept-Language for API messages
  userAgentSuffix: 'my-store/2.4.1',         // optional, appended to the User-Agent
  timeout: 30_000,                           // per attempt, milliseconds
  maxRetries: 2,                             // 0–5, see Retries & idempotency
  logger: (level, message, fields) => console.log(level, message, fields),
});
```

| Option | Default | Notes |
|---|---|---|
| `apiKey` | — | Required. Must match `^sk_(test\|live)_[A-Za-z0-9]+$`. |
| `environment` | inferred | `'sandbox'` (`https://merchant-api-uat.qasimha.com`) or `'production'` (`https://api.qasimha.com`). Contradicting the key prefix throws `ConfigurationError`. |
| `baseUrl` | per environment | Overrides the host, for example a test server. Must be `https://`; plain `http://` is accepted only for `localhost` and `127.0.0.1`. |
| `timeout` | `30000` | Milliseconds per attempt (connect + read). |
| `maxRetries` | `2` | Extra attempts after the first, 0–5. |
| `webhookSecret` | — | Default secret for `webhooks.constructEvent` / `verifySignature`. |
| `publishableKey` | — | Optional `pk_test_…` / `pk_live_…` for `checkout.getPlans`. Must match `^pk_(test\|live)_[A-Za-z0-9]+$` and belong to the same environment as `apiKey`; `sk_test_` with `pk_live_` throws `ConfigurationError`. |
| `language` | `'en'` | `'ar'` or `'en'`. API error messages come back localized. |
| `userAgentSuffix` | — | Printable ASCII, appended to `qasimha-sdk-node/<version> (node/<version>; <platform>)`. |
| `logger` | none | `(level, message, fields) => void`, see Logging. |

`qasimha.maskedKey()` returns `sk_live_…AbCd` (prefix and last four characters) for your own logs,
and `qasimha.maskedPublishableKey()` does the same for the publishable key (`pk_live_…AbCd`, or
`null` when none is set). The client never prints a full key: `JSON.stringify(client)`,
`util.inspect(client)` and `String(client)` all show the masked forms.

## Create a checkout session and redirect

```ts
import Qasimha, { DuplicateOrderReferenceError, OrderDeclinedError, ValidationError } from '@qasimha/sdk';

const qasimha = new Qasimha({ apiKey: process.env.QASIMHA_API_KEY! });

try {
  const session = await qasimha.checkout.createSession({
    orderReferenceId: 'ORDER-12345',      // your own id, unique per order, ≤ 255 characters
    totalAmount: 1302.10,                 // = Σ item.totalAmount + tax + shipping − discount
    taxAmount: 173.10,
    shippingAmount: 25.00,
    discountAmount: 50.00,
    description: 'Order #12345',
    instalments: 4,
    items: [
      { referenceId: 'SKU-1', name: 'Wireless Headphones', type: 'physical', sku: 'SKU-1', quantity: 1, unitPrice: 899.00, totalAmount: 899.00 },
      { referenceId: 'SKU-2', name: 'USB-C Cable',         type: 'physical', sku: 'SKU-2', quantity: 3, unitPrice: 45.00,  totalAmount: 135.00 },
      { referenceId: 'SKU-3', name: 'Extended Warranty',   type: 'digital',  sku: 'SKU-3', quantity: 1, unitPrice: 120.00, totalAmount: 120.00 },
    ],
    consumer: { firstName: 'Noura', lastName: 'Al-Shammari', phoneNumber: '+9665XXXXXXXX', email: 'noura@example.com' },
    shippingAddress: { firstName: 'Noura', lastName: 'Al-Shammari', line1: 'King Fahd Rd', city: 'Riyadh', countryCode: 'SA' },
    merchantUrl: {                        // where the hosted page sends the shopper afterwards
      success: 'https://shop.example/checkout/qasimha/success?order=ORDER-12345',
      failure: 'https://shop.example/checkout/qasimha/failure?order=ORDER-12345',
      cancel:  'https://shop.example/checkout/qasimha/cancel?order=ORDER-12345',
    },
  });

  await saveQasimhaOrderId('ORDER-12345', session.orderId);   // every later call uses this id
  redirect(session.paymentUrl);
} catch (error) {
  if (error instanceof OrderDeclinedError) {
    // The order exists (error.orderId) but was not approved: offer another payment method.
  } else if (error instanceof DuplicateOrderReferenceError) {
    // A double submit: send the shopper back to the checkout already open.
    if (error.existingPaymentUrl) redirect(error.existingPaymentUrl);
  } else if (error instanceof ValidationError) {
    // error.errors names each failing field, e.g. [{ field: 'items[1].totalAmount', message: '…' }]
  } else {
    throw error;
  }
}
```

`currencyCode` defaults to `SAR` (the only currency the API accepts), `countryCode` to `SA`,
`paymentType` to `pay_by_instalments` and `instalments` to `4`. `shippingAddress` is required by
the API's validator. `merchantId` and `decisionFeatures` are server-controlled and not exposed.

`merchantUrl` is accepted on all four create calls (`createSession`, `createPosSession`,
`createQrSession` and `checkoutLinks.create`) and checked locally against the return-URL contract:
`success` and `failure` are both required, `cancel` is optional and defaults to `failure` on the
platform, each URL is absolute, at most 1024 characters, carries no fragment and uses `https`
(`http` only on `localhost` / `127.0.0.1`, or a custom app scheme such as `myshop://…` for mobile
apps). `notification` is reserved and refused when set.

### Amounts

Amounts are JSON numbers with at most two decimals. The SDK refuses a genuine third decimal
(`1.005`) before sending, naming the field, and never rounds it away; ordinary float noise such as
`0.1 + 0.2` is serialised at its two-decimal value (`0.3`). The two basket identities the API
enforces are checked locally first, in integer halalas, so a plugin learns which line is wrong
without a round trip:

- `item.totalAmount == quantity × unitPrice − item.discountAmount`
- `totalAmount == Σ item.totalAmount + taxAmount + shippingAmount − discountAmount`

The API remains the authority: whatever passes locally is still validated server-side.

### The lifecycle

```
createSession ──▶ shopper pays at paymentUrl ──▶ Confirmed ──▶ fulfill (ship) ──▶ FullyFulfilled
                                                    │                                  │
                                                    └── cancel (void) ─┐               └── refund (full/partial)
                                                                       ▼
                                             Declined / Expired / Voided / Cancelled
```

An order that completes the hosted checkout is already **`Confirmed`** — the customer has paid the
first instalment. `orders.capture` applies to `New` / `Approved` orders only and answers
`400 INVALID_STATUS` on a confirmed one. A store plugin therefore marks the order paid on
`Confirmed`, calls `orders.fulfill` when the goods ship, and `orders.refund` after that.
`refundableAmount` is what the customer has actually paid so far minus refunds already made.

## Handle the return (verify with `orders.get`)

The hosted page sends the shopper to your `merchantUrl` with three query parameters appended
(your own query string is kept): `orderId` (the Qasimha id), `orderReferenceId` (yours,
URL-encoded) and `status` — `confirmed` on the success URL, `declined`, `expired` or `failed` on
the failure URL, `cancelled` on the cancel URL. The return is not signed.

Never mark an order paid because the shopper arrived on your success URL — the return is a
navigation, not a proof, and the URL is guessable. Read the order:

```ts
const order = await qasimha.orders.get(qasimhaOrderId);

if (order.status === 'Confirmed' || order.status === 'FullyFulfilled' || order.status === 'PartiallyFulfilled') {
  // paid
}
```

If you only hold your own reference, use `orders.getByReference` (next section).

`Order` is a curated model: identifiers, status, amounts, the customer, `items`, `installments`,
`fulfillments`, `reversals`, `voids` and `statusHistory`. Status-like fields always carry the
**name** (`'Confirmed'`, `'Online'`, `'PayByInstalments'`, `'Paid'`) even though the API serialises
some of them as integers today; an unknown value is passed through as a string rather than
thrown on. Dates are ISO-8601 strings. Everything the API returned, including platform-internal
fields that are not part of the contract, stays reachable through `order.raw`.

## Look an order up by your reference

A webhook, a return to your store or a support ticket often names only your own
`orderReferenceId`. `orders.getByReference` answers the same `Order` as `orders.get`, scoped to
your account:

```ts
const order = await qasimha.orders.getByReference('ORDER-12345');
order.id;                                   // the Qasimha id, for capture / fulfil / refund
```

The match is exact and case-sensitive; an unknown reference, or one that belongs to another
merchant, is `NotFoundError`. A reference may contain `/` (`ORDER/2026/1`): the SDK percent-encodes
each segment and keeps the separators, so the reference travels as the path remainder.
`orders.list({ search })` remains available for a broader match on the reference, the customer's
name, email or phone.

## Webhooks (raw body, `constructEvent`)

Qasimha `POST`s a JSON event to your configured URL. Verify **every** delivery with the raw request
bytes — not a re-serialised object — then confirm state with `orders.get` before acting.

```ts
const event = qasimha.webhooks.constructEvent(rawBody, req.headers);
// event: { id, type, orderId, orderReferenceId, status, amount, currency, occurredAt, raw }
```

`constructEvent(rawBody, headers, secret?, { tolerance = 300, now? })`:

- `rawBody` — `string`, `Buffer` or `Uint8Array`, exactly as received.
- `headers` — Node's `req.headers`, a Fetch `Headers`, or `{ signature, timestamp }`.
- `secret` — falls back to the client's `webhookSecret`; missing both is a `ConfigurationError`.
- `tolerance` — seconds the delivery timestamp may differ from `now` (replay guard).

Both signature formats are accepted and compared in constant time. An endpoint you register with
`webhookEndpoints.create` (see Manage webhook endpoints) is signed with its own secret as
`t=<unix>,v1=<hex>[,v1=<hex>]` — the timestamp is part of the signed material, and a second `v1`
appears for 24 hours after a secret rotation. An account with no registered endpoint still receives
the operations-configured global delivery, signed as `sha256=<hex>` over the raw body; there the
`X-Qasimha-Timestamp` header, when present, is checked against `tolerance`. Any failure throws
`WebhookSignatureError` with `reason` set to `missing_header`, `malformed_header`,
`timestamp_outside_tolerance` or `signature_mismatch`. There is no unsigned path.

Event types on a registered endpoint: `order.confirmed`, `order.declined`, `order.fulfilled`,
`order.partially_fulfilled`, `order.refunded`, `order.partially_refunded`, `order.voided`,
`order.cancelled`, `order.expired`, `checkout_link.expired` (`order.completed` is accepted as a
subscription alias of `order.confirmed` for one release). The body carries `orderId`,
`orderReferenceId`, `status`, `amount`, `currency` and `data.order`. The global delivery keeps its
original names — `order.completed`, `order.declined`, `order.voided`, `order.reversed` — and no
`orderId`; `orders.getByReference(event.orderReferenceId)` resolves it.

Answer `2xx` quickly and do the work afterwards. Deduplicate on `event.id`.

### Plain Node (`http`)

```js
const http = require('node:http');
const { Qasimha, WebhookSignatureError } = require('@qasimha/sdk');

const qasimha = new Qasimha({ apiKey: process.env.QASIMHA_API_KEY, webhookSecret: process.env.QASIMHA_WEBHOOK_SECRET });

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/qasimha') { res.writeHead(404).end(); return; }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const event = qasimha.webhooks.constructEvent(Buffer.concat(chunks), req.headers);
      res.writeHead(200).end();
      await handle(event);
    } catch (error) {
      res.writeHead(error instanceof WebhookSignatureError ? 400 : 500).end();
    }
  });
}).listen(3000);
```

### Express

Register `express.raw` on the webhook route so `req.body` is the untouched `Buffer`; a global
`express.json()` must not run first on this path.

```js
const express = require('express');
const { Qasimha, WebhookSignatureError } = require('@qasimha/sdk');

const app = express();
const qasimha = new Qasimha({ apiKey: process.env.QASIMHA_API_KEY, webhookSecret: process.env.QASIMHA_WEBHOOK_SECRET });

app.post('/webhooks/qasimha', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = qasimha.webhooks.constructEvent(req.body, req.headers);
    res.sendStatus(200);
    queue(event);
  } catch (error) {
    res.sendStatus(error instanceof WebhookSignatureError ? 400 : 500);
  }
});

app.use(express.json());   // for the rest of the app, after the webhook route
app.listen(3000);
```

### Next.js (App Router route handler)

```ts
// app/api/webhooks/qasimha/route.ts
import Qasimha, { WebhookSignatureError } from '@qasimha/sdk';

const qasimha = new Qasimha({ apiKey: process.env.QASIMHA_API_KEY!, webhookSecret: process.env.QASIMHA_WEBHOOK_SECRET });

export async function POST(req: Request) {
  const rawBody = await req.text();          // the exact bytes; do not call req.json()
  try {
    const event = qasimha.webhooks.constructEvent(rawBody, req.headers);
    await queue(event);
    return new Response(null, { status: 200 });
  } catch (error) {
    return new Response(null, { status: error instanceof WebhookSignatureError ? 400 : 500 });
  }
}
```

### NestJS

Create the application with `NestFactory.create(AppModule, { rawBody: true })` and read
`req.rawBody` from a `@Req() req: RawBodyRequest<Request>` parameter in the controller; pass
`req.rawBody` and `req.headers` to `constructEvent`. The parsed `req.body` must not be used for
verification.

## Manage webhook endpoints

An API key with the `webhooks:manage` scope registers up to five HTTPS endpoints per account and
reads their delivery log. The signing secret is returned **once**, by `create` and by
`rotateSecret`: store it in a secrets manager straight away. The SDK never logs it, it is not in
`result.raw`, and no later read returns it — `secretHint` (its last four characters) tells you
which secret a server holds.

```ts
const endpoint = await qasimha.webhookEndpoints.create({
  url: 'https://shop.example/webhooks/qasimha',      // https only; the API also refuses private-network hosts
  description: 'Production store',
  events: ['order.confirmed', 'order.refunded'],     // omit, or [], for every event
});
await secrets.put('QASIMHA_WEBHOOK_SECRET', endpoint.secret);   // whsec_…, shown once

const all = await qasimha.webhookEndpoints.list();               // { items: WebhookEndpoint[] }
const one = await qasimha.webhookEndpoints.get(endpoint.id);     // id, url, description, events, isActive, secretHint, previousSecretExpiresAt, createdAt, updatedAt
await qasimha.webhookEndpoints.update(endpoint.id, { isActive: false });   // url, description, events, isActive — omitted fields keep their value
await qasimha.webhookEndpoints.ping(endpoint.id);                 // { eventId, endpointId } — a signed `ping` event is queued to the URL

const rotated = await qasimha.webhookEndpoints.rotateSecret(endpoint.id);
rotated.secret;                    // the new secret, shown once
rotated.previousSecretExpiresAt;   // until then deliveries carry two v1 signatures, so either secret verifies

const log = await qasimha.webhookEndpoints.listDeliveries(endpoint.id, { status: 'Failed', page: 1, pageSize: 20 });
log.items[0];                      // id, eventId, eventType, orderId, orderReferenceId, status, attempts, maxAttempts, nextAttemptAt, lastAttemptAt, lastStatusCode, lastError, responseSnippet, durationMs, succeededAt, replayOfId, createdAt
await qasimha.webhookEndpoints.replayDelivery(endpoint.id, log.items[0].id);   // queues the same event again; the new row has replayOfId set

await qasimha.webhookEndpoints.delete(endpoint.id);
```

`url` must be an absolute `https://` URL and `events` must be names from `WEBHOOK_EVENT_TYPES`
(exported), otherwise the call is refused locally as a `ValidationError`. API-side refusals arrive
as `ValidationError` with the code: `URL_REQUIRED`, `URL_INVALID`, `URL_SCHEME`, `URL_PRIVATE`,
`URL_TOO_LONG`, `INVALID_EVENT` or `LIMIT_EXCEEDED`. A key without `webhooks:manage` gets
`PermissionError`; an endpoint that is not yours is `NotFoundError`. `update` and `delete` carry an
`Idempotency-Key` like every write, so they retry safely. Delivery `status` is `Pending`,
`Succeeded` or `Failed`; the platform retries a failed delivery up to `maxAttempts` times and
`nextAttemptAt` says when.

## Capture / fulfil / refund / cancel

```ts
await qasimha.orders.capture(orderId);                 // New / Approved → Confirmed; 400 INVALID_STATUS if already Confirmed
await qasimha.orders.fulfill(orderId, {                // omit shippedAmount to fulfil everything outstanding
  shippedAmount: 1200.00,
  shippingCompany: 'Aramex',
  trackingNumber: 'ARX123',
  trackingUrl: 'https://track.example/ARX123',
});
await qasimha.orders.refund(orderId, { amount: 300.00, reason: 'Customer return' });   // ≤ order.refundableAmount
await qasimha.orders.cancel(orderId);                  // voids an unfulfilled order; cancels an open checkout link

const page = await qasimha.orders.list({ status: 'Confirmed', search: 'ORDER-123', page: 1, pageSize: 20 });
page.items;                                            // OrderSummary[]
page.pagination;                                       // { totalItems, page, pageSize, totalPages }

const counts = await qasimha.orders.counts();          // { all, approved, authorised, captured, refunded, cancelled }
const contract = await qasimha.orders.contract(orderId);   // { bytes: Buffer, contentType, fileName } — the financing contract PDF
```

`orders.list` accepts a status name (`Approved`, `Confirmed`, `FullyFulfilled`, `Voided`, …) or
one of the dashboard aliases `approved`, `authorised`, `captured`, `refunded`, `cancelled`; an
unknown value answers `400 INVALID_STATUS`.

Settlements need a key with the `settlements:read` scope:

```ts
const settlements = await qasimha.settlements.list({ page: 1, pageSize: 20 });   // Page<Settlement>
const overview = await qasimha.settlements.overview();                           // pass-through figures
```

## Payment links & QR

Without a website, or in-store, create the order up front and let the customer complete the same
hosted journey. `channel: 'Link'` sends the link by SMS and needs `phone`; `channel: 'Qr'` returns
a URL you render as a QR code.

```ts
const link = await qasimha.checkoutLinks.create({
  amount: 250.00,
  channel: 'Link',
  phone: '+9665XXXXXXXX',
  language: 'ar',
  orderReferenceId: 'ORDER-12345',          // generated as YYDDDNNNNN (e.g. 2628041980) when omitted
  items: [{ name: 'Shoes', sku: 'SH-1', quantity: 1, unitPrice: 250.00 }],
  // ejarContractNumber: 'EJ-2026-000123',   // required for a real-estate merchant
  // merchantUrl: { success: '…', failure: '…' },   // same contract as on a checkout session
});
link.url;                                   // the hosted /pay/{orderId} page (link.id is the order id)

const status = await qasimha.checkoutLinks.get(link.id);   // status, completed, declined, expiresAt, …
const recent = await qasimha.checkoutLinks.list();         // the latest 50, each with a `waiting` flag
await qasimha.checkoutLinks.cancel(link.id);               // 409 NOT_OPEN once completed or expired
```

The three reads return different shapes today, so every `CheckoutLink` member except `id` is
optional and the untyped response stays in `raw`.

The session-style endpoints for in-store and scan-to-pay flows:

```ts
const pos = await qasimha.checkout.createPosSession({ orderReferenceId, totalAmount, items, consumer });   // consumer.email is required
pos.checkoutUrl;                                                                                        // hosted /pay/{orderId}, status AwaitingCheckout

const qr = await qasimha.checkout.createQrSession({ orderReferenceId, totalAmount, items });
qr.qrCodeUrl;
```

Both apply the basket identities locally. A declined QR order answers `201` with `status:
"Declined"` today; the SDK raises `OrderDeclinedError` for it so all three create calls behave
the same way.

## Quote instalment plans for an amount

Before a customer reaches checkout — under a price on a product page, in a cart summary, or
server-side to decide whether to offer Qasimha at all — quote the plans your policy offers for an
amount. It is the same quote the on-site widget and the mobile promo views show: every plan with
its instalment amount, the first and last instalment, the fees including VAT and the total
payable, priced from your policy with no customer data. The checkout itself quotes the customer's
own terms.

The call authenticates with a **publishable** key (`pk_test_…` / `pk_live_…`, Merchant Portal →
Settings → API Keys), the key that is safe to embed in a page; the secret key is not sent on this
request. Set it once on the client or pass it per call. Its environment must match the secret
key's: `sk_test_` with `pk_live_` is refused at construction.

```ts
const qasimha = new Qasimha({ apiKey, publishableKey: process.env.QASIMHA_PUBLISHABLE_KEY });

const quote = await qasimha.checkout.getPlans(1200.00, { lang: 'ar' });   // lang defaults to the client language
quote.merchantName;                        // your trading name
quote.minAmount; quote.maxAmount;          // the range your policy finances
for (const plan of quote.plans) {
  plan.instalments;                        // 2, 3, 4, …
  plan.frequency;                          // 'monthly'
  plan.instalmentAmount;                   // 307.19
  plan.firstInstalmentAmount;              // 307.19 — first and last may differ by a halala
  plan.lastInstalmentAmount;               // 307.18
  plan.feesIncludingVat;                   // 28.75
  plan.totalPayable;                       // 1228.75
  plan.shariaCompliant;                    // true
}

if (quote.plans.length === 0) {
  // do not offer instalments for this amount
}

// or with a key chosen per call
await qasimha.checkout.getPlans(1200.00, { publishableKey: 'pk_test_…' });
```

An empty `plans` list is an answer, not an error: the amount lies outside `[minAmount,
maxAmount]` or the account has no active policy, so do not offer instalments for it. `amount`
follows the money rules of every other call (a number with at most two decimals, greater than
zero, refused locally otherwise). Without a publishable key the call throws `ConfigurationError`
before any request; a rejected key answers `AuthenticationError` (`401 PUBLIC_KEY_REQUIRED` /
`INVALID_PUBLIC_KEY`) and `400 INVALID_AMOUNT` is a `ValidationError`. The request is a `GET` and
retries like every other read. The platform keeps a merchant's quote for an amount for one minute;
cache the result per page or per request on your side rather than calling it on every render.

## Errors

Every error extends `QasimhaError` and carries `message` (the API's, already localized),
`code` (envelope code or `null`), `httpStatus` (`null` for transport and client-side failures),
`requestId` (the envelope `uuid`, quote it to support), `errors` (field errors, `[]` when none) and
`raw` (the decoded envelope).

| Class | When |
|---|---|
| `ConfigurationError` | Client misconfigured, or an argument such as an empty id refused before sending. |
| `ValidationError` | Any `400` (`VALIDATION_ERROR`, `INVALID_AMOUNT`, `PHONE_REQUIRED`, `INVALID_STATUS`, `AMOUNT_EXCEEDED`, …) with `errors[]` when the API sent them — field names in the API's PascalCase (`TotalAmount`, `Items[0].Quantity`) — and client-side pre-validation, with `httpStatus: null` and the SDK's camelCase field names. |
| `AuthenticationError` | `401` — bad or revoked key (arrives with an empty body), or a missing or unknown publishable key on `checkout.getPlans` (`PUBLIC_KEY_REQUIRED`, `INVALID_PUBLIC_KEY`). |
| `PermissionError` | `403` — the key lacks the scope. |
| `NotFoundError` | `404`. |
| `DuplicateOrderReferenceError` | `409 DUPLICATE_ORDER_REFERENCE`; `existingOrderId`, `existingPaymentUrl` (may be `null`). Extends `ConflictError`. |
| `ConflictError` | Any other `409` (`MERCHANT_SUSPENDED`, `NOT_OPEN`, `REQUEST_IN_PROGRESS` after retries). |
| `OrderDeclinedError` | `422 ORDER_DECLINED` (and a declined QR `201`); `orderId`. |
| `RateLimitError` | `429` after retries; `retryAfter` in seconds when the header was present. |
| `ApiError` | Any other status, a `3xx`, or a `2xx` whose envelope says `success: false`. |
| `ServerError` | `5xx` (extends `ApiError`). |
| `ConnectionError` | DNS, TLS, socket or timeout failure; the transport error is in `cause`. |
| `WebhookSignatureError` | Webhook verification failed; see `reason`. |

## Retries & idempotency

- `timeout` applies per attempt. Retries happen on `ConnectionError`, `429`, `502`, `503`,
  `504` and `409 REQUEST_IN_PROGRESS`; never on other `4xx` and never on `500` (a `500` on a write
  may have committed).
- Backoff is `min(2^n × 500 ms, 8 s)` plus 0–250 ms of jitter, where `n` starts at 0; a
  `Retry-After` header on `429` (seconds or HTTP date) replaces it, capped at 30 s.
- Every `POST` carries an `Idempotency-Key`, a UUID v4 generated per logical call and reused across
  its attempts, so a retry either replays the stored response (`result.replayed === true`) or waits
  for the first request to finish. Pass `{ idempotencyKey: 'your-uuid' }` as the last argument to
  supply your own; pass `{ idempotencyKey: false }` to send none, which also turns retries off for
  that call. Keys are global rather than per merchant today, so use UUIDs, never short strings.
- The same `X-Correlation-Id` is reused across the attempts of one call; the logger's `attempt`
  field tells them apart.
- If `checkout.createSession` / `createPosSession` / `createQrSession` receives
  `409 DUPLICATE_ORDER_REFERENCE` on a retry (not the first attempt) and the response names the
  order, the earlier attempt had succeeded: the SDK returns that order as the session and logs it
  at `info`. On a first attempt the `409` is thrown as `DuplicateOrderReferenceError`.

## Logging

```ts
const qasimha = new Qasimha({
  apiKey,
  logger: (level, message, fields) => log[level](message, fields),
});
```

`level` is `debug` (completed request), `info` (retry scheduled, duplicate recovered), `warn`
(rejected or failed attempt) or `error`. `fields` contains only `method`, `path` (no query string,
so a `search` term never lands in a log), `status`, `durationMs`, `requestId`, `attempt`, the
envelope `code` and, for retries, `delayMs`. The API key, the publishable key, the webhook secret
(including one returned by `webhookEndpoints.create` or `rotateSecret`), request and response
bodies and any consumer data are never passed to the logger. There is no logging by default.

## Security notes

- Keep the API key in a secrets manager or environment variable; it is shown once at creation and
  can be revoked in the portal. Never ship it to a browser or a mobile app.
- The publishable key (`pk_…`) opens only the plan quote and may be embedded in a page; the SDK
  sends it on `checkout.getPlans` alone and never sends the secret key on that call.
- The SDK only talks TLS. Certificate validation is the runtime's default and cannot be switched
  off by an SDK option — there is no `verifySsl: false` — and there is no certificate pinning, so
  host certificate rotation never breaks an installed integration.
- Proxies: the SDK adds no proxy option and relies on the runtime. Node's built-in `fetch` reads
  `HTTPS_PROXY` only on recent releases started with `NODE_USE_ENV_PROXY=1`; on older runtimes
  register an `undici` `ProxyAgent` as the global dispatcher in your application.
- The SDK never follows redirects; a `3xx` from the API is reported as `ApiError`.
- Treat the webhook secret like the key. Verify with the raw bytes, reject on any failure, and
  confirm state with `orders.get` before shipping or refunding.
- Errors and log fields never contain the key, the secret or consumer PII.

## Support

Qasimha Integration Support — customercare@qasimha.com. Quote the `requestId` of the failing call.

## Development

```bash
npm install
npm run typecheck && npm run lint && npm test && npm run build
```

Unit tests run against an in-process HTTP server and the recorded contract fixtures; nothing
touches the network. The live smoke test (`test/live.smoke.test.ts`) runs only when
`QASIMHA_API_KEY` and `QASIMHA_BASE_URL` are set. For a host that must be reached through a local
tunnel the test — and only the test — honours `QASIMHA_RESOLVE_TO=127.0.0.1` (resolves the hostname
to that address while keeping SNI) and `QASIMHA_TLS_INSECURE=1`; the SDK itself has no such
options. Releases are built and published by CI.
