/** Build the notarized DMG from an already signed and smoke-tested application. */

import { mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { packagingStep } from './packaging-step.mjs'
import { resolveMacOSSigningEnvironment } from './desktop-release-environment.mjs'
import { verifyMacOSSignature } from './verify-macos-signature.mjs'

/** One electron-builder DMG made from an already signed application. */
export interface DesktopPrepackagedArtifact {
  readonly appPath: string
  readonly output: string
}

/** A signed macOS directory build and its final release destination. */
export interface MacOSDiskImageRequest {
  readonly arch: 'arm64' | 'x64'
  readonly version: string
  readonly artifactsRoot: string
  readonly environment: NodeJS.ProcessEnv
}

/** Apple-tool operations replaced by deterministic fixtures in orchestration tests. */
export interface MacOSDiskImageOperations {
  readonly verifySignature: typeof verifyMacOSSignature
}

const operations: MacOSDiskImageOperations = { verifySignature: verifyMacOSSignature }

/**
 * Build the DMG in a private directory and promote it only after it is complete.
 * The DMG carries its own notarization ticket and encloses the signed App without an individually stapled ticket.
 * @param request - Signed directory build, release version, architecture, and signing identity.
 * @param build - Runs electron-builder with publishing disabled; resolves only after its DMG
 * notarization and verification hook succeeds, and rejects on build or hook failure.
 * @param apple - Apple signature verification.
 * @returns Resolves after the qualified DMG is in the final directory.
 */
export async function packageMacOSDiskImage(
  request: MacOSDiskImageRequest,
  build: (artifact: DesktopPrepackagedArtifact) => Promise<void>,
  apple: MacOSDiskImageOperations = operations,
): Promise<void> {
  const { arch, version, artifactsRoot, environment } = request
  const secrets = Object.entries(environment).filter(([name]) => /KEY|SECRET|TOKEN|PASSWORD|APPLE_ID/iu.test(name)).map(([, value]) => value ?? '')
  const expected = resolveMacOSSigningEnvironment(environment)
  const appPath = join(artifactsRoot, arch === 'arm64' ? 'mac-arm64' : 'mac', 'DeepSeek Harness.app')
  const output = await mkdtemp(join(dirname(artifactsRoot), 'notarization-'))
  const filename = `deepseek-harness-${version}-mac-${arch}.dmg`
  try {
    apple.verifySignature(appPath, expected)
    const start = performance.now()
    process.stdout.write(`desktop macOS packaging: DMG creation and notarization started at ${new Date().toISOString()}\n`)
    await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'DMG creation and notarization',
      () => build({ appPath, output }), secrets)
    process.stdout.write(`desktop macOS packaging: DMG creation and notarization completed in ${((performance.now() - start) / 1000).toFixed(2)}s\n`)
    apple.verifySignature(appPath, expected)
    const file = join(output, filename)
    const details = await stat(file)
    if (!details.isFile() || details.size === 0) {
      throw new Error(`desktop macOS packaging: missing or empty artifact ${file}`)
    }
    await rename(file, join(artifactsRoot, filename))
  } finally {
    await rm(output, { recursive: true, force: true })
  }
}
