import type { components } from "./schema.ts";

export type ScrapeEnvelope = components["schemas"]["ScrapeEnvelope"];
type Envelope = Omit<ScrapeEnvelope, "schema"> & { schema?: string | Json };
export type ErrorCode = components["schemas"]["Error"]["error"]["code"];
type Documented = components["responses"]["Scraped"]["headers"];
export type ScrapedHeaders = { [K in keyof Documented as string extends K ? never : K]: Documented[K] };

const KINDS = {
  "X-Request-Id": "s",
  "Cache-Control": "s",
  "Content-Security-Policy": "s",
  "X-Content-Type-Options": "s",
  "Referrer-Policy": "s",
  "X-Credits-Charged": "n",
  "X-Credits-Route": "n",
  "X-Credits-Output": "n",
  "X-Credits-Other": "n",
  "X-Engine": "s",
  "X-Target-Status": "n",
  "X-Timing-Target-Ms": "n",
  "X-Route": "s",
  "X-Geo": "s",
  "X-Identity": "s",
  "X-Billing": "s",
  "X-Block": "s",
  "X-Challenge": "s",
  "X-Vendor": "s",
  "X-Hint": "s",
  "X-Untried": "s",
  "X-Untried-Reason": "s",
  "X-Hops": "s",
  "X-Ladder-Truncated": "s",
  "X-Truncated": "s",
  "X-Network-Truncated": "s",
  "X-Compact-Truncated": "s",
  "X-Document": "s",
  "X-Document-Units": "n",
  "X-Document-Truncated": "s",
  "X-Usage-Warning": "s",
  "X-Cache": "s",
} as const satisfies Record<keyof ScrapedHeaders, "s" | "n">;

export class MegalaniaError extends Error {
  readonly status: number;
  readonly code?: ErrorCode;
  readonly field?: string;
  readonly requestId?: string;
  readonly reportUrl?: string;
  readonly headers: Partial<ScrapedHeaders>;

  constructor(message: string, status: number, code?: ErrorCode, field?: string, requestId?: string, reportUrl?: string, headers: Partial<ScrapedHeaders> = {}) {
    super(message);
    this.name = "MegalaniaError";
    this.headers = headers;
    this.status = status;
    this.code = code;
    this.field = field;
    this.requestId = requestId;
    this.reportUrl = reportUrl;
  }
}

export interface Result {
  headers: ScrapedHeaders;
  response: Response;
}

export type Json = Record<string, unknown>;
type Query = Record<string, string | number | boolean | undefined>;
type Options = { idempotencyKey?: string };
type Page = [text: string, metadata: Json];
const DONE = ["done", "failed", "canceled"];
const envelope = <T extends { schema?: string | Json }>(b: T) => (b.schema === undefined || typeof b.schema === "string" ? b : { ...b, schema: JSON.stringify(b.schema) });
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

export class Megalania {
  readonly baseUrl: string;
  readonly apiUrl: string;
  readonly timeout: number;
  readonly #apiKey: string;

