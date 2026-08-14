import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { STEPAsset, STEPVersion } from '../api/client'
import { I18nProvider } from '../i18n'
import ImportPanel, { readySTEPChoices, validateFileNames } from './ImportPanel'

function version(id: string, status: STEPVersion['validation']['status'], number: number): STEPVersion {
  return {
    id,
    asset_id: 'asset-1',
    number,
    file_name: `${id}.step`,
    unit: 'mm',
    size: 12,
    sha256: id,
    source: 'upload',
    validation: { status },
    created_at: '2026-08-14T00:00:00Z',
  }
}

describe('validateFileNames', () => {
  it('accepts CATIA extensions regardless of filename casing', () => {
    expect(validateFileNames(['wing.CATPart', 'assembly.catproduct'], 'geometry')).toBeNull()
  })

  it('rejects extensions that do not belong to the selected source type', () => {
    expect(validateFileNames(['mesh.cgns'], 'geometry')).toContain('mesh.cgns')
    expect(validateFileNames(['geometry.step'], 'volume-mesh')).toContain('geometry.step')
  })
})

describe('readySTEPChoices', () => {
  it('offers only validated immutable versions and keeps newest versions first', () => {
    const assets: STEPAsset[] = [{
      id: 'asset-1',
      folder_id: 'step-root',
      name: 'Wing',
      versions: [version('v1', 'ready', 1), version('v2', 'blocked', 2), version('v3', 'ready', 3)],
      created_at: '2026-08-14T00:00:00Z',
      updated_at: '2026-08-14T00:00:00Z',
    }]

    expect(readySTEPChoices(assets).map(({ version: choice }) => choice.id)).toEqual(['v3', 'v1'])
  })
})

describe('ImportPanel source method', () => {
  it('starts with an accessible stateful choice between upload and the STEP library', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, null, createElement(ImportPanel, {
      folder: { id: 'folder-1', name: 'Designs', subfolders: [] },
      onClose: () => undefined,
      onCreated: () => undefined,
      onSTEPProjectCreated: () => undefined,
    })))

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-label="Project source method"')
    expect(markup).toContain('role="tab" aria-selected="true"')
    expect(markup).toContain('Upload files')
    expect(markup).toContain('STEP geometry library')
  })
})
