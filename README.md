# Megalania TypeScript SDK

**Beta.** A small client for the Megalania scraping API, for Node.js, Deno
and Bun. One call returns a page as HTML, Markdown or JSON. You get the
`Response`, the headers as typed fields, and a `MegalaniaError` with the
error code and message. No runtime dependencies: it uses the built-in `fetch`.

- It retries once on a 429, after `Retry-After`, and never on anything else.
- Every call sends an `Idempotency-Key`, so a repeat is never charged twice.
- The types are generated from the Megalania OpenAPI document.

## Install

Node.js 22.18 or newer.

```sh
npm install github:megalania/megalania-typescript
```

## One page

Save as `render.mjs` and run `node render.mjs`:

```js
import { Megalania, MegalaniaError } from "megalania";

const meg = new Megalania(process.env.MEG_API_KEY);
try {
  const { headers, response } = await meg.render({ url: "https://example.com/", response_types: "markdown" });
  console.log(headers["X-Credits-Charged"], (await response.text()).slice(0, 200));
} catch (e) {
  if (e instanceof MegalaniaError) console.log(e.status, e.code, e.message, e.requestId);
  throw e;
}
```

The client calls `https://get.megalania.io` unless you pass `{ baseUrl }`.

## Docs

The full guide is at https://docs.megalania.io/guides/sdk-typescript.

## License

MIT. See `LICENSE`. Security reports: see `SECURITY.md`.
