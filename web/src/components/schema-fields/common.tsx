import HelpTooltip from '../HelpTooltip'
import type { DynamicFormSchema } from '../../api/client'

export function SchemaDescriptionHelp({ description, title }: { description?: string; title: string }) {
  if (!description) return null
  const cleaned = cleanSchemaDescription(description)
  if (!cleaned) return null
  return <HelpTooltip label={`About ${title}`}>{cleaned}</HelpTooltip>
}

export function cleanSchemaDescription(description: string): string {
  return description
    .replace(/See\s+(:class:|:ref:)?`[^`]+`\s*(and\s*)?/g, '')
    .replace(/:class:`([^`]+)`/g, '$1')
    .replace(/:ref:`([^`<]+)(?:<[^`]+>)?`/g, '$1')
    .replace(/\s+documentation\.?/gi, '.')
    .replace(/\s+for more details\.?/gi, '.')
    .replace(/\s+\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function variantLabel(schema: DynamicFormSchema, index: number): string {
  if (schema.title) return schema.title
  if (schema.wire_discriminator?.value) return String(schema.wire_discriminator.value)
  return humanize(schema.type || `Type ${index + 1}`)
}

export function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
