import { Cloud, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'

export default function TopBar({ status }: { status: Flow360Status | null }) {
  return (
    <header className="product-topbar">
      <Link className="brand brand-link" to="/" aria-label="返回 VibeSim 首页">
        <span className="brand-mark"><Sparkles size={17} /></span>
        <span>VibeSim</span>
        <span className="brand-beta">BETA</span>
      </Link>
      <div className="product-topbar-title">Flow360 simulation workspace</div>
      <div className={`connection-pill ${status?.available ? 'online' : ''}`}>
        <span />
        <Cloud size={12} />
        {status === null
          ? 'Checking Flow360'
          : status.available
            ? `${status.environment || 'production'} · ${status.profile || 'default'}`
            : 'Flow360 offline'}
      </div>
    </header>
  )
}

