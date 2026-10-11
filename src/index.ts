import type { components } from "./schema.ts";

export type ScrapeEnvelope = components["schemas"]["ScrapeEnvelope"];
export type ErrorCode = components["schemas"]["Error"]["error"]["code"];
type Documented = components["responses"]["Scraped"]["headers"];
export type ScrapedHeaders = { [K in keyof Documented as string extends K ? never : K]: Documented[K] };

const KINDS = {
  "X-Request-Id": "s",
  "Cache-Control": "s",
  "X-Credits-Charged": "n",
  "X-Engine": "s",
  "X-Target-Status": "n",
  "X-Timing-Target-Ms": "n",
  "X-Route": "s",
  "X-Identity": "s",
  "X-Billing": "s",
  "X-Block": "s",
  "X-Challenge": "s",
  "X-Vendor": "s",
  "X-Hint": "s",
  "X-Untried": "s",
  "X-Hops": "s",
  "X-Ladder-Truncated": "s",
  "X-Truncated": "s",
  "X-Network-Truncated": "s",
  "X-Compact-Truncated": "s",
  "X-Usage-Warning": "s",
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

export class Megalania {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly #apiKey: string;

  constructor(apiKey: string, { baseUrl = "https://get.megalania.io", timeout = 100 }: { baseUrl?: string; timeout?: number } = {}) {
    this.#apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeout = timeout;
  }

  async render(envelope: ScrapeEnvelope, { idempotencyKey }: { idempotencyKey?: string } = {}): Promise<Result> {
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey || crypto.randomUUID(),
      },
      body: JSON.stringify(envelope),
    };
    const send = () => fetch(`${this.baseUrl}/v1`, { ...init, signal: AbortSignal.timeout(this.timeout * 1000) });
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
    return { headers: typed(res.headers), response: res };
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
