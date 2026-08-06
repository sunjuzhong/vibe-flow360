import { BookOpen, Cloud, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'

export default function TopBar({ status, title = 'Flow360 simulation workspace' }: { status: Flow360Status | null; title?: string }) {
  return (
    <header className="product-topbar">
      <Link className="brand brand-link" to="/" aria-label="Return to home">
        <span className="brand-mark"><Sparkles size={17} /></span>
        <span>Vibe Flow360</span>
        <span className="brand-beta">BETA</span>
      </Link>
      <div className="product-topbar-title">{title}</div>
      <div className="product-topbar-actions">
        <Link className="tutorials-nav-link" to="/tutorials"><BookOpen size={14}/> Tutorials</Link>
        <div className={`connection-pill ${status?.available ? 'online' : ''}`}>
          <span />
          <Cloud size={12} />
          {status === null
            ? 'Checking Flow360'
            : status.available
              ? `${status.environment || 'production'} · ${status.profile || 'default'}`
              : 'Flow360 offline'}
        </div>
      </div>
    </header>
  )
}
