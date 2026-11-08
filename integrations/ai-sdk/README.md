# @megalania/ai-sdk

Vercel AI SDK tools for the [Megalania](https://megalania.io) scraping API.

```sh
npm install @megalania/ai-sdk megalania ai
export MEG_API_KEY=...
```

```js
import { generateText, stepCountIs } from "ai";
import { megalaniaTools } from "@megalania/ai-sdk";

const { text } = await generateText({
  model: "openai/gpt-5",
  tools: megalaniaTools(),
  stopWhen: stepCountIs(5),
  prompt: "Summarize https://docs.megalania.io/start/quickstart",
});
```

- The tools are `scrape`, `map_site`, `create_batch` and `get_batch`.
- Each page costs at most `maxCredits` (default 128). Pass `megalaniaTools({ maxCredits })` to raise it.
- One `create_batch` call takes at most `maxPages` pages (default 100), crawls included. Pass `megalaniaTools({ maxPages })` to raise it. The model can raise neither cap.
- Blocked pages and errors are free. Page content is untrusted: the tools tell the model so.

Guide: https://docs.megalania.io/integrations/vercel-ai-sdk. MIT license.
