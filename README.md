# Megalania TypeScript SDK

**Beta.** A small client for the Megalania scraping API, for Node.js, Deno
and Bun. One call returns a page as HTML, Markdown or JSON. You get the
`Response`, the headers as typed fields, and a `MegalaniaError` with the
error code and message. No runtime dependencies: it uses the built-in `fetch`.

- It retries once on a 429, after `Retry-After`, and never on anything else.
- Every scrape, map and create call sends an `Idempotency-Key`, so a repeat is never charged twice.
- The types are generated from the Megalania OpenAPI document.

## Install

Node.js 22.18 or newer.

```sh
npm install megalania
```

## One page

Save as `scrape.mjs` and run `node scrape.mjs`:

```js
import { Megalania, MegalaniaError } from "megalania";

const meg = new Megalania(process.env.MEG_API_KEY);
try {
  const { headers, response } = await meg.scrape({ url: "https://example.com/", response_types: "markdown" });
  console.log(headers["X-Credits-Charged"], (await response.text()).slice(0, 200));
} catch (e) {
  if (e instanceof MegalaniaError) console.log(e.status, e.code, e.message, e.requestId);
  throw e;
}
```

The client calls `https://get.megalania.io` unless you pass `{ baseUrl }`.

Batches, monitors, map and tier have their own methods, named after their
REST operation: `getTier`, `mapSite`, `createBatch`, `getBatch`,
`listBatchItems`, `cancelBatch`, `createMonitor`, `listMonitors` and more.
They call `https://api.megalania.io` unless you pass `{ apiUrl }`:

```js
const batch = await meg.createBatch({ urls: ["https://docs.megalania.io/start/quickstart"], response_types: "markdown" });
console.log(await meg.getBatch(batch.id));
```

## Docs

The full guide is at https://docs.megalania.io/guides/sdk-typescript.

## License

MIT. See `LICENSE`. Security reports: see `SECURITY.md`.
