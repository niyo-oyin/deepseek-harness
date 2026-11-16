---
kind: upgrade-guide
description: The ACP profile, the SDK server and clients, and the SDK subagent backend no longer default to a DeepSeek provider and model, and the SDK server no longer mounts the DeepSeek adapter itself.
---

# No DeepSeek route in ACP and SDK defaults

## Change

Previously the `acp` profile created sessions on `deepseek-official` / `deepseek-v4-flash`; the TypeScript `DeepSeekHarness` sent the same pair when `provider` and `model` were omitted; `@deepseek-ai/dsh-subagent-dsh-sdk` defaulted its `provider` and `model` config to it; and `initialize` on `@deepseek-ai/dsh-sdk-jsonrpc-server` mounted `@deepseek-ai/dsh-llm-deepseek-api-key` when `deepseek-official` had no registered adapter.

Now:

- The `acp` row sets no `provider` or `model`. ACP sessions start on the profile's `agent-default-model` selection; without one, `session/new` fails with a message naming both settings. Setting only one of `provider` and `model` on the `acp` row fails at load.
- `InitializeParams.provider` and `model` are optional and set together. Omitting both uses the profile's `agent-default-model` selection; a profile without one, such as `sdk-minimal`, rejects the handshake. `DeepSeekHarness` omits both when neither option is set and throws `TypeError` when only one is.
- The SDK server mounts no adapter. A provider that no adapter in the composition serves fails `initialize` with `no adapter registered for provider "…"`, including `deepseek-official`.
- `subagent-dsh-sdk` without `provider` and `model` publishes no `agentRouteDefaults` and starts each child on the delegating parent's current route.

The Python SDK still sends its own `provider` / `model` defaults and is unaffected.

## Migration

1. ACP: add a default to `$DSH_HOME/profiles/acp/cordis.patch.yml` (or a `--patch` file), or set `provider` and `model` on the `acp` row:

   ```yaml
   - id: agent-default-model
     config:
       provider: deepseek-official
       model: deepseek-flash
   ```

2. TypeScript SDK: pass both `provider` and `model` to `new DeepSeekHarness({...})`, or set `agent-default-model` in the `sdk` profile as in step 1. Code that passed only `model` adds `provider`.
3. Compositions that relied on the SDK server mounting the DeepSeek adapter add an `@deepseek-ai/dsh-llm-deepseek-api-key` row (the `sdk` profile already has one through the base bundle).
4. `subagent-dsh-sdk` rows that relied on the DeepSeek default set `provider` and `model`, or leave both unset to follow the parent.
5. Confirm: `dsh --profile acp` answers `session/new` with a session id, and an SDK `run('hello')` completes; a missing route reports the setting to change instead of contacting DeepSeek.
