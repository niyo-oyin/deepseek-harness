/** Resolve a manual Windows build version, validate the selected machine preset, and name the installer to retain. */
import { appendFileSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { desktopCiVersion as windowsCiVersion } from './desktop-ci-version.mjs'
export { desktopCiVersion as windowsCiVersion } from './desktop-ci-version.mjs'
import { desktopInstallerPath } from './desktop-build-paths.mjs'
import { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } from './desktop-package-environment.mjs'
import { resolveWindowsPackageSettings } from './windows-package-settings.mjs'

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const appRoot = resolve(import.meta.dirname, '..')
  const product = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8'))
  const version = windowsCiVersion(process.env, product.version)
  const mode = process.env.PACKAGE_SIGNING
  if (mode !== 'unsigned' && mode !== 'signed') throw new Error('Select unsigned or signed packaging')
  if (!process.env.DSH_PACKAGING_PRESET) throw new Error('Select a machine preset')
  const environment = loadDesktopPackageEnvironment('win32', process.env, appRoot, { unsigned: mode === 'unsigned' })
  // Machine-owned secrets are not automatically known to the Actions log masker.
  for (const [name, value] of Object.entries(environment)) {
    if (/TOKEN|PASSWORD|SECRET/iu.test(name) && value) {
      const escaped = value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
      process.stdout.write(`::add-mask::${escaped}\n`)
    }
  }
  validateDesktopPackageEnvironment(environment, { platform: 'win32', arch: 'x64' }, { unsigned: mode === 'unsigned' })
  console.log(`Windows installer compression level: ${resolveWindowsPackageSettings(environment).compressionLevel}`)
  if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY) throw new Error('Run this adapter from GitHub Actions')
  const installer = desktopInstallerPath('win-x64', version, { unsigned: mode === 'unsigned', skipNotarization: false }, environment)
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ninstaller=${installer}\ninstaller-name=${basename(installer)}\n`)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Windows x64 ${mode} installer\n\nVersion: ${version}\n\nCommit: ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\n\nSource: ${process.env.PACKAGE_SOURCE_REF}\n\nPreset: ${process.env.DSH_PACKAGING_PRESET}\n`)
}
