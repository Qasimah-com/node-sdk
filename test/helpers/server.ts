import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Qasimha, type QasimhaOptions } from '../../src/index.js';

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: string;
  json: unknown;
}

export type Handler = (req: RecordedRequest, res: ServerResponse) => void | Promise<void>;

export class TestServer {
  readonly requests: RecordedRequest[] = [];
  baseUrl = '';
  private readonly sticky = new Map<string, Handler>();
  private readonly queued = new Map<string, Handler[]>();
  private server!: Server;

  static async start(): Promise<TestServer> {
    const instance = new TestServer();
    instance.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const body = Buffer.concat(chunks).toString('utf8');
        let json: unknown = undefined;
        if (body.length > 0) {
          try {
            json = JSON.parse(body);
          } catch {
            json = undefined;
          }
        }
        const recorded: RecordedRequest = {
          method: req.method ?? 'GET',
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          body,
          json,
        };
        instance.requests.push(recorded);
        const key = `${recorded.method} ${recorded.path}`;
        const queue = instance.queued.get(key);
        const handler = queue && queue.length > 0 ? queue.shift() : instance.sticky.get(key);
        if (!handler) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end(`no route for ${key}`);
          return;
        }
        void Promise.resolve(handler(recorded, res)).catch((error: unknown) => {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(String(error));
        });
      });
    });
    await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    const { port } = instance.server.address() as AddressInfo;
    instance.baseUrl = `http://127.0.0.1:${port}`;
    return instance;
  }

  on(method: string, path: string, handler: Handler): this {
    this.sticky.set(`${method} ${path}`, handler);
    return this;
  }

  once(method: string, path: string, handler: Handler): this {
    const key = `${method} ${path}`;
    const queue = this.queued.get(key) ?? [];
    queue.push(handler);
    this.queued.set(key, queue);
    return this;
  }

  reset(): void {
    this.sticky.clear();
    this.queued.clear();
    this.requests.length = 0;
  }

  get last(): RecordedRequest {
    const request = this.requests[this.requests.length - 1];
    if (!request) throw new Error('no request recorded');
    return request;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

export function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

export function envelope(code: string, data: unknown, message = 'ok', uuid: string = randomUUID()) {
  return { success: true, uuid, code, message, data, errors: null };
}

export function failure(
  code: string,
  message: string,
  extra: { errors?: { field: string; message: string }[]; data?: unknown; uuid?: string } = {},
) {
  return {
    success: false,
    uuid: extra.uuid ?? randomUUID(),
    code,
    message,
    data: extra.data ?? null,
    errors: extra.errors ?? null,
  };
}

export const TEST_API_KEY = 'sk_test_ABC123xyz';

export function makeClient(server: TestServer, overrides: Partial<QasimhaOptions> = {}): Qasimha {
  return new Qasimha({
    apiKey: TEST_API_KEY,
    baseUrl: server.baseUrl,
    sleep: async () => {},
    random: () => 0,
    ...overrides,
  });
}

export function sleepRecorder(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
