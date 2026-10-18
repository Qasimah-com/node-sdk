import { dataRecord, type Transport } from '../http.js';
import { mapPagination, mapSettlement, records } from '../mappers.js';
import type { ListSettlementsParams, Page, Settlement, SettlementOverview } from '../models.js';

export class SettlementsResource {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async list(params: ListSettlementsParams = {}): Promise<Page<Settlement>> {
    const raw = await this.transport.request({
      method: 'GET',
      path: '/merchant/settlements',
      query: { page: params.page, pageSize: params.pageSize },
    });
    const data = dataRecord(raw);
    const rows = Array.isArray(data['data']) ? records(data, 'data') : records(data, 'items');
    return {
      items: rows.map(mapSettlement),
      pagination: mapPagination(data),
      requestId: raw.requestId,
      replayed: raw.replayed,
    };
  }

  async overview(): Promise<SettlementOverview> {
    const raw = await this.transport.request({ method: 'GET', path: '/merchant/settlements/overview' });
    return { ...dataRecord(raw), requestId: raw.requestId, replayed: raw.replayed };
  }
}
