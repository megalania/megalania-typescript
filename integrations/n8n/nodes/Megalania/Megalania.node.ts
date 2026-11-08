import { NodeConnectionTypes, type IDataObject, type IExecuteSingleFunctions, type IHttpRequestOptions, type INodeProperties, type INodeType, type INodeTypeDescription } from "n8n-workflow";

const API = "={{$credentials.apiUrl}}";
const show = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

export async function asJson(this: IExecuteSingleFunctions, opts: IHttpRequestOptions): Promise<IHttpRequestOptions> {
  return { ...opts, body: { ...(opts.body as IDataObject), response_types: "json" } };
}

const schema: INodeProperties = {
  displayName: "Schema",
  name: "schema",
  type: "json",
  default: "",
  description: "A JSON Schema a language model fills from the page, for example {\"type\": \"object\", \"additionalProperties\": false, \"properties\": {\"title\": {\"type\": \"string\"}}}. It sets the response type to JSON. The page content, schema and prompt go to the model provider (Anthropic, US).",
  routing: { send: { type: "body", property: "schema", preSend: [asJson] } },
};

const prompt: INodeProperties = {
  displayName: "Prompt",
  name: "prompt",
  type: "string",
  default: "",
  description: "Extra instructions for the model, at most 2 KB. Needs Schema.",
  typeOptions: { rows: 2 },
  routing: { send: { type: "body", property: "prompt" } },
};

const pageOptions = (resource: string, operation: string): INodeProperties => ({
  displayName: "Options",
  name: "options",
  type: "collection",
  placeholder: "Add Option",
  default: {},
  displayOptions: show(resource, [operation]),
  options: [
    {
      displayName: "Country Code",
      name: "countryCode",
      type: "string",
      default: "",
      placeholder: "US",
      routing: { send: { type: "body", property: "country_code" } },
    },
    {
      displayName: "Engine",
      name: "engine",
      type: "options",
      default: "http",
      description: "Leave unset so routing picks. Browser costs more.",
      options: [
        { name: "HTTP", value: "http" },
        { name: "Browser", value: "browser" },
      ],
      routing: { send: { type: "body", property: "engine" } },
    },
    {
      displayName: "Max Credits",
      name: "maxCredits",
      type: "number",
      default: 128,
      description: "The most credits one page may cost. A bigger page comes back cut.",
      routing: { send: { type: "body", property: "max_credits" } },
    },
    {
      displayName: "Only Main Content",
      name: "onlyMainContent",
      type: "boolean",
      default: true,
      routing: { send: { type: "body", property: "only_main_content" } },
    },
    prompt,
    {
      displayName: "Proxy Tier",
      name: "proxyTier",
      type: "options",
      default: "datacenter",
      description: "Leave unset so routing picks the cheapest tier that works",
      options: [
        { name: "Datacenter", value: "datacenter" },
        { name: "Residential", value: "residential" },
        { name: "Mobile", value: "mobile" },
      ],
      routing: { send: { type: "body", property: "proxy_tier" } },
    },
    {
      displayName: "Response Type",
      name: "responseTypes",
      type: "options",
      default: "markdown",
      options: [
        { name: "HTML", value: "html" },
        { name: "Links", value: "links" },
        { name: "Markdown", value: "markdown" },
        { name: "Metadata", value: "metadata" },
        { name: "Text", value: "text" },
      ],
      routing: { send: { type: "body", property: "response_types" } },
    },
    schema,
  ],
});

