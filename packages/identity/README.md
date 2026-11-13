---
description: "The identity package group: anonymous, per-harness-home correlation ids shared by feedback and DeepSeek provider requests."
kind: "package-group"
---

# identity/ — shared identity

## Summary

The identity group provides one anonymous id per harness home that the installation's feedback and DeepSeek requests attach to their records, so everything leaving one home can be recognized as coming from the same installation without identifying the user. There is nothing to configure: the id appears automatically the first time one of those features runs and stays stable until its file is deleted. The group has one package; this page maps it, and the package README owns the details.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.md) | Gives every harness home one anonymous id that feedback and DeepSeek requests attach to their records, so records from one installation can be recognized without identifying the user |

<a id="related-documentation"></a>
## Related documentation

- [dsh-llm-deepseek](../llm/llm-deepseek/README.md) — the DeepSeek provider that carries the id on requests.
- [dsh-command-feedback](../feedback/command-feedback/README.md) — the feedback command that names the anonymous installation in its acknowledgement.
- [Feedback subsystem](../../docs/subsystems/feedback.md) — the feedback records and acknowledgement that carry the id.

<a id="dev-note"></a>
## Dev Note

None.
