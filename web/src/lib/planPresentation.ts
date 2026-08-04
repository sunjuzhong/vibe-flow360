import type { DynamicFormSchema } from '../api/client'

export type PreflightPrimaryAction = 'validate' | 'structured-inputs' | 'agent-diagnosis'

export function preflightPrimaryAction(
  ready: boolean,
  hasStructuredInputs: boolean,
): PreflightPrimaryAction {
  if (ready) return 'validate'
  if (hasStructuredInputs) return 'structured-inputs'
  return 'agent-diagnosis'
}

export function schemaContainsRecommendation(schema: DynamicFormSchema): boolean {
  if (schema.recommendation) return true
  return Object.values(schema.properties ?? {}).some(schemaContainsRecommendation)
    || (schema.variants ?? []).some(schemaContainsRecommendation)
    || Boolean(schema.items && schemaContainsRecommendation(schema.items))
}

export function schemaRequiresUserInput(schema: DynamicFormSchema): boolean {
  if (schema.type === 'object') {
    return Object.values(schema.properties ?? {}).some(schemaRequiresUserInput)
  }
  if (schema.type === 'field_removal' || (schema.type === 'entity_assignment' && schema.recommendation)) {
    return false
  }
  return true
}

export function executionTemplate(parts: string[]): string {
  return parts
    .map((part) => {
      const display = part === '<generated-plan-patch.json>' ? '<temporary-patch.json>' : part
      return display.includes(' ') ? `"${display}"` : display
    })
    .join(' ')
}
