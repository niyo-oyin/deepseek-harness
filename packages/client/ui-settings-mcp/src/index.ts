/**
 * MCP servers page, node half. The empty apply exists so the plugin appears
 * in the host cordis.yml / Loader; the browser half owns the page through
 * exports["./client"], discovered from the package.json dsh.client
 * declaration. The `mcp-manager` namespace the page edits and the Remote
 * namespace it observes are both registered by the MCP manager, so this
 * package registers nothing on the Host.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
