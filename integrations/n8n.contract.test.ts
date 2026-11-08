import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

type Schema = Record<string, any>;
const require = createRequire(join(import.meta.dirname, "n8n/package.json"));
const { parse } = require("yaml");
const root = join(import.meta.dirname, "../../..");
const docs = { base: parse(readFileSync(join(root, "api/openapi/v1.yaml"), "utf8")), api: parse(readFileSync(join(root, "api/openapi/frillneck.yaml"), "utf8")) };
const { Megalania } = require("./dist/nodes/Megalania/Megalania.node.js");
const description = new Megalania().description;

function resolve(doc: Schema, s: Schema | undefined): Schema {
  while (s?.$ref) s = s.$ref.slice(2).split("/").reduce((o: Schema, k: string) => o[k], doc);
  return s ?? {};
}

function bodyKeys(doc: Schema, s: Schema): Set<string> {
  const r = resolve(doc, s);
  const keys = new Set(Object.keys(r.properties ?? {}));
  for (const part of r.allOf ?? []) bodyKeys(doc, part).forEach((k) => keys.add(k));
  if (r.additionalProperties === true) Object.keys(docs.base.components.schemas.ScrapeEnvelope.properties).forEach((k) => keys.add(k));
  return keys;
}

function operations() {
  const out = [];
  for (const p of description.properties) {
    if (p.name !== "operation") continue;
    for (const o of p.options) out.push({ resource: p.displayOptions.show.resource[0], op: o.value, request: o.routing.request });
  }
  return out;
}

function sends(resource: string, op: string) {
  const out: { type: string; property: string }[] = [];
  const walk = (p: Schema, shown: boolean) => {
    if (p.routing?.send && shown) out.push(p.routing.send);
    for (const o of p.options ?? []) if (typeof o === "object" && "displayName" in o) walk(o, shown);
  };
  for (const p of description.properties) {
    const show = p.displayOptions?.show;
    walk(p, !!show && show.resource?.includes(resource) && (!show.operation || show.operation.includes(op)));
  }
  return out;
}

test("every n8n operation is an OpenAPI operation, and every field it sends is in that operation", () => {
  const ops = operations();
  assert.equal(ops.length, 5);
  for (const { resource, op, request } of ops) {
    const doc = request.baseURL === "={{$credentials.apiUrl}}" ? docs.api : docs.base;
    const path = request.url.replace(/^=/, "").replace(/\{\{[^}]+\}\}/g, "{id}");
    const operation = doc.paths[path]?.[request.method.toLowerCase()];
    assert.ok(operation, `${resource}.${op}: ${request.method} ${path} is not in the OpenAPI document`);
    const body = operation.requestBody ? bodyKeys(doc, operation.requestBody.content["application/json"].schema) : new Set<string>();
    const query = new Set((operation.parameters ?? []).map((x: Schema) => resolve(doc, x)).filter((x: Schema) => x.in === "query").map((x: Schema) => x.name));
    for (const s of sends(resource, op)) {
      assert.ok((s.type === "body" ? body : query).has(s.property), `${resource}.${op} sends ${s.type} ${s.property}, which the API does not take`);
    }
  }
});

test("the credential sends the key as a Bearer token and tests a free call", () => {
  const { MegalaniaApi } = require("./dist/credentials/MegalaniaApi.credentials.js");
  const c = new MegalaniaApi();
  assert.equal(c.authenticate.properties.headers.Authorization, "=Bearer {{$credentials.apiKey}}");
  assert.ok(docs.api.paths[c.test.request.url].get);
});

test("Schema and Prompt reach the page scrape and the batch body, and a schema asks for json", async () => {
  for (const [resource, op] of [["page", "scrape"], ["batch", "create"]]) {
    const props = sends(resource, op).map((s) => s.property);
    assert.ok(props.includes("schema") && props.includes("prompt"), `${resource}.${op}`);
  }
  const { asJson } = require("./dist/nodes/Megalania/Megalania.node.js");
  const out = await asJson.call({}, { url: "/v1", body: { url: "u", response_types: "markdown", schema: "{}" } });
  assert.deepEqual(out, { url: "/v1", body: { url: "u", response_types: "json", schema: "{}" } });
});
