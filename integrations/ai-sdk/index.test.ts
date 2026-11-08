import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { megalaniaTools } from "./src/index.ts";

type Answer = { status?: number; body: string; headers?: Record<string, string> };
const ID = "0199a1c2-0000-7000-8000-000000000001";
const calls: { method?: string; path: string; body: Record<string, unknown> | null }[] = [];
let routes: Record<string, Answer> = {};
let base = "";
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    calls.push({ method: req.method, path, body: raw ? JSON.parse(raw) : null });
    const a = routes[`${req.method} ${path}`] ?? { status: 404, body: JSON.stringify({ error: { code: "not_found", message: "no route" } }) };
    res.writeHead(a.status ?? 200, { "Content-Type": "application/json", ...a.headers }).end(a.body);
  });
});
before(() => new Promise<void>((r) => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; r(); })));
after(() => server.close());
beforeEach(() => { calls.length = 0; routes = {}; });

const OK = { "X-Credits-Charged": "1", "X-Request-Id": "r1" };
const tools = (o: Record<string, unknown> = {}) => megalaniaTools({ apiKey: "k", baseUrl: base, apiUrl: base, ...o });
const exec = (t: { execute?: unknown }, input: Record<string, unknown>) => (t.execute as (i: unknown, o: unknown) => Promise<Record<string, unknown>>)(input, { toolCallId: "1", messages: [] });

test("five tools, in order", () => {
  assert.deepEqual(Object.keys(tools()), ["scrape", "extract", "map_site", "create_batch", "get_batch"]);
});

test("extract asks for json, sends a schema object as JSON text, and keeps the max_credits cap", async () => {
  routes = { "POST /v1": { body: '{"data":{"title":"A"}}', headers: OK } };
  const schema = { type: "object", additionalProperties: false, properties: { title: { type: "string" } } };
  const out = await exec(tools().extract, { url: "https://a.test/", schema, prompt: "the title", response_types: "markdown" });
  assert.deepEqual(calls[0].body, { url: "https://a.test/", schema: JSON.stringify(schema), prompt: "the title", response_types: "json", max_credits: 128 });
  assert.deepEqual(out, { text: '{"data":{"title":"A"}}', credits_charged: 1, request_id: "r1" });
});

test("create_batch takes a schema and a prompt and sends the schema as JSON text", async () => {
  routes = { "POST /v1/batches": { body: JSON.stringify({ id: ID }) } };
  const schema = { type: "object", additionalProperties: false, properties: { title: { type: "string" } } };
  await exec(tools().create_batch, { urls: ["https://a.test/"], response_types: "json", schema, prompt: "the title" });
  assert.deepEqual(calls[0].body, { response_types: "json", schema: JSON.stringify(schema), prompt: "the title", urls: ["https://a.test/"], max_credits: 128 });
  const spec = (tools().create_batch as { inputSchema: { jsonSchema: { properties: Record<string, unknown> } } }).inputSchema.jsonSchema.properties;
  assert.ok("schema" in spec && "prompt" in spec);
});

test("max_credits 128 is sent by default on scrape and create_batch", async () => {
  routes = { "POST /v1": { body: "# A", headers: OK }, "POST /v1/batches": { body: JSON.stringify({ id: ID }) } };
  const t = tools();
  const out = await exec(t.scrape, { url: "https://a.test/", timeout: 30 });
  await exec(t.create_batch, { urls: ["https://a.test/"] });
  assert.deepEqual(calls[0].body, { url: "https://a.test/", response_types: "markdown", timeout: 30, max_credits: 128 });
  assert.equal(calls[1].body?.max_credits, 128);
  assert.deepEqual(out, { text: "# A", credits_charged: 1, request_id: "r1" });
});

test("maxCredits overrides the default", async () => {
  routes = { "POST /v1": { body: "# A", headers: OK } };
  await exec(tools({ maxCredits: 300 }).scrape, { url: "https://a.test/" });
  assert.equal(calls[0].body?.max_credits, 300);
});

test("a long page is cut at maxChars, and an X-Truncated page says how to get it whole", async () => {
  routes = { "POST /v1": { body: "x".repeat(50), headers: { ...OK, "X-Truncated": "max_credits" } } };
  const out = await exec(tools({ maxChars: 10 }).scrape, { url: "https://a.test/" });
  assert.equal(out.text, `${"x".repeat(10)}\n[truncated: 40 more characters]\n[cut at max_credits=128: create the tools with a higher maxCredits (up to 32767) to get the whole page]`);
});

test("max_credits_too_low names the price to pass", async () => {
  routes = { "POST /v1": { status: 400, body: JSON.stringify({ error: { code: "max_credits_too_low", message: "the lowest price is 32" } }) } };
  await assert.rejects(exec(tools({ maxCredits: 8 }).scrape, { url: "https://a.test/" }), /max_credits=8 is below the cheapest route.*the lowest price is 32/);
});

test("create_batch refuses more than maxPages URLs and caps a crawl", async () => {
  routes = { "POST /v1/batches": { body: JSON.stringify({ id: ID }) } };
  const t = tools({ maxPages: 2 });
  await assert.rejects(exec(t.create_batch, { urls: ["https://a.test/1", "https://a.test/2", "https://a.test/3"] }), /too_many_pages: 3 URLs is above maxPages=2/);
  assert.equal(calls.length, 0);
  await exec(t.create_batch, { urls: ["https://a.test/"], crawl: { max_pages: 5000, max_depth: 3 } });
  await exec(t.create_batch, { urls: ["https://a.test/"], crawl: {} });
  assert.deepEqual(calls.map((c) => c.body?.crawl), [{ max_pages: 2, max_depth: 3 }, { max_pages: 2 }]);
});

test("get_batch returns status and page content", async () => {
  routes = {
    [`GET /v1/batches/${ID}`]: { body: JSON.stringify({ id: ID, status: "done" }) },
    [`GET /v1/batches/${ID}/items`]: { body: JSON.stringify({ items: [{ url: "https://a.test/", status: "done", result_url: `${base}/r/1` }], next_cursor: null }) },
    "GET /r/1": { body: "# A" },
  };
  const out = await exec(tools().get_batch, { batch_id: ID });
  assert.equal(out.status, "done");
  assert.equal((out.items as Record<string, unknown>[])[0].content, "# A");
});

test("no key is an error", () => {
  const saved = process.env.MEG_API_KEY;
  delete process.env.MEG_API_KEY;
  try {
    assert.throws(() => megalaniaTools(), /MEG_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.MEG_API_KEY = saved;
  }
});
