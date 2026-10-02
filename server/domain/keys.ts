// Human-readable identifiers: task keys such as ATL-012 and project codes derived from a project's name.
import type { Project } from './types'

export function taskKey(project: Pick<Project, 'code'> | undefined | null, id: number): string {
  return `${project?.code || 'TASK'}-${String(id).padStart(3, '0')}`
}

/** A project code built from the first letters of the name, made unique with a numeric suffix. */
export function uniqueProjectCode(name: string, existingCodes: Iterable<string>): string {
  const taken = new Set([...existingCodes].map(code => code.toUpperCase()))
  const base = (
    name
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 3) || 'PRJ'
  ).padEnd(2, 'X')
  let code = base
  for (let n = 2; taken.has(code); n++) code = `${base}${n}`
  return code
}
