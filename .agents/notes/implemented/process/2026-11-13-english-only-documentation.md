# Agent Note: English-only documentation in the fork

Status: implemented

## Problem

This repository is a personal fork of DeepSeek Harness. Upstream keeps every in-scope Markdown document as an English/Chinese pair with a consistency sidecar, a pairing check, a translation prompt and briefing tools, a terminology list, and a Chinese website locale ([upstream decision](../../archived/process/2026-07-02-bilingual-docs-and-pairing-gate.md)). In the fork, the Chinese side has no reader. Every documentation edit still paid for a counterpart update, a re-recorded sidecar, and the related gates, and the pair rules shaped templates, skills, generators, and hooks.

## Decision

- Documentation in the fork is written in English only. Each document is one English file; no translated copy, consistency sidecar, or language-switcher line exists.
- Chinese document counterparts (`*.zh.md`), pairing sidecars (`*.i18n.yaml`), the pairing and translation-prompt checks and their Git hooks, the translation briefing tools, the `docs/i18n/` translation guidelines and terminology list, and the `dsh-translate-docs` skill are deleted. Generators emit English output only, and the documentation website has one English locale at the root route.
- Product localization is out of scope of this decision and stays: the eight runtime UI languages and their locale dictionaries, and a plugin bundle's localized detail document and preview image (`docs/DETAIL.zh.md`, `docs/preview.zh.svg`, `meta.detail` in `locale/zh.json`).
- Archived Agent Notes keep their sealed content; the archive seals only the English note files.

## Alternatives considered

**Keep the pairs and stop updating the Chinese side.** Stale counterparts would contradict the English files, and the pairing check would fail or need a permanent exemption. Deleting them leaves no wrong documentation behind.

**Keep the pairing machinery for a later Japanese locale.** The fork owner may add Japanese-facing documentation later, but the pair machinery encodes upstream's Chinese workflow (terminology, prompt, line-aligned review). A future locale is designed for its own readers when it is needed, not inherited from this one.

**Track upstream's bilingual workflow to ease merges.** The fork adopts upstream changes selectively at the feature level rather than by merging whole trees, so documentation divergence costs little; keeping the pairs would cost every documentation change.

## Consequences

A documentation change touches one file and runs no pairing or translation check. Upstream documentation changes are adopted in English only; their Chinese counterparts are not carried over. Chinese-speaking readers have no translated documentation in the fork. The gate speedups recorded for the pairing check in [local gate speedups](2026-10-12-local-gate-speedups.md) describe a check that no longer exists in the fork; the other speedups in that note still apply.
