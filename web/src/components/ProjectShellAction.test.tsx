import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectShellAction } from './ProjectShellAction'

describe('ProjectShellAction', () => {
  it.each(['Resources', 'Details', 'Ask AI'])(
    'keeps the visible label and accessible name for %s',
    (label) => {
      const markup = renderToStaticMarkup(
        <ProjectShellAction label={label} icon={<svg aria-hidden="true" />} />,
      )

      expect(markup).toContain(`aria-label="${label}"`)
      expect(markup).toContain(`title="${label}"`)
      expect(markup).toContain(`<span>${label}</span>`)
    },
  )

  it('supports a more descriptive accessible name without changing desktop text', () => {
    const markup = renderToStaticMarkup(
      <ProjectShellAction
        label="Sync"
        accessibleLabel="Synchronize Project"
        icon={<svg aria-hidden="true" />}
      />,
    )

    expect(markup).toContain('aria-label="Synchronize Project"')
    expect(markup).toContain('<span>Sync</span>')
  })
})
