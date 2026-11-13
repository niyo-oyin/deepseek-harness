# Official DeepSeek LLM API wire extensions

This reference defines every DeepSeek Harness-specific HTTP header sent by [`@deepseek-ai/dsh-llm-deepseek`](../packages/llm/llm-deepseek/README.md) on `deepseek-official` Messages requests. It does not redefine fields owned by the upstream DeepSeek API. The request body carries only upstream fields. The provider-neutral LLM interface and `llm-pi-ai` do not implement these additions.

The adapter sends the headers to its resolved `baseURL`, including a configured gateway. They remain outside `messages`, system prompts, and tool schemas, so they do not add model-input tokens or alter the model-visible prefix.

## Wire naming

| Location | Naming | Examples |
|---|---|---|
| HTTP field names | Lowercase kebab-case; HTTP matching remains case-insensitive | `user-agent`, `x-deepseek-harness-session-id` |

## Request headers

| Header | Presence | Value |
|---|---|---|
| `user-agent` | Every provider HTTP request, including Files API operations | Application identity in `product/version (+url)` form, followed by `dsh-profile/<profile>` naming the booted profile, percent-encoded outside `tchar` and for `%` (for example `dsh-profile/desktop`, `dsh-profile/web`, `dsh-profile/sdk`); the default product is `deepseek-harness` |
| `x-deepseek-harness-user-id` | Every authorized model request | The stable anonymous UUID for the resolved Harness home |
| `x-deepseek-harness-session-id` | Model requests carrying a Session id | The exact request `sessionId` string |
| `x-deepseek-harness-compact` | Model requests whose purpose is `compaction` | The literal string `1` |

Credential failure happens before anonymous-user-id resolution, so an unauthorized request neither sends these headers nor creates the identity file. A direct request without a Session omits `x-deepseek-harness-session-id`. Session-title and Auto review requests have no additional purpose header; the ordinary Session-id rule still applies when one carries a `sessionId`.

## Exposure and receiver requirements

The request headers expose the Harness application version, one anonymous Harness-home identity, and an optional Session identity. No Session content leaves the process outside the model request itself. A gateway selected through `baseURL` receives the same values as the official endpoint.
