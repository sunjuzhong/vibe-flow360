import { BarChart3 } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { ViewerAssetStats } from './Viewer3D'

export function ViewerAssetInformation({ stats }: { stats: ViewerAssetStats | null }) {
  const { t } = useI18n()
  if (!stats) return null

  return (
    <section className="viewer-asset-information" aria-label={t('Mesh statistics')}>
      <div className="viewer-asset-information-title">
        <BarChart3 size={13} /> {t('Mesh statistics')}
      </div>
      <dl>
        <div><dt>{t('Faces')}</dt><dd>{stats.faces.toLocaleString()}</dd></div>
        <div><dt>{t('Edges')}</dt><dd>{stats.edges.toLocaleString()}</dd></div>
        <div><dt>{t('Triangles')}</dt><dd>{stats.triangles.toLocaleString()}</dd></div>
      </dl>
    </section>
  )
}
