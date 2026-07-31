export type PreflightPrimaryAction = 'validate' | 'structured-inputs' | 'agent-diagnosis'

export function preflightPrimaryAction(
  ready: boolean,
  hasStructuredInputs: boolean,
): PreflightPrimaryAction {
  if (ready) return 'validate'
  if (hasStructuredInputs) return 'structured-inputs'
  return 'agent-diagnosis'
}

export function executionTemplate(parts: string[]): string {
  return parts
    .map((part) => {
      const display = part === '<generated-plan-patch.json>' ? '<temporary-patch.json>' : part
      return display.includes(' ') ? `"${display}"` : display
    })
    .join(' ')
}
