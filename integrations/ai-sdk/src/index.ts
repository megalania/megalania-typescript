import { jsonSchema, tool, type Tool } from "ai";
import { Megalania, MegalaniaError } from "megalania";
import specs from "./tools.json" with { type: "json" };

export type ToolName = "scrape" | "extract" | "map_site" | "create_batch" | "get_batch";
export type Options = { apiKey?: string; maxCredits?: number; maxPages?: number; maxChars?: number; baseUrl?: string; apiUrl?: string };
type Input = Record<string, unknown>;

export function cut(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[truncated: ${text.length - maxChars} more characters]`;
}

export function explain(e: unknown, maxCredits: number): Error {
  if (!(e instanceof MegalaniaError)) return e as Error;
  if (e.code === "max_credits_too_low") {
    return new Error(`max_credits_too_low: max_credits=${maxCredits} is below the cheapest route for this page. Create the tools with a higher maxCredits (up to 32767). ${e.message}`);
  }
  return new Error(`${e.code ?? e.status}: ${e.message}`);
}

export function megalaniaTools({ apiKey, maxCredits = 128, maxPages = 100, maxChars = 100_000, baseUrl, apiUrl }: Options = {}): Record<ToolName, Tool> {
  const meg = new Megalania(apiKey, { baseUrl, apiUrl });
  const run: Record<ToolName, (input: Input) => Promise<unknown>> = {
    async scrape({ url, ...rest }) {
      const { headers, response } = await meg.scrape({ url: String(url), response_types: "markdown", ...rest, max_credits: maxCredits } as Parameters<Megalania["scrape"]>[0]);
      let text = cut(await response.text(), maxChars);
      if (headers["X-Truncated"] === "max_credits") text += `\n[cut at max_credits=${maxCredits}: create the tools with a higher maxCredits (up to 32767) to get the whole page]`;
      return { text, credits_charged: headers["X-Credits-Charged"], request_id: headers["X-Request-Id"] };
    },
    async extract({ url, ...rest }) {
      const { headers, response } = await meg.scrape({ url: String(url), ...rest, response_types: "json", max_credits: maxCredits } as Parameters<Megalania["scrape"]>[0]);
      return { text: cut(await response.text(), maxChars), credits_charged: headers["X-Credits-Charged"], request_id: headers["X-Request-Id"] };
    },
    map_site: (input) => meg.mapSite(input as { url: string }),
    create_batch({ urls, crawl, ...rest }) {
      const list = urls as string[];
      if (list.length > maxPages) throw new Error(`too_many_pages: ${list.length} URLs is above maxPages=${maxPages}. Create the tools with a higher maxPages to send more in one batch.`);
      const body: Input = { ...rest, urls: list, max_credits: maxCredits };
      if (crawl !== undefined && crawl !== null) {
        const c = crawl as Input;
        body.crawl = { ...c, max_pages: Math.min(Number(c.max_pages) || maxPages, maxPages) };
      }
      return meg.createBatch(body as Parameters<Megalania["createBatch"]>[0]);
    },
    async get_batch({ batch_id, cursor, limit = 20 }) {
      const id = String(batch_id);
      const batch = await meg.getBatch(id);
      const page = (await meg.listBatchItems(id, { limit: Number(limit), cursor: cursor as string | undefined })) as { items?: Input[]; next_cursor?: string };
      const items = page.items ?? [];
      const share = Math.floor(maxChars / Math.max(1, items.length));
      const rows = await Promise.all(items.map(async (item) => {
        const row: Input = { url: item.url, status: item.status, error: item.error, credits_charged: item.credits_charged, target_status: item.target_status };
        if (typeof item.result_url === "string") {
          const res = await fetch(item.result_url);
          if (!res.ok) throw new Error(`${res.status}: a result link did not answer; call get_batch again for fresh links`);
          row.content = cut(await res.text(), share);
        }
        return row;
      }));
      return { ...batch, items: rows, next_cursor: page.next_cursor ?? null };
    },
  };
  return Object.fromEntries(specs.map((s) => [s.name, tool({
    description: s.description,
    inputSchema: jsonSchema<Input>(s.inputSchema as Parameters<typeof jsonSchema>[0]),
    execute: async (input: Input) => {
      try {
        return await run[s.name as ToolName](input);
      } catch (e) {
        throw explain(e, maxCredits);
      }
    },
  })])) as Record<ToolName, Tool>;
}
