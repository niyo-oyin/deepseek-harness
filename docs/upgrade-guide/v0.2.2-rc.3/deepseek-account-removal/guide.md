---
kind: upgrade-guide
description: DeepSeek account sign-in, the deepseek-account model route, its packages, and the Web search and fetch billing settings are removed, so DeepSeek is reached only with an API key.
---

# DeepSeek account sign-in removed

## Change

DeepSeek is now reached only with an API key, through the `deepseek-official` route of `@deepseek-ai/dsh-llm-deepseek-api-key`. The packages `@deepseek-ai/dsh-deepseek-account` and `@deepseek-ai/dsh-llm-deepseek-account` are removed, together with `ctx.deepseekAccount`, the `account/*` Remote, the `deepseek-account/*` events, the `deepseek-account` model route, and the failure codes `ACCOUNT_QUOTA`, `ACCOUNT_SIGN_IN_REQUIRED`, and `ACCOUNT_TOKEN_INVALID`. `@deepseek-ai/dsh-llm-deepseek` no longer exports `resolveDeepSeekAccountToken` or `rejectDeepSeekAccountToken`. Desktop no longer embeds the DeepSeek Platform usage and top-up pages, and its `dshPlatform` preload bridge is removed.

The DeepSeek Search and Fetch APIs (`web-deepseek-api`) and legacy Messages search (`web-search-deepseek`) always send the DeepSeek API key. The `searchBilling` and `fetchBilling` settings and the settings page's Billing menu are removed; stored values are ignored. The experimental translator and reasoning translation accept `provider` values `google`, `bing`, and `deepseek-official` only.

Nothing is migrated. A saved model selection on `deepseek-account` fails its next request with `NO_ADAPTER` until another model is chosen. A stored `provider: deepseek-account` under `cot-translation` or `translator` fails that plugin's load, and its settings form disappears until the value is changed.

## Migration

1. Add a DeepSeek API key on the Models page, or export `DEEPSEEK_API_KEY`, and choose a `deepseek-official` model or another provider in the composer, in `agent-default-model`, and in any subagent, auto-review, or compaction model setting that names `deepseek-account`.
2. In your profile patch (`$DSH_HOME/cordis.patch.yml` or the profile's own patch), change `provider: deepseek-account` under the `cot-translation` or `translator` entry to `deepseek-official`, `bing`, or `google`, and delete any `deepseek-account` or `llm-deepseek-account` entry; leftover entries only log `patch: entry "…" not found`.
3. Remove `searchBilling` and `fetchBilling` from the `web-deepseek-api` entry; they have no effect.
4. Delete the stored sign-in: remove the `deepseek-account-platform/default` and `deepseek-account-platform/device` entries under `records:` in `$DSH_HOME/.credentials.yaml`. The store reloads the file automatically.
5. Code that imported the removed packages or exports, listened to `deepseek-account/*` events, or handled the removed failure codes removes that code.
6. Confirm with `dsh --profile headless "hello"` on a `deepseek-official` model with `DEEPSEEK_API_KEY` set: it answers, and the startup log names no missing `deepseek-account` entry.
