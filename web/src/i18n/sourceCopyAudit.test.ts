import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { hasTranslation } from './translations'

const sourceModules = import.meta.glob('../**/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>
const translatedAttributes = new Set(['alt', 'aria-description', 'aria-label', 'placeholder', 'title'])
const intentionalRawCopy = new Set([
  'Catalyst', 'Log10', 'Log₁₀', 'Review &amp; Run', 'cm', 'inch', 'm', 'mm', 'null', 'undefined',
  '−X', '−Y', '−Z', 'ΔX', 'ΔY', 'ΔZ', 'ΔX / ΔY / ΔZ',
  '1 m', '17 m', '0.25 m · 10°', '0.15 m · 6°', '0.01 m', '0.005 m',
  '+x', '0.08 m', '0.16 m',
  'first_layer_thickness', 'leftWing', 'rightWing', 'fuselage', 'operating_condition.alpha',
])

function normalized(value: string) {
  return value.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function expressionStrings(expression: ts.Expression): string[] {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text]
  if (ts.isConditionalExpression(expression)) {
    return [...expressionStrings(expression.whenTrue), ...expressionStrings(expression.whenFalse)]
  }
  return []
}

function visibleCopy(path: string, sourceText: string) {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const values: Array<{ file: string; line: number; text: string }> = []
  const add = (node: ts.Node, value: string) => {
    const text = normalized(value)
    if (!/[A-Za-z]/.test(text)) return
    values.push({ file: path.replace(/^\.\.\//, ''), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text })
  }
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, node.text)
    if (ts.isJsxAttribute(node) && translatedAttributes.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
      add(node, node.initializer.text)
    }
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      expressionStrings(node.expression).forEach((value) => add(node, value))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return values
}

describe('user-visible source copy', () => {
  it('keeps literal Web copy covered by the Chinese locale', () => {
    const untranslated = Object.entries(sourceModules)
      .filter(([path]) => !path.includes('/i18n/') && !path.endsWith('.test.tsx'))
      .flatMap(([path, source]) => visibleCopy(path, source))
      .filter(({ text }) => !/[\u4e00-\u9fff]/.test(text))
      .filter(({ text }) => !hasTranslation(text, 'zh-CN'))
      .filter(({ text }) => !intentionalRawCopy.has(text))
      .filter(({ text }) => !/^(?:[A-Z\d_.:+/·°≤≥%— -]+|Flow360(?:\s+\d+(?:\.\d+)*)?|Vibe Flow360|SimulationParams|JSON|CAD|STEP|ID)$/.test(text))
      .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)

    expect(untranslated).toEqual([])
  })
})
