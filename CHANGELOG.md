# Changelog

## 0.3.0

- `getBatch(id, { waitSeconds: 25 })` waits on the server for the batch to end. `waitBatch` uses it and drops `poll`.

- `waitBatch`, `readResults`, `batchResults` and `readPages` work like the Python helpers.
- `getAccount`, `getUsage`, `getDomainStats` and `rotateWebhookSecret`.
- A `schema` object is sent as JSON text, and `readPages` with a `schema` asks for `json`.

## 0.2.0

- First release on npm.
- `scrape` replaces `render`. The SDK covers scrape, tier, map, batches and monitors.
- `new Megalania()` reads `MEG_API_KEY` when no key is passed.
