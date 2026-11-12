/** Bounded on-disk record of renderer warnings and errors, kept for diagnosis after the window closes. */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Current renderer log file inside the application logs directory. */
export const RENDERER_LOG_FILE = 'renderer.log'

/** Size at which the current file becomes the single retained predecessor, `renderer.log.1`. */
export const RENDERER_LOG_MAX_BYTES = 2 * 1024 * 1024

/** Longest retained message; a longer one is cut and marked. */
export const RENDERER_LOG_MAX_MESSAGE_CHARS = 8 * 1024

/** One renderer console message at warning or error level. */
export interface RendererConsoleEntry {
  readonly level: 'warning' | 'error'
  /** Script URL that produced the message. */
  readonly source: string
  readonly line: number
  readonly message: string
}

/**
 * Append one renderer console message. The record is best-effort: a write failure is dropped
 * because diagnostics must never interrupt the window that produced them.
 * @param directory - application logs directory; created when absent.
 * @param entry - the console message to record.
 * @param now - time written on the line.
 */
export function recordRendererConsole(directory: string, entry: RendererConsoleEntry, now = new Date()): void {
  const message = entry.message.length > RENDERER_LOG_MAX_MESSAGE_CHARS
    ? `${entry.message.slice(0, RENDERER_LOG_MAX_MESSAGE_CHARS)}… [truncated]` : entry.message
  const path = join(directory, RENDERER_LOG_FILE)
  try {
    mkdirSync(directory, { recursive: true })
    if (currentSize(path) >= RENDERER_LOG_MAX_BYTES) renameSync(path, `${path}.1`)
    appendFileSync(path, `${now.toISOString()} ${entry.level} ${entry.source}:${String(entry.line)} ${message.replaceAll('\n', '\n  ')}\n`,
      { mode: 0o600 })
  } catch (_writeFailure) {
    // The logs directory is unwritable; the message remains visible in the renderer console.
  }
}

function currentSize(path: string): number {
  try {
    return statSync(path).size
  } catch (_absent) {
    return 0 // The first message creates the file.
  }
}
