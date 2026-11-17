---
kind: upgrade-guide
description: The shipped default model, the Desktop welcome window, and the credentialOnboarding switch are removed, so profiles that relied on the default must name a model.
---

# No shipped default model or Desktop welcome window

## Change

The base bundle no longer sets `agent-default-model` to `deepseek-official` / `deepseek-flash`. Until a profile sets one or the owner picks a model in the composer, there is no default: headless runs, webhook Sessions, Session forks, scheduled deliveries into a new Session, and `session.prompt` from a Session without its own model fail with `NoDefaultModelError` (`session/no-default-model` on the wire), which says how to set one. `ctx.agentDefaultModel.currentSelection()` may return `undefined`; `requireSelection()` throws instead. `ModelCatalog.default` is optional.

Desktop no longer shows a native welcome window; it opens the workspace and the in-app `model-provider` step offers every addable provider. The step id `deepseek-official`, the `credentialOnboarding` option of `@deepseek-ai/dsh-client-ui-settings-models` and its page global, the `settings.models.sign-in` slot, the Desktop `dshOnboarding` preload bridge, and the `session/initializeDefaultModel` Remote are removed. DeepSeek is listed on the Models page only once its key resolves, is removable, and is no longer sorted first.

## Migration

1. A profile, SDK host, or test fixture that relied on the shipped default adds its own row to its `cordis.patch.yml`:

   ```yaml
   - id: agent-default-model
     config:
       provider: deepseek-official
       model: deepseek-flash
   ```

   A profile that already saved a default through the composer keeps it.
2. Callers of `currentSelection()` that need a route call `requireSelection()`, or handle `undefined`.
3. Remove `credentialOnboarding` from the `ui-settings-models` row; it is no longer accepted.
4. Replace code that registered `settings.models.sign-in`, called `initializeDefaultModel`, read `dshOnboarding`, or opened the onboarding step `deepseek-official` (now `model-provider`).
5. Confirm with `dsh --profile headless "hello"`: it runs, or it ends before reading the task with the message naming both ways to set a default.
