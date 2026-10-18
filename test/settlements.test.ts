import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PermissionError } from '../src/index.js';
import { TestServer, envelope, failure, makeClient, reply } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await TestServer.start();
});

afterEach(() => server.reset());

afterAll(() => server.close());

describe('settlements', () => {
  it('lists settlements as a page', async () => {
    server.on('GET', '/api/v1/merchant/settlements', (_req, res) =>
      reply(
        res,
        200,
        envelope('SUCCESS', {
          data: [{ id: 's1', providerSettlementId: 'ps1', amount: 12000.5, currencyCode: 'SAR', settledAt: '2026-09-24T00:00:00Z', status: 'Paid', orderCount: 14 }],
          pagination: { totalItems: 1, page: 2, pageSize: 5, totalPages: 1 },
        }),
      ),
    );
    const page = await makeClient(server).settlements.list({ page: 2, pageSize: 5 });
    expect(page.items[0]).toMatchObject({ id: 's1', providerSettlementId: 'ps1', amount: 12000.5, currencyCode: 'SAR', settledAt: '2026-09-24T00:00:00Z', status: 'Paid', orderCount: 14 });
    expect(page.pagination).toEqual({ totalItems: 1, page: 2, pageSize: 5, totalPages: 1 });
    expect(server.last.query.get('page')).toBe('2');
    expect(server.last.query.get('pageSize')).toBe('5');
  });

  it('returns the overview as a pass-through object with request metadata', async () => {
    server.on('GET', '/api/v1/merchant/settlements/overview', (_req, res) =>
      reply(res, 200, envelope('SUCCESS', { currency: 'SAR', settlementCycle: 'Once a week', settlementModel: 'Flexible', minimumSettlementAmount: 2500, remainingForNextSettlement: 1200.25, totalSettled: 0, settlementCount: 0, notPaidYet: 1299.75 }, 'ok', 'u-ov')),
    );
    const overview = await makeClient(server).settlements.overview();
    expect(overview).toMatchObject({ currency: 'SAR', settlementCycle: 'Once a week', minimumSettlementAmount: 2500, remainingForNextSettlement: 1200.25, notPaidYet: 1299.75, requestId: 'u-ov', replayed: false });
  });

  it('maps a missing settlements:read scope to PermissionError', async () => {
    server.on('GET', '/api/v1/merchant/settlements', (_req, res) => reply(res, 403, failure('FORBIDDEN', 'missing scope')));
    await expect(makeClient(server).settlements.list()).rejects.toBeInstanceOf(PermissionError);
  });
});
