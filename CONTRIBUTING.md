# Contributing

Thank you for helping. Issues and pull requests are welcome.

- **Bugs and questions:** open an issue. Include the SDK version, your
  Node.js version and the `X-Request-Id` header of the failing call. Never
  paste your API key.
- **`src/schema.ts`** is generated from the Megalania OpenAPI
  document. Do not edit it by hand: a change there is lost at the next
  generation. If a type is wrong, open an issue and we fix the API document.
- **`src/index.ts`** is written by hand. Pull requests for it are
  welcome. Run the tests first: `npx tsc --noEmit && node --test smoke.test.ts`.
- This repository is a copy of the SDK folder in our main repository. We
  apply an accepted pull request there, and it comes back here with the next
  sync.

By sending a pull request you agree that it is released under the MIT
license of this repository.
