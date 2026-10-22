/** Compare the document URL exactly; a renderer may change only its hash. */
export function isTrustedRendererUrl(actual: string, expected: string): boolean {
  try {
    const received = new URL(actual)
    const trusted = new URL(expected)
    received.hash = ''
    trusted.hash = ''
    return received.href === trusted.href
  } catch {
    return false
  }
}

export function isTrustedSignInUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      ['auth.openai.com', 'chatgpt.com'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    )
  } catch {
    return false
  }
}

export function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error('A valid identifier of at most 200 characters is required.')
  }
  return value
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('This operation requires an object.')
  }
  return value as Record<string, unknown>
}

/** Only the native folder picker or a saved project can grant a folder binding. */
export function requireGrantedFolder(input: unknown, allowedPaths: ReadonlySet<string>): void {
  const project = requireRecord(input)
  if (project.folderPath === undefined || project.folderPath === '') return
  if (typeof project.folderPath !== 'string' || !allowedPaths.has(project.folderPath))
    throw new Error('Choose the project folder using the folder picker before saving.')
}
