# n8n-nodes-megalania

An n8n community node for the [Megalania](https://megalania.io) scraping API.

## Install

In n8n: **Settings → Community Nodes → Install**, then enter `n8n-nodes-megalania`.

## Credential

Create a **Megalania API** credential with your key (it starts with `meg_sk_`). Leave the two hosts as they are.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Page | Scrape | One page as Markdown, text, HTML, links or metadata, with the credits it cost |
| Site | Map | A site's URLs from its sitemaps and links |
| Batch | Create | Many pages, or a crawl of one site |
| Batch | Get | A batch's status and counts |
| Batch | List Items | Each page of a batch, with a link to its result |

Each page costs at most **Max Credits** (default 128). Blocked pages and errors are free.
The node can also be used as a tool by the n8n AI Agent.

Guide: https://docs.megalania.io/integrations/n8n. MIT license.
