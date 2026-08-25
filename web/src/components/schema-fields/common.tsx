import HelpTooltip from '../HelpTooltip'
import type { DynamicFormSchema } from '../../api/client'
import { currentLanguage } from '../../i18n'
import { translate } from '../../i18n/translations'

export function SchemaDescriptionHelp({ description, title }: { description?: string; title: string }) {
  if (!description) return null
  const cleaned = cleanSchemaDescription(description)
  if (!cleaned) return null
  return <HelpTooltip label={t('About {title}').replace('{title}', schemaLabel(title))}>{t(cleaned)}</HelpTooltip>
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
  if (schema.title) return schemaLabel(schema.title)
  if (schema.wire_discriminator?.value) return schemaLabel(String(schema.wire_discriminator.value))
  if (schema.type === 'union') {
    const nested = (schema.variants ?? []).map((variant, nestedIndex) => variantLabel(variant, nestedIndex))
    if (nested.length) return nested.join(' / ')
    return t('Choice')
  }
  if (schema.type === 'array') return schema.minItems === 3 && schema.maxItems === 3 ? t('Vector') : t('List')
  if (schema.type === 'quantity' || schema.type === 'number' || schema.type === 'integer') return t('Fixed value')
  if (schema.type === 'expression') return t('Expression')
  if (schema.type === 'string') return t('Text value')
  if (schema.type === 'json') return t('Custom value')
  return schemaLabel(schema.type || `Type ${index + 1}`)
}

function t(value: string): string {
  return translate(value, currentLanguage())
}

export function schemaLabel(value: string): string {
  const translated = t(value)
  if (translated !== value) return translated
  const needsFormatting = /[_-]/.test(value) || /[a-z0-9][A-Z]/.test(value)
  return needsFormatting ? t(humanize(value)) : value
}

export function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
