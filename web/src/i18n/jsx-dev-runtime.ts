import { Fragment, jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime'
import { localizeProps } from './index'

export { Fragment }
export type { JSX } from 'react'

export function jsxDEV(
  type: Parameters<typeof reactJsxDEV>[0],
  props: Parameters<typeof reactJsxDEV>[1],
  key: Parameters<typeof reactJsxDEV>[2],
  isStaticChildren: Parameters<typeof reactJsxDEV>[3],
  source: Parameters<typeof reactJsxDEV>[4],
  self: Parameters<typeof reactJsxDEV>[5],
) {
  return reactJsxDEV(type, localizeProps(props as Record<string, unknown> | null) as Parameters<typeof reactJsxDEV>[1], key, isStaticChildren, source, self)
}
