/**
 * Skills page, node half. The empty apply exists so the plugin appears in the
 * host cordis.yml / Loader; the browser half owns the page through
 * exports["./client"], discovered from the package.json dsh.client
 * declaration. The `skill` namespace the page edits is the skill registry's,
 * and the Remote namespace it calls is the skill manager's, so this package
 * registers nothing on the Host.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
