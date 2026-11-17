/**
 * Resolve the version one build carries, which is not always the version the
 * repository declares.
 *
 * Desktop CI version mode `build-number` uses UTC date, workflow run number and attempt as
 * `.YYYYMMDD.run.attempt`; these identify CI builds, not release sequences.
 *
 * A production build carries the version in the manifests, aligned with the
 * `dsh` npm package. A test build carries a version that appends a date and a
 * sequence number, so several builds of a single product version stay
 * distinguishable: `0.1.6-alpha.1.20260916.1` from a prerelease base and
 * `0.1.6-test.20260916.1` from a stable one, as the release versions table in
 * `apps/desktop/packaging/README.md#release-versions` gives them. Passing that version here keeps it out
 * of the manifests, so the tracked version stays the product's while the build
 * version reaches electron-builder, the artifact names and the installed
 * `app.getVersion()` as one input.
 *
 * Validation accepts only a semver version without build metadata that repeats
 * the product version's prerelease fields, or `test` for a stable product
 * version, before its own date and sequence. Every installer name and installed
 * version therefore names the product version it was built from, and the stable
 * form keeps `-test` in the name so a test build cannot pass for the production
 * release.
 */

import { parse } from 'semver'

/** Environment variable that carries the build version through one packaging run. */
export const DESKTOP_BUILD_VERSION_ENV = 'DSH_DESKTOP_BUILD_VERSION'

/** Prerelease field that opens a test build's suffix on a stable product version. */
const STABLE_TEST_FIELD = 'test'

/**
 * Parse a semantic version without build metadata.
 * @param {string} version - Version to read.
 * @param {string} label - Description used in failures.
 * @returns {import('semver').SemVer} The parsed version.
 */
function parseVersion(version, label) {
  const parsed = parse(version, { loose: false })
  if (parsed === null) throw new Error(`desktop build version: ${label} ${version} is not a version`)
  if (parsed.build.length > 0) {
    // Build metadata does not participate in precedence, so two builds would compare equal.
    throw new Error(`desktop build version: ${label} ${version} cannot carry build metadata`)
  }
  return parsed
}

/**
 * The prerelease fields every build version for one product version starts with.
 * @param {import('semver').SemVer} product - Parsed product version.
 * @returns {readonly (string | number)[]} Fields a build version must repeat before its date.
 */
function requiredFields(product) {
  return product.prerelease.length === 0 ? [STABLE_TEST_FIELD] : product.prerelease
}

/**
 * Validate a build version against the product version it extends.
 * @param {string} buildVersion - Version this build carries.
 * @param {string} productVersion - Version the manifests declare.
 * @returns {string} The version as semver normalizes it, which is what the artifacts will carry.
 */
export function validateDesktopBuildVersion(buildVersion, productVersion) {
  const build = parseVersion(buildVersion, 'build version')
  const product = parseVersion(productVersion, 'product version')
  if (build.version === product.version) return build.version
  if (build.compareMain(product) !== 0) {
    throw new Error(`desktop build version: ${buildVersion} must extend product version ${productVersion}`)
  }
  const required = requiredFields(product)
  const extendsProduct = build.prerelease.length > required.length
    && required.every((field, index) => build.prerelease[index] === field)
  if (!extendsProduct) {
    throw new Error(`desktop build version: ${buildVersion} must extend ${productVersion} as ${
      desktopBuildVersionPrefix(productVersion)}<date>.<sequence> or ${
      desktopBuildVersionPrefix(productVersion)}<date>.<run>.<attempt>`)
  }
  return build.version
}

/**
 * Resolve the version a build carries.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {string} productVersion - Version the manifests declare.
 * @returns {string} The build version when one is present, otherwise the product version.
 */
export function resolveDesktopBuildVersion(env, productVersion) {
  const buildVersion = env[DESKTOP_BUILD_VERSION_ENV]?.trim()
  if (buildVersion === undefined || buildVersion === '') return productVersion
  return validateDesktopBuildVersion(buildVersion, productVersion)
}

/**
 * Everything a build version carries before its date, including the trailing separator.
 * @param {string} productVersion - Version the manifests declare.
 * @returns {string} The prefix shared by every build version of that product version.
 */
export function desktopBuildVersionPrefix(productVersion) {
  const product = parseVersion(productVersion, 'product version')
  const [release] = product.version.split('-')
  return `${release}-${requiredFields(product).join('.')}.`
}
