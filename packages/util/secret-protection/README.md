---
description: "Operating-system protection for secrets the Harness stores on disk: the Windows Data Protection API binding and the protected spelling of a plugin configuration value."
kind: "package-library"
---

# @deepseek-ai/dsh-secret-protection

## Summary

`@deepseek-ai/dsh-secret-protection` lets a package that writes a secret to disk encrypt it for the current Windows account, and lets the launcher open the secrets stored inside plugin configuration. On Windows a protected secret can be decrypted only by the account that stored it, on that machine. Linux and macOS have no protection here, and callers store secrets as written.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Protecting a secret

```ts
import { loadPlatformProtection } from '@deepseek-ai/dsh-secret-protection'

declare const secret: string

const protection = await loadPlatformProtection() // undefined off Windows
const stored = protection === undefined ? secret : protection.protect(secret)
```

`protect` returns base64 ciphertext and `unprotect` reverses it. `unprotect` throws when the ciphertext is malformed or was protected by another account or machine. Neither call prompts.

### Protected configuration values

A secret inside plugin configuration is stored as a mapping with one member, so it survives any YAML or JSON round trip:

```yaml
config:
  apiKey:
    __dpapi: AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAA…
```

| Function | Use |
|---|---|
| `protectValue(secret, protection)` | Build the mapping to store in place of a secret |
| `isProtectedValue(value)` | Tell a protected value from any other configuration value |
| `openProtectedValues(config, protection, subject)` | Replace every protected value in a configuration with its secret |

`openProtectedValues` walks plain objects and arrays and passes everything else through. A configuration that holds no protected value comes back as the same object. A protected value that cannot be opened throws an error naming `subject` and the field path, never the value; without a `protection` every protected value is refused that way.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Protected configuration values |
| [`src/dpapi.ts`](src/dpapi.ts) | Windows Data Protection API binding |

`loadDpapi` binds `CryptProtectData` and `CryptUnprotectData` from `crypt32.dll` through Koffi and frees each result with `LocalFree`. Koffi is imported on the first call, so a process on another platform never opens a Win32 library. The calls pass `CRYPTPROTECT_UI_FORBIDDEN` and no extra entropy: the Windows account is the whole key.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Local credential store](../../credentials/credentials-local/README.md) — stores keys and grants protected.
- [Settings](../../settings/settings/README.md) — protects secret fields of plugin configuration when a form saves them.
- [Boot package](../../boot/app-boot/README.md) — opens protected configuration values before a plugin reads its configuration.
- [Decision record](../../../.agents/notes/implemented/architecture/2026-11-14-windows-protected-secrets.md) — why the Data Protection API, and what it does not protect against.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is a storage-protection primitive that registers nothing model-facing.

#### KV Cache effect

Nothing here enters a request prefix, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Windows only** — Linux and macOS get no protection from this package.
- **A process running as the same user can decrypt** — the Data Protection API answers any process of the account; this protects a file that leaves the machine or account, not a secret from the user's own processes.
- **Protected values do not move** — ciphertext copied to another machine or Windows account cannot be decrypted there.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
