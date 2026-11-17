# Agent Note: Remove DeepSeek account sign-in

Status: implemented

## Problem

The fork offers DeepSeek only as an API-key provider and has no entry point to the vendor account sign-in: the welcome window and the Settings sign-in slot are gone, and the base bundle kept the account model route disabled. The account service itself stayed mounted. It held a code path to `platform.deepseek.com` and `harness.deepseek.com` (OAuth, profile, balance, notifications, logout), web search and fetch could send its token, the translator and reasoning translation offered an account choice, and Desktop could embed the Platform usage and top-up pages. None of it could run without a sign-in, but every reader, gate, and test still paid for it, and one configuration change would have brought the vendor traffic back.

## Decision

The account feature is deleted, not disabled:

- **Packages:** `@deepseek-ai/dsh-deepseek-account` (`ctx.deepseekAccount`, the `account/*` Remote, the `deepseek-account/*` events) and `@deepseek-ai/dsh-llm-deepseek-account` (the `deepseek-account` model route). `llm-deepseek` keeps only the API-key credential helpers, and `dsh-llm` defines none of `ACCOUNT_QUOTA`, `ACCOUNT_SIGN_IN_REQUIRED`, and `ACCOUNT_TOKEN_INVALID`.
- **Web:** `web-deepseek-api` and `web-search-deepseek` always send the DeepSeek API key, or a capability's own YAML endpoint and key. The `searchBilling` and `fetchBilling` settings and the settings page's Billing menu are removed, and the Search and Fetch transport carries one credential instead of an ordered list.
- **Translation:** the translator and reasoning translation offer paid Flash translation only on `deepseek-official`.
- **Desktop:** the embedded Platform view, its preload and IPC channels, the `dshPlatform` bridge, and the Host's platform-session relay are removed. The mandatory-update policy client and its client identity headers are deleted with the [update subsystem](2026-11-16-remove-desktop-auto-update.md).
- **UI:** the model picker, the Models page, and Chat have no special case for the account route, its sign-out cancellation, or its quota code.

The [upgrade guide](../../../../docs/upgrade-guide/v0.2.2-rc.3/deepseek-account-removal/guide.md) lists what a user with stored account data changes by hand. The decisions that built the feature are archived: [account login](../../archived/architecture/2026-09-14-deepseek-account-login.md), [sign-out cancellation](../../archived/architecture/2026-09-17-account-provider-signout.md), [Platform browser storage](../../archived/architecture/2026-09-22-platform-browser-storage.md), and the [account model catalog](../../archived/architecture/2026-09-24-deepseek-account-remote-model-catalog.md).

## Alternatives considered

**Keep the packages with the route disabled.** This was the previous state. It keeps the fork closer to upstream, but leaves code that talks to the vendor's account servers one patch line from running, and a mounted service with an OAuth callback listener on every start.

**Migrate stored account selections and settings.** A saved `deepseek-account` model selection already fails its next request with `NO_ADAPTER` and recovers when another model is chosen; stored `searchBilling` and `fetchBilling` keys load and are ignored. Only a stored `provider: deepseek-account` under the translator or reasoning translation fails its plugin's load. The account sign-in never worked in this fork, so that value cannot have translated anything; the upgrade guide names the edit instead of carrying a compatibility mapping.

## Consequences

Gained: no code in the tree contacts `platform.deepseek.com` or `harness.deepseek.com`; DeepSeek is reached only through `api.deepseek.com` with an API key, and web search, translation, and the model UI have one credential path each.

Given up: a DeepSeek account cannot pay for model requests, search, fetch, or translation. A stored account token and device record stay in `$DSH_HOME/.credentials.yaml` until the owner deletes them. The paid-translation web end-to-end test is gone, because the web scaffold cannot mount the real API-key route beside its replayed conversation; the translator's real-Loader tests cover the paid path.

Reintroducing a vendor account needs a new decision covering which servers it contacts and what it may send.

## Verification

`pnpm run typecheck`, `pnpm run constraints`, `pnpm run doc-sync`, and the unit tests of every package that lost an account consumer pass. The `web-search-api-key` session snapshot replays a Search API call that sends `DEEPSEEK_API_KEY` from a non-DeepSeek conversation.
