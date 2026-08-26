export function objectValue(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined
}

export function stringValue(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined
}
