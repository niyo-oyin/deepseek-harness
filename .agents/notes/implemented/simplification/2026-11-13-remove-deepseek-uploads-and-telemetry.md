# Agent Note: Remove DeepSeek uploads, telemetry, and product analytics

Status: implemented

## Problem

This distribution is a personal fork that must not send conversation data, usage events, or account traffic to the vendor's services. Upstream composed several channels for that: a default-on Session-log upload riding on DeepSeek requests, an explicit-feedback upload over OpenTelemetry, product analytics from the Web and Desktop shells, and the account UI that drove the vendor login. The fork first switched their bundle rows off with `disabled: true` patches. The packages, their consumers, and their documentation stayed in the tree, so every gate, test run, and reader still paid for code the product never ran, and a patch removed by accident would turn an upload back on.

## Decision

The channels are deleted, not disabled. The removed packages are:

- **Session-log upload:** `session-log-deepseek` and the `deepseek-llm-api-extensions` registry it and `plugin-package-inventory-deepseek` contributed request-body fields through. `llm-deepseek` sends its native serialized body unchanged, and `dsh-llm` has no `REQUEST_EXTENSION` error code.
- **Telemetry:** `session-telemetry`, `session-telemetry-otel`, `product-telemetry-otel`, and the shared `otel` service, with the `DSH_TELEMETRY_*` switches and the profile patch that read them.
- **Product analytics:** `client-product-analytics`, every `track` call in the `ui-*` packages, the Desktop launch, update, and welcome-window events, and code that existed only to feed them, such as the `onCreated` observer of a Session fork.
- **Account UI:** `ui-settings-account`, `ui-account-notifications`, and `ui-settings-session-log`.

What remains is local:

- The canonical feedback events stay in the Session log; the [canonical feedback log](../architecture/2026-09-05-canonical-feedback-log.md) owns them, and nothing delivers them.
- The persisted `session-log-deepseek/delivery-accepted` event keeps its shape in the core `SessionEventMap`, because existing logs contain it and the finalized format digests cover it. No plugin appends it.
- The `deepseek-account` and `llm-deepseek-account` packages stay, and the base bundle patch keeps the vendor account route disabled.
- DeepSeek model requests still carry the anonymous user id and Session id headers that the `llm-deepseek` adapter sets.

The decisions that built the removed channels are archived: [request extensions](../../archived/architecture/2026-08-21-deepseek-llm-api-request-extensions.md), [default Session-log upload](../../archived/architecture/2026-09-14-session-log-upload-default.md), [bounded upload](../../archived/architecture/2026-09-24-bounded-session-log-upload.md), [explicit-feedback OTel](../../archived/architecture/2026-09-05-nonofficial-feedback-otel.md), and [Session-log OTLP limits](../../archived/architecture/2026-09-25-session-log-otel-byte-limits.md).

## Alternatives considered

**Keep the packages behind `disabled: true` patches.** This keeps the fork closer to upstream, but leaves upload code one configuration line away from running and keeps its tests, documentation, and dependency weight. Upstream changes are taken selectively at the feature level, so a smaller diff does not make merging cheaper.

**Point the channels at a local collector.** Nobody reads the data in a personal deployment, and a collector adds a service to run without serving a user.

**Remove the feedback controls too.** The Like/Dislike controls and `/feedback` still write the canonical events, which a Session export carries. Whether a local-only judgment is worth the controls is a separate product question.

## Consequences

Gained: no code path in the tree uploads Session logs, feedback, or usage events; no workspace package depends on OpenTelemetry anymore; and `verify-product-use` no longer needs exceptions for unmounted vendor packages.

Given up: the vendor no longer receives logs or feedback that could improve its models, and the fork has no usage data of its own. Recorded SDK snapshots that captured `delivery-accepted` events keep them until a live re-record.

Reintroducing a channel needs a new decision covering consent, destination, and redaction; the archived notes record the upstream design.

## Verification

`pnpm run typecheck`, `pnpm run constraints`, `pnpm run verify-product-use`, `pnpm run doc-sync`, and the unit tests of every package that lost a consumer pass. The Web end-to-end specs open settings through the Settings button rather than the removed account menu.
