export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }
  return String(cause).replace(/^Error:\s*/, '')
}
