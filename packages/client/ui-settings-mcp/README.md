---
description: "MCP servers page of the dsh web client's Plugins page, for users adding or debugging MCP servers and maintainers changing the page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp

## Summary

This package adds the **MCP servers** page to the Plugins page's built-in settings. It lists the servers of the [MCP manager](../../mcp/mcp-manager/README.md) with their live status, and lets the user add, change, enable, test, restart, and remove one. A change takes effect at once, without restarting the application, and the page is available in all eight interface languages.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh-web-app` bundle mounts the page as the row `ui-settings-mcp`. It appears as the **MCP servers** card under the Plugins page's built-in settings while the Host serves the manager's settings namespace (`mcp-manager`); a deployment without the manager shows no card.

### What the page shows

Each server is one row: its name, where the entry lives, its live status, and the command or URL it runs.

| Where the entry lives | Meaning | Controls |
|---|---|---|
| This profile | Stored in this profile's configuration | Switch, Test, Restart, Edit, Remove |
| Built in | Shipped by the deployment's composition | Switch, Test, Restart, Edit (stored as an override in this profile) |
| From a plugin | Registered by an installed plugin for as long as it runs | Restart only |

The status comes from the manager's live list: connected with the number of tools, connecting, reconnecting with the attempt count and the last error, waiting for credentials, failed, disabled, or stopped. The page follows that list only while it is on screen.

**Test** connects to the server without touching the running instance and reports the tools it offers, or why it could not connect. A disabled server can be tested, which is how to try an entry before switching it on. **Restart** replaces the running instance, which also recovers a server whose reconnect attempts ran out.

### Adding or changing a server

**Add server** opens the editor. The name namespaces the server's tools, so it cannot be changed afterwards; remove the server and add it again to rename it.

| Connection | Fields |
|---|---|
| Local command | Command, arguments (one per line), environment variables (`NAME=value` per line), working directory |
| HTTP | URL, request headers (`Name: value` per line) |

A value in the environment variables, the headers, the command, the arguments, the working directory, or the URL may be written as `${credential:NAME}` to use a stored credential. Everything typed here is stored as written in the profile's configuration, so write a secret as such a reference and not as the value itself.

The editor explains a draft it cannot write: a name outside letters, digits, `-` and `_` or longer than 32 characters, a name already in use, a missing command or URL, and a line that is not a pair. The Host validates every write as well; a refused write leaves the editor open.

<a id="understand-the-implementation"></a>
## Understand the implementation

[`McpServersController`](src/client/controller.ts) joins two sources. The configured entries come from `ctx.configForms.get('mcp-manager')`: the resolved `servers` map gives the rows, and the raw user layer tells a profile entry from a built-in one. The live list comes from `ctx.remote.mcpManager.watch`, opened when the first page mounts and disposed when the last one unmounts; a server it lists without a settings entry is a plugin's.

Writes are path edits on the `servers` map. The switch sets `servers.<name>.enabled`, a removal unsets `servers.<name>`, and the editor sets its seven fields under `servers.<name>` in one write. The fields the page does not edit (timeouts, the reconnect policy) are never written, so an edit keeps them. Every field of the other connection kind is written empty, because the Host refuses an entry that carries the other kind's fields and an omitted field would keep a built-in entry's value.

[`mcp-entry.ts`](src/client/mcp-entry.ts) converts between a stored entry and the editor's text. [`McpServersCard.tsx`](src/client/McpServersCard.tsx) renders the Plugins page's two views: the one-line summary and the page.

<a id="model-experience"></a>
## Model Experience

None directly. The page registers nothing model-facing; the servers it configures add their tools to requests through the MCP manager and `dsh-mcp-client`, as those packages document.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No credential editor** — the page accepts `${credential:NAME}` references but does not create the credential; store it through the credentials provider.
- **A refused write carries no reason** — the settings write reports acceptance only, so the page says the entry was not accepted without naming the field the Host rejected.
- **Timeouts and the reconnect policy are not editable here** — they keep their stored or default values; edit them in the profile's configuration file.
- **A server cannot be renamed** — its name is the namespace of its tools.
