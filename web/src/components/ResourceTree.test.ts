import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProjectItem, ResourceNode } from '../api/client'
import { I18nProvider } from '../i18n'
import ResourceTree, { isProjectResourceReady, normalizeResourceStatus, projectItemStatus, resourceStatusLabel } from './ResourceTree'

describe('ResourceTree resource readiness', () => {
  it('normalizes remote statuses for display and matching', () => {
    expect(normalizeResourceStatus('In Progress')).toBe('in_progress')
    expect(resourceStatusLabel('in_progress')).toBe('In Progress')
  })

  it('uses status before state', () => {
    expect(projectItemStatus({ status: 'running', state: 'completed' })).toBe('running')
  })

  it('disables resources that are still being produced by Flow360', () => {
    for (const status of ['pending', 'queued', 'preprocessing', 'running', 'in progress', 'processing']) {
      expect(isProjectResourceReady({ status })).toBe(false)
    }
  })

  it('keeps complete, failed, and unknown-status resources navigable', () => {
    expect(isProjectResourceReady({ status: 'completed' })).toBe(true)
    expect(isProjectResourceReady({ status: 'failed' })).toBe(true)
    expect(isProjectResourceReady({ status: 'mystery' })).toBe(true)
    expect(isProjectResourceReady({})).toBe(true)
    expect(isProjectResourceReady(null)).toBe(true)
  })

  it('renders not-ready resources as disabled rows with status badges', () => {
    const root: ResourceNode = {
      id: 'geo-1',
      name: 'Tutorial T04 geometry',
      type: 'Geometry',
      children: [{ id: 'case-1', name: 'T04 baseline edge controls', type: 'Case', children: [] }],
    }
    const items: ProjectItem[] = [
      { id: 'geo-1', name: 'Tutorial T04 geometry', type: 'Geometry', parent_id: null, status: 'completed' },
      { id: 'case-1', name: 'T04 baseline edge controls', type: 'Case', parent_id: 'geo-1', status: 'pending' },
    ]

    const markup = renderToStaticMarkup(createElement(
      I18nProvider,
      null,
      createElement(ResourceTree, {
        root,
        items,
        selected: 'geo-1',
        projectId: 'prj-1',
        onSelect: () => undefined,
      }),
    ))

    expect(markup).toContain('resource-not-ready')
    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Pending')
    expect(markup).toContain('This resource is not ready in Flow360 yet.')
  })
})