  constructor(apiKey?: string, { baseUrl = "https://get.megalania.io", apiUrl = "https://api.megalania.io", timeout = 100 }: { baseUrl?: string; apiUrl?: string; timeout?: number } = {}) {
    const key = apiKey || (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.MEG_API_KEY;
    if (!key) throw new Error("no API key: pass apiKey or set MEG_API_KEY");
    this.#apiKey = key;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.timeout = timeout;
  }

  async #send(url: string, method: string, body?: unknown, key?: string): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#apiKey}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (key !== undefined) headers["Idempotency-Key"] = key || crypto.randomUUID();
    const init: RequestInit = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
    const send = () => fetch(url, { ...init, signal: AbortSignal.timeout(this.timeout * 1000) });
    let res = await send();
    if (res.status === 429) {
      const after = res.headers.get("Retry-After")?.trim();
      const wait = after === undefined ? 1 : /^\d+$/.test(after) ? Number(after) : -1;
      if (wait >= 0 && wait <= 60) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, wait * 1000));
        res = await send();
      }
    }
    if (!res.ok) throw await toError(res);
    return res;
  }

  async #json<T = Json>(host: string, method: string, path: string, { query, body, key }: { query?: Query; body?: unknown; key?: string } = {}): Promise<T> {
    const q = new URLSearchParams(Object.entries(query ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    const res = await this.#send(`${host}${path}${q.size ? `?${q}` : ""}`, method, body, key);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async scrape(body: Envelope, { idempotencyKey }: Options = {}): Promise<Result> {
    const res = await this.#send(`${this.baseUrl}/v1`, "POST", envelope(body), idempotencyKey ?? "");
    return { headers: typed(res.headers), response: res };
  }

  getTier(host: string, query: Query = {}) {
    return this.#json(this.baseUrl, "GET", "/v1/tier", { query: { host, ...query } });
  }

  getDomainStats(host: string, query: Query = {}) {
    return this.#json(this.baseUrl, "GET", "/v1/stats/domain", { query: { host, ...query } });
  }

  getAccount() {
    return this.#json(this.apiUrl, "GET", "/v1/account");
  }

  getUsage(query: Query = {}) {
    return this.#json(this.apiUrl, "GET", "/v1/account/usage", { query });
  }

  rotateWebhookSecret() {
    return this.#json(this.apiUrl, "POST", "/v1/account/webhook-secret/rotate");
  }

  mapSite(body: { url: string } & Json, { idempotencyKey }: Options = {}) {
    return this.#json(this.baseUrl, "POST", "/v1/map", { body, key: idempotencyKey ?? "" });
  }

  createBatch(body: { urls: string[] } & Omit<Envelope, "url"> & Json, { idempotencyKey }: Options = {}) {
    return this.#json(this.apiUrl, "POST", "/v1/batches", { body: envelope(body), key: idempotencyKey ?? "" });
  }

  quoteBatch(body: { urls: string[] } & Omit<Envelope, "url"> & Json) {
    return this.#json(this.apiUrl, "POST", "/v1/batches/quote", { body: envelope(body) });
  }

  listBatches(query: Query = {}) {
    return this.#json(this.apiUrl, "GET", "/v1/batches", { query });
  }

  getBatch(id: string) {
    return this.#json(this.apiUrl, "GET", `/v1/batches/${encodeURIComponent(id)}`);
  }

  listBatchItems(id: string, query: Query = {}) {
    return this.#json(this.apiUrl, "GET", `/v1/batches/${encodeURIComponent(id)}/items`, { query });
  }

  cancelBatch(id: string) {
    return this.#json(this.apiUrl, "POST", `/v1/batches/${encodeURIComponent(id)}/cancel`);
  }

  createMonitor(body: Json, { idempotencyKey }: Options = {}) {
    return this.#json(this.apiUrl, "POST", "/v1/monitors", { body, key: idempotencyKey ?? "" });
  }

  listMonitors(query: Query = {}) {
    return this.#json(this.apiUrl, "GET", "/v1/monitors", { query });
  }

  getMonitor(id: string) {
    return this.#json(this.apiUrl, "GET", `/v1/monitors/${encodeURIComponent(id)}`);
  }

  updateMonitor(id: string, body: Json) {
    return this.#json(this.apiUrl, "PATCH", `/v1/monitors/${encodeURIComponent(id)}`, { body });
  }

  async deleteMonitor(id: string): Promise<void> {
    await this.#json(this.apiUrl, "DELETE", `/v1/monitors/${encodeURIComponent(id)}`);
  }

  runMonitor(id: string) {
    return this.#json(this.apiUrl, "POST", `/v1/monitors/${encodeURIComponent(id)}/run`);
  }

  listMonitorChecks(id: string, query: Query = {}) {
    return this.#json(this.apiUrl, "GET", `/v1/monitors/${encodeURIComponent(id)}/checks`, { query });
  }

  async waitBatch(id: string, { timeout = 3600, poll = 2 }: { timeout?: number; poll?: number } = {}): Promise<Json> {
    const end = performance.now() + timeout * 1000;
    for (;;) {
      const batch = await this.getBatch(id);
      if (DONE.includes(String(batch.status))) return batch;
      if (performance.now() + poll * 1000 > end) throw new Error(`batch ${id} still ${String(batch.status)} after ${timeout} s`);
      await new Promise((r) => setTimeout(r, poll * 1000));
    }
  }

  async readResults(items: Json[]): Promise<Uint8Array[]> {
    const links = items.map((i) => i.result_url).filter((u): u is string => typeof u === "string" && u !== "");
    const out: Uint8Array[] = new Array(links.length);
    let next = 0;
    const get = async () => {
      while (next < links.length) {
        const i = next++;
        const res = await fetch(links[i]!, { signal: AbortSignal.timeout(this.timeout * 1000) });
        if (!res.ok) throw await toError(res);
        out[i] = new Uint8Array(await res.arrayBuffer());
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, links.length) }, get));
    return out;
  }

  async *batchResults(id: string): AsyncGenerator<[item: Json, body: Uint8Array]> {
    let cursor: string | undefined;
    do {
      const page = await this.listBatchItems(id, { limit: 100, cursor });
      const items = ((page.items as Json[] | undefined) ?? []).filter((i) => i.result_url);
      const bodies = await this.readResults(items);
      for (const [i, item] of items.entries()) yield [item, bodies[i]!];
      cursor = typeof page.next_cursor === "string" && page.next_cursor ? page.next_cursor : undefined;
    } while (cursor);
  }

  async *readPages(urls: string | string[], { crawl, continueOnFailure = false, ...params }: { crawl?: Json; continueOnFailure?: boolean } & Omit<Envelope, "url"> & Json = {}): AsyncGenerator<Page> {
    const list = typeof urls === "string" ? [urls] : [...urls];
    const body = { response_types: params.schema === undefined ? "markdown" : "json", ...params } as Omit<Envelope, "url">;
    if (crawl !== undefined) {
      if (list.length !== 1) throw new Error("a crawl starts from exactly one URL");
      const batch = await this.createBatch({ urls: list, crawl, ...body });
      await this.waitBatch(String(batch.id));
      for await (const [item, bytes] of this.batchResults(String(batch.id))) yield [decode(bytes), { source: item.url, depth: item.depth, target_status: item.target_status }];
      return;
    }
    for (const url of list) {
      let r: Result;
      try {
        r = await this.scrape({ ...body, url });
      } catch (e) {
        if (!continueOnFailure || !(e instanceof MegalaniaError)) throw e;
        console.warn(`megalania: skipped a page: ${e.code} (request ${e.requestId})`);
        continue;
      }
      yield [await r.response.text(), { source: url, request_id: r.headers["X-Request-Id"], credits_charged: r.headers["X-Credits-Charged"], target_status: r.headers["X-Target-Status"] }];
    }
  }
}

function typed(h: Headers): ScrapedHeaders {
  const headers: Record<string, string | number> = {};
  for (const [name, kind] of Object.entries(KINDS)) {
    const v = h.get(name);
    if (v === null) continue;
    if (kind === "s") headers[name] = v;
    else if (!Number.isNaN(Number(v))) headers[name] = Number(v);
  }
  return headers as ScrapedHeaders;
}

async function toError(res: Response): Promise<MegalaniaError> {
  const text = await res.text();
  const requestId = res.headers.get("X-Request-Id") ?? undefined;
  try {
    const { error } = JSON.parse(text) as components["schemas"]["Error"];
    return new MegalaniaError(error.message, res.status, error.code, error.field, requestId, error.report_url, typed(res.headers));
  } catch {
    return new MegalaniaError(text.slice(0, 500) || `HTTP ${res.status}`, res.status, undefined, undefined, requestId, undefined, typed(res.headers));
  }
}
