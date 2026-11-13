---
description: "Confirmation before a shell command runs git push, for users and maintainers choosing, configuring, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-push-guard

## Summary

While this plugin is mounted, a shell command that runs `git push` does not start until the user confirms it in the conversation. The question shows the exact command. Every other command, and every other tool, is unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh-web-app` bundle mounts the plugin as the row `git-push-guard`, so the desktop and Web applications have it without configuration. It has no settings: the guard is on while the row is on. To let pushes run without the question, disable the row in the profile's `cordis.patch.yml` (the Plugins page lists installed bundles, not the rows of the built-in ones):

```yaml
- id: git-push-guard
  disabled: true
```

### What you get

When the agent calls `bash`, `pwsh`, or `terminal_send` with a command line that runs `git push`, the conversation shows an approval card with the command and two actions, Push and Do not push. Push lets the call continue through the rest of the tool pipeline. Do not push, or closing the question, keeps the command from running and tells the model the user declined.

The question uses the user-questions channel rather than the approval policy. A permission preset whose approval policy is `never`, such as full access, rejects every approval request without prompting, so a guard built on it could only block. The question channel reaches the user under every preset.

A push nobody can confirm does not run: a subagent's push is denied with a message telling it to report the intended push to the agent that started it, and a composition without a question answerer (a headless run) denies every push while the row is on.

<a id="understand-the-implementation"></a>
## Understand the implementation

[`src/index.ts`](src/index.ts) listens on `tools/pre-execute`. For the three shell tools it reads the command line argument (`command`, or `text` for `terminal_send`) and asks [`runsGitPush`](src/push-command.ts). A match asks `ctx.userQuestions.ask` with an `approval` intent; the answer `Push` delegates to `next()`, any other answer denies, and a call cancelled while the question is open returns `cancel`.

`runsGitPush` splits the command line into simple commands at control operators, grouping characters, and backquotes, with quotes grouping words. In each simple command it looks for the Git executable at any position (bare, with a directory, with a Windows suffix), skips Git's global options, and compares the subcommand with `push`. Searching every position covers `sudo`, `env`, `time`, variable assignments, and PowerShell's call operator without a list of wrappers. A quoted word that holds several words is scanned as a command line of its own, which covers `bash -c "…"`, `pwsh -Command "…"`, `cmd /c "…"`, `eval`, and `Invoke-Expression`.

The scan errs toward asking. `echo git push` is reported although it runs nothing, because an unneeded question costs one click and a missed push cannot be undone.

<a id="model-experience"></a>
## Model Experience

### Conditional tool result

#### What the model sees

Only a blocked push produces model-visible text: the denied shell call's error is one of the three literals below, chosen by why the push did not run. The plugin adds nothing to the system prompt or the tool schemas.

##### The user declined the push

```markdown
Git push guard: the user declined this push, so the command did not run. Do not push again unless the user asks for it.
```

##### A subagent attempted the push

```markdown
Git push guard: a subagent cannot ask the user to confirm a push, so the command did not run. Report the push you intended to the agent that started you.
```

##### Nobody could be asked

```markdown
Git push guard: the user could not be asked to confirm this push, so the command did not run.
```

#### Token effect

About 30 tokens per blocked push; none otherwise.

#### KV Cache effect

Append-only: the text is a tool result at the end of the conversation, and the request prefix is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A push the command text does not show is not seen** — a Git alias, a script or a Makefile target that pushes, `gh pr merge`, a base64 `-EncodedCommand`, and a push typed into an interactive program are not recognised.
- **Other ways to publish are out of scope** — `git send-pack`, `gh release create`, and package publishing commands run unasked.
- **One switch for every Session, in a file** — the guard is on or off for the whole profile through its patch file; there is no per-Session toggle and no control in the application.
- **The question blocks the turn** — the agent waits until the user answers, as with any approval card.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
