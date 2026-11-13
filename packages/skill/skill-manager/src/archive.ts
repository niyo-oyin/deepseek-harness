/**
 * Skill bundles as ZIP archives: a skill's folder — `SKILL.md` and every
 * resource beside it — packed for export, and unpacked from an archive that
 * holds one skill or several.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import type { SkillImportRefusal } from './types.ts'

/** Largest archive accepted or produced, in bytes. */
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
/** Largest total size of an archive's files once unpacked, in bytes. */
export const MAX_UNPACKED_BYTES = 256 * 1024 * 1024
/** Most files one archive may hold. */
export const MAX_ARCHIVE_FILES = 10_000

const SKILL_FILE = 'SKILL.md'
/** Characters no path segment may carry: Windows cannot store them, and a control character is never a file name. */
const FORBIDDEN_IN_SEGMENT = /[<>:"|?*\u0000-\u001f]/u
/** Names Windows reads as devices, with or without an extension: a write to one never reaches a file. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu

/** One file of a skill bundle. */
export interface BundleFile {
  /** Path inside the skill's folder, `/`-separated. */
  path: string
  data: Uint8Array
}

/** One skill found in an archive. */
export interface ArchivedSkill {
  /** The archive folder that holds the skill's `SKILL.md`, `/`-separated; `''` when it sits at the archive's top. */
  folder: string
  /** Every file of that folder, `SKILL.md` included. */
  files: BundleFile[]
}

/** A bundle over a size or count limit, on the way in or out. */
export class ArchiveLimitError extends Error {}

/** An archive whose entries cannot all be stored as the files they name. */
class ArchivePathError extends Error {}

/**
 * Whether a file or folder name can be stored the same way on every platform.
 * @param name - one path segment, or a skill name about to become a folder.
 * @returns false for an empty or relative segment, a forbidden character, a Windows device name, and a name
 *   ending in a dot or a space, which Windows drops.
 */
export function isStorableName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !FORBIDDEN_IN_SEGMENT.test(name) && !DEVICE_NAME.test(name)
    && !name.endsWith('.') && !name.endsWith(' ')
}

/**
 * Split an archive entry name into path segments, or say why it is not one this module writes.
 * @param name - entry name as stored; `\` is read as a separator, as archivers on Windows write it.
 * @returns the segments, `'skip'` for an entry that is not a skill file, or `'unsafe'` for a path that leaves its
 *   folder or cannot be stored.
 */
function segmentsOf(name: string): string[] | 'skip' | 'unsafe' {
  const segments = name.replaceAll('\\', '/').split('/')
  // Finder's resource forks and folder metadata are not part of any skill.
  if (segments[0] === '__MACOSX' || segments.at(-1) === '.DS_Store') return 'skip'
  return segments.every(isStorableName) ? segments : 'unsafe'
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment)
}

/**
 * Read the skills of a ZIP archive. Every `SKILL.md` marks a skill whose
 * bundle is its folder; a `SKILL.md` inside another skill's folder is that
 * skill's resource. Files outside every skill folder are left out.
 * @param archive - the archive's bytes.
 * @returns the skills found, or why the archive is refused as a whole.
 */
export function unpackSkillArchive(archive: Uint8Array): ArchivedSkill[] | SkillImportRefusal {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) return 'too-large'
  let entries: Record<string, Uint8Array>
  const declared = new Map<string, number>()
  let unpacked = 0
  try {
    entries = unzipSync(archive, {
      filter: (entry) => {
        // Folder entries carry no bytes; folders are made for the files inside them.
        if (entry.name.endsWith('/') || entry.name.endsWith('\\')) return false
        // Two entries of one name would silently become one file.
        if (declared.has(entry.name)) throw new ArchivePathError()
        declared.set(entry.name, entry.originalSize)
        // A stored entry is copied by its stored size whatever size it declares, so the larger of the two counts.
        unpacked += Math.max(entry.size, entry.originalSize)
        if (declared.size > MAX_ARCHIVE_FILES || unpacked > MAX_UNPACKED_BYTES) throw new ArchiveLimitError()
        return true
      },
    })
  } catch (error) {
    return error instanceof ArchiveLimitError ? 'too-large' : error instanceof ArchivePathError ? 'unsafe-path' : 'not-zip'
  }

  const files: { segments: string[]; data: Uint8Array }[] = []
  /** Case-folded paths already taken by a file, and by a folder: Windows and macOS store both spellings as one. */
  const taken = { files: new Set<string>(), folders: new Set<string>() }
  for (const [name, data] of Object.entries(entries)) {
    // An entry that unpacks to another size than it declares is truncated or padded, not the file that was packed.
    if (data.byteLength !== declared.get(name)) return 'not-zip'
    const segments = segmentsOf(name)
    if (segments === 'unsafe') return 'unsafe-path'
    if (segments === 'skip') continue
    const folded = segments.map(segment => segment.toLowerCase())
    const path = folded.join('/')
    if (taken.files.has(path) || taken.folders.has(path)) return 'unsafe-path'
    for (let depth = 1; depth < folded.length; depth += 1) {
      const folder = folded.slice(0, depth).join('/')
      if (taken.files.has(folder)) return 'unsafe-path'
      taken.folders.add(folder)
    }
    taken.files.add(path)
    files.push({ segments, data })
  }
  const roots: string[][] = []
  const candidates = files.filter(file => file.segments.at(-1) === SKILL_FILE).map(file => file.segments.slice(0, -1))
  for (const root of candidates.sort((left, right) => left.length - right.length)) {
    if (!roots.some(outer => startsWith(root, outer))) roots.push(root)
  }
  if (roots.length === 0) return 'no-skill'
  return roots.map(root => ({
    folder: root.join('/'),
    files: files
      .filter(file => startsWith(file.segments, root))
      .map(file => ({ path: file.segments.slice(root.length).join('/'), data: file.data })),
  }))
}

/**
 * Pack one skill's files as a ZIP whose single top folder is named after the skill.
 * @param name - skill name, the archive's top folder.
 * @param files - the skill's files.
 * @returns the archive's bytes.
 * @throws ArchiveLimitError when the archive is over the size an import would accept.
 */
export function packSkillBundle(name: string, files: readonly BundleFile[]): Uint8Array {
  const archive = zipSync(Object.fromEntries(files.map(file => [`${name}/${file.path}`, file.data])))
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new ArchiveLimitError(`the archive of skill "${name}" is over ${MAX_ARCHIVE_BYTES} bytes`)
  return archive
}

/**
 * Read every file of a skill's folder. Symbolic links are left out, so the
 * bundle never reaches outside the folder.
 * @param folder - the skill's folder.
 * @returns the folder's files with `/`-separated paths relative to it.
 * @throws ArchiveLimitError when the folder holds more files or bytes than an import would accept.
 */
export async function readSkillFolder(folder: string): Promise<BundleFile[]> {
  const files: BundleFile[] = []
  let bytes = 0
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : 1)) {
      const path = `${prefix}${entry.name}`
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name), `${path}/`)
      } else if (entry.isFile()) {
        const data = await readFile(join(directory, entry.name))
        bytes += data.byteLength
        files.push({ path, data })
        if (files.length > MAX_ARCHIVE_FILES || bytes > MAX_UNPACKED_BYTES) {
          throw new ArchiveLimitError(`skill folder "${folder}" holds over ${MAX_ARCHIVE_FILES} files or ${MAX_UNPACKED_BYTES} bytes`)
        }
      }
    }
  }
  await walk(folder, '')
  return files
}
