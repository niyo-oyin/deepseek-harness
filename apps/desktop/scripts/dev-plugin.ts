/**
 * Manage the plugins of the development Desktop profile from the workspace. The ordinary CLI reserves
 * the `desktop` profile for an installed Desktop; this launcher grants the same access for the profile
 * under the development home only. Quit the development application before changing its plugins.
 *
 * Usage, from the repository root: `pnpm run dev:desktop:plugin add <package>` (also `remove`, `list`).
 * The CLI source resolves workspace packages through the root tsconfig, so the launch starts at the root.
 */

import { join, resolve } from 'node:path'
import { runCli } from '../../cli/src/bin.ts'

const DEVELOPMENT_ROOT = join(resolve(import.meta.dirname, '..'), '.desktop-build', 'development')

const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
if (!home.startsWith(DEVELOPMENT_ROOT)) {
  throw new Error(`desktop development: plugin commands accept only a home under ${DEVELOPMENT_ROOT}, got ${home}`)
}
process.env.DSH_HOME = home
process.argv.splice(2, 0, 'plugin', '--profile', 'desktop')
await runCli({ manageDesktopProfile: true })
