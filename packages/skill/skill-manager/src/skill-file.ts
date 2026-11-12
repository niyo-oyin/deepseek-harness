/** The text of a skill's Markdown file: YAML frontmatter followed by the instructions. */

import { isSkillName } from '@deepseek-ai/dsh-skill'
import { Document, parse, parseDocument } from 'yaml'

/** The frontmatter fields a management surface edits. */
export interface SkillFileFields {
  /** One-line description. */
  description: string
  /** Guidance on when the model should load the skill; `''` removes the field. */
  whenToUse: string
  /** Markdown instructions below the frontmatter. */
  content: string
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/**
 * Read the identity of a skill file as the filesystem provider would accept it.
 * @param text - the file's text.
 * @returns the skill's name and description, or nothing when the file has no frontmatter with a kebab-case
 *   `name` and a non-empty `description`.
 */
export function skillHeader(text: string): { name: string; description: string } | undefined {
  const source = FRONTMATTER.exec(text)?.[1]
  if (source === undefined) return undefined
  let data: unknown
  try {
    data = parse(source)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const { name, description } = data as { name?: unknown; description?: unknown }
  if (typeof name !== 'string' || !isSkillName(name) || typeof description !== 'string' || description === '') return undefined
  return { name, description }
}

/**
 * Render a new skill file.
 * @param name - kebab-case skill name.
 * @param fields - the description, optional guidance, and instructions.
 * @returns the complete file text.
 */
export function newSkillFile(name: string, fields: SkillFileFields): string {
  const frontmatter = new Document({ name })
  return render(frontmatter, fields)
}

/**
 * Render an existing skill file with its edited fields replaced. Every other
 * frontmatter field — the name, the invocation controls, metadata, comments —
 * stays as it is written.
 * @param previous - the file's current text.
 * @param fields - the description, optional guidance, and instructions.
 * @returns the complete file text.
 * @throws when the current text carries no readable YAML frontmatter.
 */
export function editedSkillFile(previous: string, fields: SkillFileFields): string {
  const source = FRONTMATTER.exec(previous)?.[1]
  if (source === undefined) throw new Error('the skill file has no YAML frontmatter')
  const frontmatter = parseDocument(source)
  const problem = frontmatter.errors[0]
  if (problem !== undefined) throw new Error(`the skill file's frontmatter is not valid YAML: ${problem.message}`)
  return render(frontmatter, fields)
}

function render(frontmatter: Document, fields: SkillFileFields): string {
  frontmatter.set('description', fields.description)
  if (fields.whenToUse === '') frontmatter.delete('whenToUse')
  else frontmatter.set('whenToUse', fields.whenToUse)
  // No folding: a long description stays one line, as people write it by hand.
  return `---\n${frontmatter.toString({ lineWidth: 0 })}---\n\n${fields.content.trim()}\n`
}
