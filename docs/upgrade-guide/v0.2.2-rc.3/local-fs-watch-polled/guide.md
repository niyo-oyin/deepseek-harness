---
kind: upgrade-guide
description: "The local filesystem polls watched targets instead of opening OS watches, so changes arrive within a second, and a directory watch no longer reports writes into an existing entry."
---

# Local filesystem watches are polled

## Change

`ctx.fs.watch()` on the local backend (`@deepseek-ai/dsh-fs-local`, and `@deepseek-ai/dsh-fs-sandbox`, which extends it) opened a Chokidar watch on a directory target, or on the parent directory of a file target. On Windows, a process that holds a directory open prevents every ancestor of that directory from being renamed or moved, so a folder shown in the Files sidebar or a previewed file kept its ancestors in place until the application quit.

The backend now reads the target's version once a second and reports each difference, opening nothing. As a result:

- A change is reported up to one second after it happens instead of within milliseconds. Changes made through the file tools still invalidate at once through `fs/observed`.
- A directory target reports direct entries appearing, disappearing, and being renamed. It no longer reports a write into an existing entry; a watch on that entry reports it. The `FileSystem.watch` contract states this for every provider.
- A file target is also reported when its parent directory is removed and created again, on every platform.
- A read that fails while watching is reported to the callback and the watch continues.
- `@deepseek-ai/dsh-fs-local` no longer depends on `chokidar`.

`workspaceFiles.changes` follows the same rules, since it watches through `ctx.fs`.

## Migration

1. If a plugin watches a directory through `ctx.fs.watch()` or `workspaceFiles.changes` to learn that an existing file's content changed, watch that file instead.
2. If a plugin or test expects an invalidation within milliseconds of an external change, allow up to one second.
3. Confirm on Windows: with a folder expanded in the Files sidebar and one of its files open in the preview, rename the folder's parent directory from Explorer; the rename succeeds while the application is running.
