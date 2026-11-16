---
kind: upgrade-guide
description: The base composition no longer selects the DeepSeek Search API for web search, and search no longer substitutes another ready provider for the selected one.
---

# No default web search provider

## Change

Previously the base composition set `web.searchProvider: deepseek-search-api`, and when that provider had no key, search used the only other ready provider instead, such as an installed Exa plugin.

Now the base composition sets no `searchProvider`. Without a selection in settings, in a profile, or in `DSH_WEB_SEARCH_PROVIDER`, search uses the one registered provider that is set up (available and ready). With none or several set up, search has no selection and models do not get `web_search`; a direct `ctx.web.search()` fails with `WEB_PROVIDER_UNAVAILABLE` or `WEB_PROVIDER_AMBIGUOUS`. A selected provider is never replaced by another one: when it has no key, `web_search` is withheld.

Who is affected:

- A user with only a DeepSeek key: both the DeepSeek Search API and DeepSeek (legacy) are set up, so web search is off until one is chosen.
- A user with one other search provider and no DeepSeek key: no change; that provider serves.
- A user with another search provider and a DeepSeek key: web search is off until one is chosen.
- A stored selection, including `searchProvider: deepseek-search-api` saved from the settings page, keeps working.

The Web search and fetch settings page shows **Automatic** for Search with a line explaining this rule, instead of showing DeepSeek Search API as selected.

## Migration

1. Choose a provider under **Plugins > Built-in plugin settings > Web search and fetch > Web search provider** and save, or add it to your profile patch (`$DSH_HOME/cordis.patch.yml` or the profile's own patch):

   ```yaml
   - id: web
     config:
       searchProvider: deepseek-search-api
   ```

   Headless, SDK, and ACP runs can set `DSH_WEB_SEARCH_PROVIDER=deepseek-search-api` instead.
2. Code that called `ctx.web.search()` without a configured provider and expected a provider without a key to be skipped in favor of another one sets `searchProvider` explicitly.
3. Confirm: the settings page shows the chosen provider, and a model step lists `web_search`.
