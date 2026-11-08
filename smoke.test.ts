import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, test } from "node:test";
import { Megalania, MegalaniaError } from "./src/index.ts";

const live = process.env.MEG_BASE_URL;
const calls: unknown[][] = [];
const seen: { auth?: string; key?: string; body: Record<string, unknown> }[] = [];
let base = live ?? "";
const key = live ? process.env.MEG_API_KEY! : "test-key";
const target = live ? process.env.MEG_TARGET_URL! : "https://a.test/";

const error = (res: ServerResponse, status: number, code: string, field?: string, extra: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "X-Request-Id": "r-err", ...extra });
  res.end(JSON.stringify({ error: { code, message: `mock ${code}`, field, report_url: "https://app.megalania.io/report" } }));
};

function mock(req: IncomingMessage, res: ServerResponse) {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url !== "/v1") {
      calls.push([req.method, req.url, req.headers.authorization, req.headers["idempotency-key"], raw ? JSON.parse(raw) : null]);
      if (req.method === "DELETE") return res.writeHead(204).end();
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "b-1", ok: true }));
    }
    const body = JSON.parse(raw);
    const n = seen.push({ auth: req.headers.authorization, key: req.headers["idempotency-key"] as string, body });
    const path = String(body.url).replace("https://a.test", "");
    if (req.headers.authorization !== "Bearer test-key") return error(res, 401, "bad_token");
    if (body.engine === "nope") return error(res, 400, "bad_parameter", "engine");
    if (path === "/busy" || (path === "/once" && n === 1)) return error(res, 429, "over_concurrency", undefined, { "Retry-After": "1" });
    if (path === "/long") return error(res, 429, "over_concurrency", undefined, { "Retry-After": "120" });
    if (path === "/dated") return error(res, 429, "over_concurrency", undefined, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" });
    if (path === "/slow") return void setTimeout(() => res.writeHead(200).end("late"), 1500);
    if (path === "/badnum") return res.writeHead(200, { "Content-Type": "text/html", "X-Request-Id": "r1", "X-Credits-Charged": "abc" }).end("<p>ok</p>");
    if (path === "/down") return error(res, 503, "busy", undefined, { "Retry-After": "1" });
    if (path === "/edge") return res.writeHead(500, { "Content-Type": "text/plain" }).end("edge page");
    if (path === "/blocked") return error(res, 422, "blocked", undefined, { "X-Billing": "blocked", "X-Untried": "c:dc,c:res", "X-Hops": '[{"rung":"h:dc","identity":"chrome","ms":9}]', "X-Vendor": "cloudflare" });
    res.writeHead(200, { "Content-Type": "text/html", "X-Request-Id": "r1", "X-Credits-Charged": "1", "X-Engine": "http", "X-Target-Status": "200", "X-Route": "http/datacenter" });
    res.end("<p>ok</p>");
  });
}

const server = createServer(mock);
before(() => {
  if (live) return;
  return new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    ok();
  }));
});
after(() => { if (!live) server.close(); });
const client = (k = key) => new Megalania(k, { baseUrl: base, apiUrl: `${base}/api-host` });
const rejects = async (p: Promise<unknown>) => {
  const e = await p.then(() => assert.fail("no error"), (e: unknown) => e);
  assert.ok(e instanceof MegalaniaError);
  return e;
};

test("scrape returns the body and typed headers", async () => {
  seen.length = 0;
  const r = await client().scrape({ url: target });
  assert.ok((await r.response.text()).length > 0);
  assert.equal(typeof r.headers["X-Credits-Charged"], "number");
  assert.equal(typeof r.headers["X-Request-Id"], "string");
  if (!live) assert.deepEqual(seen.map((s) => [s.auth, s.body]), [["Bearer test-key", { url: target }]]);
});

test("a bad key is a typed 401", async () => {
  const e = await rejects(client("not-a-key").scrape({ url: target }));
  assert.equal(e.status, 401);
  assert.equal(e.code, "bad_token");
});

test("a block is a typed free 422 and is never retried", { skip: !!live }, async () => {
  seen.length = 0;
  const e = await rejects(client().scrape({ url: "https://a.test/blocked" }));
  assert.equal(e.status, 422);
  assert.equal(e.code, "blocked");
  assert.equal(seen.length, 1);
  assert.deepEqual(
    [e.headers["X-Billing"], e.headers["X-Untried"], e.headers["X-Hops"], e.headers["X-Vendor"]],
    ["blocked", "c:dc,c:res", '[{"rung":"h:dc","identity":"chrome","ms":9}]', "cloudflare"],
  );
});

test("a bad parameter is a typed 400 that names the field", async () => {
  const e = await rejects(client().scrape({ url: target, engine: "nope" as "http" }));
  assert.equal(e.status, 400);
  assert.equal(e.code, "bad_parameter");
  assert.equal(e.field, "engine");
  assert.ok(e.message.length > 0);
  assert.ok(e.requestId);
});

test("429 is retried once after Retry-After", { skip: !!live }, async () => {
  seen.length = 0;
  const t = Date.now();
  const r = await client().scrape({ url: "https://a.test/once" });
  assert.equal(r.response.status, 200);
  assert.equal(seen.length, 2);
  assert.ok(Date.now() - t >= 1000);
});

test("the 429 retry reuses the Idempotency-Key", { skip: !!live }, async () => {
  seen.length = 0;
  await client().scrape({ url: "https://a.test/once" });
  assert.ok(seen[0].key);
  assert.equal(seen[0].key, seen[1].key);
});