export class Megalania implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Megalania",
    name: "megalania",
    icon: { light: "file:megalania.svg", dark: "file:megalania.svg" },
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Scrape pages, map sites and run batches with Megalania",
    defaults: { name: "Megalania" },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: "megalaniaApi", required: true }],
    requestDefaults: {
      baseURL: "={{$credentials.baseUrl}}",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    },
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        default: "page",
        options: [
          { name: "Page", value: "page" },
          { name: "Site", value: "site" },
          { name: "Batch", value: "batch" },
        ],
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        default: "scrape",
        displayOptions: { show: { resource: ["page"] } },
        options: [
          {
            name: "Scrape",
            value: "scrape",
            action: "Scrape a page",
            description: "Fetch one page as Markdown, text, HTML, links or metadata",
            routing: {
              request: { method: "POST", url: "/v1", returnFullResponse: true, json: false },
              output: {
                postReceive: [
                  {
                    type: "set",
                    properties: {
                      value: '={{ { "content": $response.body, "credits_charged": Number($response.headers["x-credits-charged"]), "request_id": $response.headers["x-request-id"], "truncated": $response.headers["x-truncated"] } }}',
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        default: "map",
        displayOptions: { show: { resource: ["site"] } },
        options: [
          {
            name: "Map",
            value: "map",
            action: "Map a site",
            description: "List a site's URLs from its sitemaps and links",
            routing: { request: { method: "POST", url: "/v1/map" } },
          },
        ],
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        default: "create",
        displayOptions: { show: { resource: ["batch"] } },
        options: [
          {
            name: "Create",
            value: "create",
            action: "Create a batch",
            description: "Start a batch of pages, or crawl one site",
            routing: { request: { method: "POST", url: "/v1/batches", baseURL: API } },
          },
          {
            name: "Get",
            value: "get",
            action: "Get a batch",
            description: "Read a batch's status and counts",
            routing: { request: { method: "GET", url: '=/v1/batches/{{$parameter["batchId"]}}', baseURL: API } },
          },
          {
            name: "List Items",
            value: "listItems",
            action: "List the items of a batch",
            description: "Each page of a batch, with a link to its result",
            routing: { request: { method: "GET", url: '=/v1/batches/{{$parameter["batchId"]}}/items', baseURL: API } },
          },
        ],
      },
      {
        displayName: "URL",
        name: "url",
        type: "string",
        required: true,
        default: "",
        placeholder: "https://megalania.io/",
        displayOptions: { show: { resource: ["page", "site"] } },
        routing: { send: { type: "body", property: "url" } },
      },
      pageOptions("page", "scrape"),
      {
        displayName: "Options",
        name: "options",
        type: "collection",
        placeholder: "Add Option",
        default: {},
        displayOptions: show("site", ["map"]),
        options: [
          {
            displayName: "Search",
            name: "search",
            type: "string",
            default: "",
            description: "Keep only URLs that contain this text",
            routing: { send: { type: "body", property: "search" } },
          },
          {
            displayName: "Limit",
            name: "limit",
            type: "number",
            default: 50,
            typeOptions: { minValue: 1, maxValue: 5000 },
            description: "Max number of results to return",
            routing: { send: { type: "body", property: "limit" } },
          },
          {
            displayName: "Include Subdomains",
            name: "includeSubdomains",
            type: "boolean",
            default: false,
            routing: { send: { type: "body", property: "include_subdomains" } },
          },
        ],
      },
      {
        displayName: "URLs",
        name: "urls",
        type: "string",
        required: true,
        default: "",
        description: "One URL per line, or comma-separated. A crawl takes exactly one.",
        typeOptions: { rows: 4 },
        displayOptions: show("batch", ["create"]),
        routing: { send: { type: "body", property: "urls", value: "={{ $value.split(/[\\s,]+/).filter(Boolean) }}" } },
      },
      {
        displayName: "Crawl",
        name: "crawl",
        type: "json",
        default: "",
        description: 'Follow links from the one URL, for example {"max_pages": 50}. Leave empty for a plain batch.',
        displayOptions: show("batch", ["create"]),
        routing: { send: { type: "body", property: "crawl", value: "={{ $value ? JSON.parse($value) : undefined }}" } },
      },
      {
        displayName: "Options",
        name: "options",
        type: "collection",
        placeholder: "Add Option",
        default: {},
        displayOptions: show("batch", ["create"]),
        options: [
          {
            displayName: "Name",
            name: "name",
            type: "string",
            default: "",
            routing: { send: { type: "body", property: "name" } },
          },
          {
            displayName: "Max Credits",
            name: "maxCredits",
            type: "number",
            default: 128,
            description: "The most credits one page may cost",
            routing: { send: { type: "body", property: "max_credits" } },
          },
          prompt,
          schema,
        ],
      },
      {
        displayName: "Batch ID",
        name: "batchId",
        type: "string",
        required: true,
        default: "",
        displayOptions: show("batch", ["get", "listItems"]),
      },
      {
        displayName: "Options",
        name: "options",
        type: "collection",
        placeholder: "Add Option",
        default: {},
        displayOptions: show("batch", ["listItems"]),
        options: [
          {
            displayName: "Limit",
            name: "limit",
            type: "number",
            default: 50,
            typeOptions: { minValue: 1, maxValue: 100 },
            description: "Max number of results to return",
            routing: { send: { type: "query", property: "limit" } },
          },
          {
            displayName: "Status",
            name: "status",
            type: "string",
            default: "",
            placeholder: "done,blocked",
            description: "Keep only items with these statuses, comma-separated",
            routing: { send: { type: "query", property: "status" } },
          },
        ],
      },
    ],
  };
}
