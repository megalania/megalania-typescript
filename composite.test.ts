import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { Megalania, MegalaniaError } from "./src/index.ts";

type Call = { method: string; path: string; query: Record<string, string>; auth?: string; body: unknown };
type Answer = [status: number, body: unknown, headers?: Record<string, string>];
const ID = "0199a1c2-0000-7000-8000-000000000001";
let routes = new Map<string, Answer[]>();
let calls: Call[] = [];
let base = "";

const add = (method: string, path: string, body: unknown, status = 200, headers: Record<string, string> = {}) => {
  const k = `${method} ${path}`;
  routes.set(k, [...(routes.get(k) ?? []), [status, body, headers]]);
};

function serve(req: IncomingMessage, res: ServerResponse) {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const u = new URL(req.url ?? "/", base);
    calls.push({ method: req.method!, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
    const list = routes.get(`${req.method} ${u.pathname}`);
    if (!list?.length) return res.writeHead(404).end();
    const [status, body, headers] = list.length > 1 ? list.shift()! : list[0]!;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json", ...headers }).end(text);
  });
}

const server = createServer(serve);
before(() => new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => {
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  ok();
})));
after(() => server.close());
beforeEach(() => ((routes = new Map()), (calls = [])));
const client = () => new Megalania("k", { baseUrl: base, apiUrl: base });
const all = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

test("waitBatch returns on a terminal status and times out on a running one", async () => {
  for (const s of ["queued", "running", "done"]) add("GET", `/v1/batches/${ID}`, { id: ID, status: s });
  assert.equal((await client().waitBatch(ID, { poll: 0.01 })).status, "done");
  assert.equal(calls.length, 3);
  routes = new Map();
  add("GET", `/v1/batches/${ID}`, { id: ID, status: "running" });
  await assert.rejects(client().waitBatch(ID, { timeout: 0.05, poll: 0.01 }), /still running/);
});

test("batchResults skips items with no link, follows the cursor, and fetches results without the key", async () => {
  const path = `/v1/batches/${ID}/items`;
  add("GET", path, { items: [{ id: "a", result_url: `${base}/r/a` }, { id: "b", result_url: null }], next_cursor: "c2" });
  add("GET", path, { items: [{ id: "c", result_url: `${base}/r/c` }], next_cursor: null });
  add("GET", "/r/a", "A");
  add("GET", "/r/c", "C");
  const got = await all(client().batchResults(ID));
  assert.deepEqual(got.map(([i, b]) => [i.id, new TextDecoder().decode(b)]), [["a", "A"], ["c", "C"]]);
  assert.equal(calls[2]!.query.cursor, "c2");
  assert.deepEqual(calls.filter((c) => c.path.startsWith("/r/")).map((c) => c.auth), [undefined, undefined]);
});

test("readResults keeps the order and raises on a bad link", async () => {
  for (let n = 0; n < 10; n++) add("GET", `/r/${n}`, String(n));
  const items = [...Array.from({ length: 10 }, (_, n) => ({ result_url: `${base}/r/${n}` })), { result_url: null }];
  assert.deepEqual((await client().readResults(items)).map((b) => new TextDecoder().decode(b)), Array.from({ length: 10 }, (_, n) => String(n)));
  add("GET", "/r/gone", { error: { code: "not_found", message: "expired" } }, 403);
  const e = await client().readResults([{ result_url: `${base}/r/gone` }]).then(() => assert.fail("no error"), (e: unknown) => e);
  assert.ok(e instanceof MegalaniaError && e.status === 403);
});

test("readPages crawls one URL through a batch and yields the finished items of a failed batch", async () => {
  add("POST", "/v1/batches", { id: ID, status: "queued" });
  add("GET", `/v1/batches/${ID}`, { id: ID, status: "failed" });
  add("GET", `/v1/batches/${ID}/items`, { items: [
    { id: "a", url: "https://megalania.io/", depth: 0, target_status: 200, result_url: `${base}/r/a` },
    { id: "b", url: "https://megalania.io/x", depth: 1, target_status: null, result_url: null }] });
  add("GET", "/r/a", "<h1>A</h1>");
  const pages = await all(client().readPages("https://megalania.io/", { crawl: { max_pages: 2 } }));
  assert.deepEqual(pages, [["<h1>A</h1>", { source: "https://megalania.io/", depth: 0, target_status: 200 }]]);
  assert.deepEqual(calls[0]!.body, { urls: ["https://megalania.io/"], crawl: { max_pages: 2 }, response_types: "markdown" });
  await assert.rejects(all(client().readPages(["https://a.test/", "https://b.test/"], { crawl: {} })), /exactly one URL/);
});

test("readPages raises on a blocked page, or skips it with continueOnFailure", async () => {
  const blocked: Answer = [422, { error: { code: "blocked", message: "b" } }];
  routes.set("POST /v1", [blocked, [200, "# ok", { "X-Credits-Charged": "1", "X-Request-Id": "r1", "X-Target-Status": "200" }]]);
  await assert.rejects(all(client().readPages(["https://a.test/", "https://b.test/"])), (e: unknown) => e instanceof MegalaniaError && e.code === "blocked");
  routes.get("POST /v1")!.unshift(blocked);
  const warn = console.warn;
  const logged: string[] = [];
  console.warn = (m: string) => void logged.push(m);
  const pages = await all(client().readPages(["https://a.test/", "https://b.test/"], { continueOnFailure: true })).finally(() => (console.warn = warn));
  assert.deepEqual(pages, [["# ok", { source: "https://b.test/", request_id: "r1", credits_charged: 1, target_status: 200 }]]);
  assert.ok(logged.length === 1 && !logged[0]!.includes("a.test"));
  assert.deepEqual(calls.at(-1)!.body, { response_types: "markdown", url: "https://b.test/" });
});

test("a schema object goes as JSON text, and readPages then asks for json", async () => {
  const schema = { type: "object", additionalProperties: false, properties: { title: { type: "string" } } };
  add("POST", "/v1", '{"data": {"title": "A"}}');
  add("POST", "/v1/batches", { id: ID });
  const pages = await all(client().readPages("https://a.test/", { schema, prompt: "the title" }));
  await client().createBatch({ urls: ["https://a.test/"], schema: '{"type":"object"}', response_types: "json" });
  assert.equal(pages[0]![0], '{"data": {"title": "A"}}');
  assert.deepEqual(calls[0]!.body, { response_types: "json", schema: JSON.stringify(schema), prompt: "the title", url: "https://a.test/" });
  assert.equal((calls[1]!.body as { schema: string }).schema, '{"type":"object"}');
});

test("account, usage, domain stats and the webhook secret rotate call the right routes", async () => {
  add("GET", "/v1/account", { balance: 5 });
  add("GET", "/v1/account/usage", { usage: [] });
  add("GET", "/v1/stats/domain", { requests: 0 });
  add("POST", "/v1/account/webhook-secret/rotate", { secret: "s" });
  const meg = client();
  assert.deepEqual(await meg.getAccount(), { balance: 5 });
  assert.deepEqual(await meg.getUsage({ days: 7 }), { usage: [] });
  assert.deepEqual(await meg.getDomainStats("a.test", { days: 30 }), { requests: 0 });
  assert.deepEqual(await meg.rotateWebhookSecret(), { secret: "s" });
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.query]), [
    ["GET", "/v1/account", {}], ["GET", "/v1/account/usage", { days: "7" }],
    ["GET", "/v1/stats/domain", { host: "a.test", days: "30" }], ["POST", "/v1/account/webhook-secret/rotate", {}]]);
});
