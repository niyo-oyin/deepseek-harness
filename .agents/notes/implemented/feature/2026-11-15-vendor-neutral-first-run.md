# Agent Note: Vendor-neutral default and first run

Status: implemented

## Problem

The shipped profile preselected `deepseek-official` / `deepseek-flash` as every Agent's default model, the Desktop app opened a native welcome window that could store only a DeepSeek key, the Web first-run dialog likewise asked only for the official DeepSeek key, and the Models page listed DeepSeek as always configured, never removable, and pinned first. An owner who uses another vendor met a DeepSeek-shaped first run on every face, a default that pointed at a route they had no key for, and a DeepSeek row they could not take off the page. The product should offer DeepSeek as one provider among many without assuming it.

## Decision

**No shipped default model.** The base bundle mounts [`agent-default-model`](../../../../packages/core/agent-default-model/README.md) without a provider or model. `currentSelection()` answers `undefined` while none is set; `requireSelection()` throws the one shared `NoDefaultModelError`, whose text names both ways to set a default: pick a model in the app, or set `provider` and `model` under `agent-default-model` in the profile. Headless, webhook, Session fork, and schedule's new Sessions raise it where they read the default; `session.prompt` refuses a Session with neither its own model nor a default with code `session/no-default-model` and the same text. Live Session route accessors stay optional and never throw, because many readers (Office, CUA, MCP, spill, image reads) treat the route as optional. The first model picked in the composer becomes the default, as picker choices already did; adding a provider picks no model. A profile that already saved a default keeps it, because the value lives in that profile's own patch.

**Automation entry points use the same default.** The `acp` profile row names no route, so ACP sessions start on the `agent-default-model` selection read at `session/new`; the SDK `initialize` request may omit `provider` and `model` together and then takes that selection. Without a route either fails at that request with a message naming the setting, rather than at the first model request. A composition without `agent-default-model`, such as `sdk-minimal`, requires the route in the request. The SDK server mounts no adapter: the earlier convenience mount covered only DeepSeek, and a name-to-plugin table for every provider would be a second composition mechanism beside profiles, so adapters come only from the profile. `subagent-dsh-sdk` without a configured route starts its child on the parent's current route, as in-process children inherit theirs. `sdk-minimal` keeps the DeepSeek API-key adapter as its one example provider, because the tree has no settings or credential store for a catalog adapter; a patch replaces that row for another provider.

**The composer waits for a pick.** With neither a Session selection nor a default, [ui-model-selection](../../../../packages/client/ui-model-selection/README.md) raises a composer block through ui-conversation's existing composer-block contract. With no provider at all, the seat opens **Settings → Models** through a new optional `settingsNavigation` service instead of an empty picker. A saved route the catalog does not list still sends, as before: that allowance protects selections across a provider's temporary absence, which does not apply to having no selection at all.

**One first-run step on every face.** The Desktop welcome window, its renderer, backend, IPC, preload, copy, and tests are gone; Desktop opens the workspace on every start and reads its startup theme and language through a small preferences reader. The in-app `model-provider` onboarding step runs on the Web page and under the Desktop page global alike: while no provider is usable it shows the Models page's own add-provider panel (`AddProviderPanel`, extracted from the page) with a **Configure later** exit. The `credentialOnboarding` Host switch, which existed so Desktop could suppress the Web step, has no remaining purpose and is removed with the page global it published. The `settings.models.sign-in` slot, the `dshOnboarding` preload bridge, the editor's credential-only mode, and the Host's `initializeDefaultModel` lose their only callers and are removed.

**DeepSeek is an ordinary provider.** It owns its whole `llm-deepseek` section, so its route is always registered and lists no models without a key. The Models page lists it only once its key resolves and offers it in the add card otherwise, where its dedicated editor layout requires the key. Removal clears the key the page stored and the section's user layer. A key from the launch environment keeps it listed without a removal, with the reason shown; a pi-ai route exists only through its settings profile, so the two rules agree that the page lists what can serve and removes only what it wrote. Providers in the Models page and in both pickers sort by display name, then id, with a comparison that does not depend on the machine's locale, shared from `dsh-util-values`.

### The removed welcome window

The native welcome window existed because the design called for native desktop blur behind the whole entry, which Chromium backdrop filters cannot sample, and because credential setup needed one startup owner so a native skip was not followed by a second Web dialog. It deliberately persisted no skip flag, so the next cold start asked again, and it read `locale.preference` before showing. Once the first run is about any provider rather than one key, a native form would have to duplicate the Models page's whole add-provider flow — catalog select, provider editors, custom routes, discovery — outside the Web plugin graph, which is the duplication the [shared-modal decision](../../archived/feature/2026-08-13-shared-modal-product-onboarding.md) rejected for the Web dialog. One in-app step keeps the single-owner property without a second implementation. The native material and the dedicated brand entry are given up. Reintroduce a native entry only for something the Web app cannot render, and have it hand provider setup to the in-app step.

## Alternatives considered

**Keep a vendor-neutral welcome window.** It would reimplement the add-provider flow natively and drift from the Models page; the only gain is native blur.

**Ship a placeholder default route.** A route nobody has a key for fails at the first request with a credential error that names the wrong problem; a missing default is a state the product can explain where it is read.

**Auto-pick a model when the first provider is added.** The owner chooses; a silent pick would decide a cost and capability trade-off for them and would differ by provider catalog order.

**Throw from the live Session accessors when no default is set.** Readers across the tree treat `AgentOptions.provider` as optional; a throwing getter would break unrelated tools. The prompt path and the non-interactive entry points are where a missing default must stop work.

**Keep `credentialOnboarding` for deployments that provision keys another way.** Such a deployment has a usable provider, which already ends the step without rendering, so the switch protects nothing.

**Pin DeepSeek first, or keep registration order.** Pinning is the vendor preference this change removes; registration order varies with concurrent plugin mounting, so it is not stable across starts.

## Consequences

A fresh profile has no model until the owner adds a provider and picks one; every face says so in place. Profiles and fixtures that relied on the shipped default must state their own, which the scaffold and headless snapshots already did. The DeepSeek account plumbing that only the welcome window used is gone; the rest of the account feature was [removed afterwards](../simplification/2026-11-16-remove-deepseek-account.md).

This change does not cover the remaining DeepSeek defaults: the web search default `deepseek-search-api` and the search card's key reference, and the translator and reasoning-translation DeepSeek choices. The Python SDK still sends its own `deepseek-official` / `deepseek-v4-flash` defaults in `initialize`.