test("each scrape has its own Idempotency-Key", { skip: !!live }, async () => {
  seen.length = 0;
  await client().scrape({ url: target });
  await client().scrape({ url: target });
  await client().scrape({ url: target }, { idempotencyKey: "mine-1" });
  assert.equal(new Set(seen.map((s) => s.key)).size, 3);
  assert.equal(seen[2].key, "mine-1");
});

test("Retry-After above 60 is an error without a wait", { skip: !!live }, async () => {
  seen.length = 0;
  const t = Date.now();
  const e = await rejects(client().scrape({ url: "https://a.test/long" }));
  assert.equal(e.status, 429);
  assert.equal(seen.length, 1);
  assert.ok(Date.now() - t < 1000);
});

test("a Retry-After date is an error without a retry", { skip: !!live }, async () => {
  seen.length = 0;
  const e = await rejects(client().scrape({ url: "https://a.test/dated" }));
  assert.equal(e.status, 429);
  assert.equal(seen.length, 1);
});

test("scrape stops at the timeout", { skip: !!live }, async () => {
  const meg = new Megalania(key, { baseUrl: base, timeout: 0.3 });
  const t = Date.now();
  await assert.rejects(meg.scrape({ url: "https://a.test/slow" }), { name: "TimeoutError" });
  assert.ok(Date.now() - t < 1000);
});

test("a bad numeric header is left out", { skip: !!live }, async () => {
  const r = await client().scrape({ url: "https://a.test/badnum" });
  assert.equal("X-Credits-Charged" in r.headers, false);
  assert.equal(r.headers["X-Request-Id"], "r1");
});

test("a second 429 is an error, not a second retry", { skip: !!live }, async () => {
  seen.length = 0;
  const e = await rejects(client().scrape({ url: "https://a.test/busy" }));
  assert.equal(e.code, "over_concurrency");
  assert.equal(seen.length, 2);
});

test("503 is never retried", { skip: !!live }, async () => {
  seen.length = 0;
  const e = await rejects(client().scrape({ url: "https://a.test/down" }));
  assert.equal(e.code, "busy");
  assert.equal(seen.length, 1);
});

test("an error body that is not JSON is still a typed error", { skip: !!live }, async () => {
  const e = await rejects(client().scrape({ url: "https://a.test/edge" }));
  assert.equal(e.status, 500);
  assert.equal(e.code, undefined);
  assert.equal(e.message, "edge page");
});

test("each method calls its operation on its host", { skip: !!live }, async () => {
  const m = client();
  const a = "/api-host";
  const u = ["https://example.com/"];
  const cases: [() => Promise<unknown>, string, string, unknown, boolean][] = [
    [() => m.getTier("example.com", { country_code: "DE" }), "GET", "/v1/tier?host=example.com&country_code=DE", null, false],
    [() => m.mapSite({ url: u[0], limit: 10 }), "POST", "/v1/map", { url: u[0], limit: 10 }, true],
    [() => m.createBatch({ urls: u, response_types: "markdown" }), "POST", `${a}/v1/batches`, { urls: u, response_types: "markdown" }, true],
    [() => m.quoteBatch({ urls: u }), "POST", `${a}/v1/batches/quote`, { urls: u }, false],
    [() => m.listBatches({ limit: 5 }), "GET", `${a}/v1/batches?limit=5`, null, false],
    [() => m.getBatch("b/1"), "GET", `${a}/v1/batches/b%2F1`, null, false],
    [() => m.listBatchItems("b-1", { status: "failed" }), "GET", `${a}/v1/batches/b-1/items?status=failed`, null, false],
    [() => m.cancelBatch("b-1"), "POST", `${a}/v1/batches/b-1/cancel`, null, false],
    [() => m.createMonitor({ urls: u, every: "day" }), "POST", `${a}/v1/monitors`, { urls: u, every: "day" }, true],
    [() => m.listMonitors(), "GET", `${a}/v1/monitors`, null, false],
    [() => m.getMonitor("m-1"), "GET", `${a}/v1/monitors/m-1`, null, false],
    [() => m.updateMonitor("m-1", { paused: true }), "PATCH", `${a}/v1/monitors/m-1`, { paused: true }, false],
    [() => m.deleteMonitor("m-1"), "DELETE", `${a}/v1/monitors/m-1`, null, false],
    [() => m.runMonitor("m-1"), "POST", `${a}/v1/monitors/m-1/run`, null, false],
    [() => m.listMonitorChecks("m-1", { limit: 3 }), "GET", `${a}/v1/monitors/m-1/checks?limit=3`, null, false],
  ];
  for (const [call, method, path, body, keyed] of cases) {
    calls.length = 0;
    const out = await call();
    assert.equal(calls.length, 1, path);
    const [gm, gp, auth, k, gb] = calls[0];
    assert.deepEqual([gm, gp, auth, gb], [method, path, "Bearer test-key", body]);
    assert.equal(!!k, keyed, path);
    assert.deepEqual(out, method === "DELETE" ? undefined : { id: "b-1", ok: true });
  }
});

test("the key falls back to MEG_API_KEY, and none is an error", () => {
  const saved = process.env.MEG_API_KEY;
  try {
    process.env.MEG_API_KEY = "from-env";
    assert.ok(new Megalania());
    delete process.env.MEG_API_KEY;
    assert.throws(() => new Megalania(), /MEG_API_KEY/);
  } finally {
    if (saved === undefined) delete process.env.MEG_API_KEY;
    else process.env.MEG_API_KEY = saved;
  }
});
