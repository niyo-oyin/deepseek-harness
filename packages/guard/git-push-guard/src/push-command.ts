/**
 * Recognition of `git push` inside a shell command line, for bash, PowerShell,
 * and cmd alike. The scan errs toward asking: a command that only mentions a
 * push (`echo git push`) is reported, because an unneeded question costs one
 * click while a missed push cannot be undone.
 * @module @deepseek-ai/dsh-git-push-guard/push-command
 */

/** Git options that take their value as the next word. */
const VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix'])

/** Suffixes Windows accepts on an executable name. */
const EXECUTABLE_SUFFIX = /\.(?:exe|com|cmd|bat)$/u

/** A quoted word can hold a whole command line (`bash -c "…"`); nesting beyond this depth is not a command a shell runs. */
const MAX_DEPTH = 4

/** One word of a command line and whether quotes enclosed any part of it. */
interface Word {
  readonly text: string
  readonly quoted: boolean
}

/**
 * Split a command line into simple commands and their words. Quotes group
 * characters into one word and are dropped. Outside quotes, whitespace ends a
 * word, and a control operator, a grouping character, or a backquote ends the
 * simple command, so a command substitution or a subshell is scanned as a
 * command of its own. A backslash stays literal, because it separates Windows
 * path segments far more often than it escapes a character here; the one
 * escape read is a quote inside double quotes, which nested shell payloads use.
 * @param command - the command line.
 * @returns the words of each simple command, in order.
 */
function simpleCommands(command: string): Word[][] {
  const commands: Word[][] = []
  let words: Word[] = []
  let text = ''
  let quoted = false
  let started = false
  let quote: string | undefined
  const endWord = (): void => {
    if (started) words.push({ text, quoted })
    text = ''
    quoted = false
    started = false
  }
  const endCommand = (): void => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  for (let index = 0; index < command.length; index++) {
    const character = command[index] as string
    if (quote !== undefined) {
      // Inside double quotes, bash escapes a quote with a backslash and PowerShell with a backquote.
      if (quote === '"' && (character === '\\' || character === '`') && command[index + 1] === '"') {
        text += '"'
        index++
      } else if (character === quote) {
        quote = undefined
      } else {
        text += character
      }
    } else if (character === '\'' || character === '"') {
      quote = character
      quoted = true
      started = true
    } else if (/\s/u.test(character)) {
      if (character === '\n' || character === '\r') endCommand()
      else endWord()
    } else if (';|&(){}`'.includes(character)) {
      endCommand()
    } else {
      text += character
      started = true
    }
  }
  endCommand()
  return commands
}

/** Whether a word names the Git executable, with or without a directory and a Windows suffix. */
function isGit(word: string): boolean {
  const name = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1).toLowerCase()
  return name.replace(EXECUTABLE_SUFFIX, '') === 'git'
}

/**
 * The Git subcommand that follows the executable: the first word that is not
 * an option or an option's value.
 * @param words - the words after the Git executable.
 * @returns the subcommand in lower case, or undefined when the words hold only options.
 */
function subcommand(words: readonly Word[]): string | undefined {
  for (let index = 0; index < words.length; index++) {
    const word = (words[index] as Word).text
    if (!word.startsWith('-')) return word.toLowerCase()
    if (VALUE_OPTIONS.has(word)) index++
  }
  return undefined
}

/**
 * Whether a command line runs `git push`. Every simple command is searched for
 * the Git executable at any position, which covers a wrapper before it
 * (`sudo`, `env`, PowerShell's `&`) without listing wrappers. A quoted word
 * that itself holds several words is scanned as a command line, which covers
 * a payload handed to another shell or to `eval`.
 * @param command - the command line a shell tool is about to run.
 * @param depth - nesting level of the scanned text; callers omit it.
 * @returns whether the command line contains a Git push.
 */
export function runsGitPush(command: string, depth = 0): boolean {
  for (const words of simpleCommands(command)) {
    for (const [index, word] of words.entries()) {
      if (isGit(word.text) && subcommand(words.slice(index + 1)) === 'push') return true
      if (word.quoted && depth < MAX_DEPTH && /\s/u.test(word.text) && runsGitPush(word.text, depth + 1)) return true
    }
  }
  return false
}
