# Agent Note: Protect stored secrets on Windows with the Data Protection API

Status: implemented

## Problem

The local credential store keeps provider keys, OAuth grants, and plugin secrets in `.credentials.yaml` under the Harness home. On POSIX the file mode keeps other users out, and the store refuses a file they can read. Windows has no mode to check, so the file's only protection there is where it sits. Its secrets are plain text: a backup, a synced folder, a copied home, or one `type` of the file hands every key to whoever reads it, including an agent tool that reads a path it was told about in a prompt.

Plugin configuration has the same gap. A plugin that declares a `role('secret')` field, such as a search provider's API key, has it written into the profile patch as plain text. The settings forms redact such a field on the wire, but not on disk.

## Decision

On Windows the store writes every secret encrypted with the Data Protection API (`CryptProtectData`), bound to the Windows account and machine that stored it, and decrypts on read. A protected secret is a `!dpapi` YAML scalar holding base64 ciphertext. The tag marks each value on its own, so a document may hold protected and plain-text values side by side, and reference names, record keys, and record kinds stay readable.

- Protected: reference values, an `api-key` record's key and environment values, and a `grant` record's payload, stored as the ciphertext of its JSON text.
- A plain-text secret found at boot, on a reload, or beside a value being written is rewritten protected, keeping the entry's comments. This covers documents an earlier build wrote and values added by hand.
- A `!dpapi` value that cannot be decrypted, or one read on a platform without the binding, fails the load with a diagnostic naming the entry and never the value.
- Linux and macOS store values as written, under the existing owner-only mode check.

Secret fields of plugin configuration are protected the same way. When a settings form saves a `role('secret')` field, the profile patch stores `{ __dpapi: <ciphertext> }` in its place. `boot()` registers an `internal/config` hook before any entry mounts that opens these values, so a plugin validates and reads the secret unchanged and needs no code for it. A secret equal to the inherited layer's value is not protected, because the configuration editor removes an override that equals what it inherits. Profile entries that still store secret text are rewritten after startup.

The binding and the protected configuration value live in `dsh-secret-protection`. It calls `crypt32.dll` through Koffi, loaded only on Windows, as the sandbox and filesystem packages already do for their Win32 calls.

## Alternatives considered

**Encrypt the whole file.** One blob hides entry names too, but it ends hand editing, comment preservation, and the entry-level diagnostics the store promises, and a single undecryptable byte would lose every credential.

**Mark protected values with a string prefix.** A prefix is ambiguous with a real secret that starts the same way and cannot mark a `grant` payload, which is arbitrary JSON. A YAML tag is the format's own way to type a scalar.

**Store secrets in Windows Credential Manager.** It keeps secrets out of the file entirely, but it is still readable by any process running as the user, limits a value to 2,560 bytes, which a grant payload can exceed, and splits one document into two stores that must stay consistent across the writer lock.

**Move configuration secrets into the credential store.** A plugin that reads its key from its own configuration would have to be changed to ask the store, which third-party plugins cannot be made to do. Protecting the value where it is stored works for every plugin that declares the field secret.

**Store a configuration secret as a `!!js` expression that decrypts it.** The Loader already evaluates expressions, but the expression would need a decrypting function in scope for every entry, and a secret would then be code in a file rather than data.

**Add a master password.** It would protect against a same-account process, but every start, including headless and SDK launches, would need the password or a place to cache it, which moves the problem.

**Protect Linux and macOS in the same change.** Each needs its own service (Secret Service, Keychain) with its own availability and prompting behavior. The fork runs on Windows, where the gap is widest; the other platforms keep their mode check.

## Consequences

Gained: a copied, synced, or backed-up credential file or profile patch is useless off the machine and account that wrote it, and reading either file no longer yields a key.

Given up: the files are not portable. Moving to another machine or Windows account means storing each credential again; until the undecryptable entries are removed the credential store does not load, and a plugin entry with an undecryptable secret does not start. A secret a plugin keeps in a field it does not declare secret stays plain text. A process running as the user can still call the Data Protection API and decrypt a value; keeping secrets from the agent's own tools needs a read-denying sandbox or a broker process, which this change does not provide.

## Verification

[Credential store tests](../../../../packages/credentials/credentials-local/tests/protect.spec.ts) cover writes of references and both record kinds, protection of a plain-text document at boot and beside a write, comment preservation, and the refusal diagnostics. [Settings tests](../../../../packages/settings/settings/tests/secret-protection.spec.ts) boot a real profile and cover a saved secret, an edit beside it, an inherited secret, plain text protected at startup, and an entry whose secret cannot be opened. [Binding tests](../../../../packages/util/secret-protection/tests/secret-protection.spec.ts) cover the configuration value and a round trip through the real API on Windows. The suites that pin the document's text run with protection absent, which is the POSIX behavior.
