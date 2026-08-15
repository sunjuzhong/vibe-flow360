import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import type { AICreateSession } from '../api/client'
import AICreateSessionContext from './AICreateSessionContext'

const session: AICreateSession = {
  id: 'aic-history',
  intent: 'Create drop-body flow',
  original_request: 'Create drop-body flow',
  folder_id: 'folder-1',
  phase: 'needs_input',
  round: 2,
  messages: [{ role: 'user', content: 'Create drop-body flow', created_at: '2026-08-15T00:00:00Z' }],
  history: [{
    round: 1,
    fields: [{ id: 'mach', label: 'Mach number', type: 'number', required: true }],
    answers: { mach: 0.8 },
  }],
  pending: [{ id: 'altitude', label: 'Flight altitude', type: 'number', unit: 'm', required: true }],
  checkpoints: { cad_validated: true, project_created: true, parameters_validated: false, draft_configured: false },
  created_at: '2026-08-15T00:00:00Z',
  updated_at: '2026-08-15T00:05:00Z',
}

describe('AICreateSessionContext', () => {
  it('makes prior decisions, saved checkpoints, and the current blocker explicit', () => {
    const markup = renderToStaticMarkup(<I18nProvider><AICreateSessionContext session={session} /></I18nProvider>)
    expect(markup).toContain('Original request')
    expect(markup).toContain('Create drop-body flow')
    expect(markup).toContain('Agent questions · round 1')
    expect(markup).toContain('Mach number')
    expect(markup).toContain('0.8')
    expect(markup).toContain('Waiting for your input')
    expect(markup).toContain('Flight altitude')
    expect(markup).toContain('Exact CAD')
    expect(markup).toContain('Flow360 Project')
    expect(markup).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('explains how an older session recovers missing pending questions', () => {
    const markup = renderToStaticMarkup(<I18nProvider><AICreateSessionContext session={{ ...session, pending: [] }} /></I18nProvider>)
    expect(markup).toContain('Pending questions need recovery')
    expect(markup).toContain('stopped before its current questions were saved')
    expect(markup).toContain('Resume it to continue from the last complete checkpoint')
  })
})
