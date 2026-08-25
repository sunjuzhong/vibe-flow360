/** @vitest-environment jsdom */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DynamicFormSchema } from '../api/client'
import { SchemaFormFields, serializeValue } from './SchemaForm'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const schema: DynamicFormSchema = {
  type: 'object',
  properties: {
    use_wall_function: {
      type: 'object', title: 'Use Wall Function', nullable: true, default: null,
      properties: {
        wall_function_type: { type: 'enum', title: 'Wall Function Type', default: 'BoundaryLayer', options: ['BoundaryLayer', 'InnerLayer'] },
      },
    },
  },
}

function StatefulWallFunction() {
  const [value, setValue] = useState<unknown>({ use_wall_function: null })
  return <><SchemaFormFields schema={schema} value={value} showAll onChange={setValue} /><output>{JSON.stringify(serializeValue(schema, value, true))}</output></>
}

describe('SchemaForm Wall presentation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('does not materialize the nullable default until the explicit enable control changes', async () => {
    await act(async () => root.render(<StatefulWallFunction />))
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(toggle.checked).toBe(false)
    expect(container.querySelector('#schema-use_wall_function-wall_function_type')).toBeNull()
    expect(container.querySelector('output')?.textContent).toBe('{"use_wall_function":null}')

    await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('#schema-use_wall_function-wall_function_type')).not.toBeNull()
    expect(container.querySelector('output')?.textContent).toBe('{"use_wall_function":{"wall_function_type":"BoundaryLayer"}}')
  })
})
