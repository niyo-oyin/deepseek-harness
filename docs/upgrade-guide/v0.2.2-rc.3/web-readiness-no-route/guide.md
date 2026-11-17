---
kind: upgrade-guide
description: "ctx.web.searchReady(), ctx.web.fetchReady(), and the optional provider ready() no longer take the chat route id."
---

# Web readiness takes no chat route

## Change

`@deepseek-ai/dsh-web` declared `ctx.web.searchReady(llmProvider?)`, `ctx.web.fetchReady(llmProvider?)`, and an optional `ready(llmProvider)` on `WebSearchProvider` and `WebFetchProvider`, so readiness could depend on the model route a step used. Readiness no longer depends on the route: the three methods are now `searchReady()`, `fetchReady()`, and `ready()`, and a provider's answer says whether its next operation has a credential to send.

TypeScript code that passes an argument to `searchReady()` or `fetchReady()` no longer compiles. A provider that still declares `ready(llmProvider)` keeps type-checking and running, but always receives `undefined`.

## Migration

1. Remove the argument from every `ctx.web.searchReady(...)` and `ctx.web.fetchReady(...)` call.
2. In a search or fetch provider plugin, change `ready(llmProvider)` to `ready()` and base the answer on the provider's own configuration and credentials, not on the chat route.
3. Confirm: the plugin type-checks against the new `@deepseek-ai/dsh-web`, and a model step lists `web_search` or `web_fetch` while the selected provider's credential is configured.
