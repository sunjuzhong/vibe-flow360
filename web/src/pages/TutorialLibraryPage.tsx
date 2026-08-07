import { ArrowRight, BookOpen, CheckCircle2, CircleDot, Clock3, GitBranch, Plane, ShieldCheck, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'

export default function TutorialLibraryPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
  }, [])

  return (
    <div className="tutorial-library-page">
      <TopBar status={status} title="Learn by building trustworthy simulations" />
      <main className="tutorial-library">
        <header className="tutorial-library-hero">
          <div>
            <p className="eyebrow">GUIDED TUTORIALS</p>
            <h1>Learn Flow360 through engineering decisions.</h1>
            <p>Each tutorial connects a physical question to a reviewable setup, a controlled variant, and evidence you can use to decide whether the result is trustworthy.</p>
          </div>
          <div className="tutorial-library-principle">
            <ShieldCheck size={21} />
            <div><strong>Completion is not credibility</strong><span>Every lesson ends with an evidence contract, not just a green solver status.</span></div>
          </div>
        </header>

        <section className="tutorial-catalog-heading">
          <div><BookOpen size={18} /><div><h2>Golden path tutorials</h2><p>Start locally. Connect to cloud execution only after review.</p></div></div>
          <span>4 available</span>
        </section>

        <section className="tutorial-card-grid">
          <Link className="tutorial-card" to="/tutorials/T01">
            <div className="tutorial-card-visual">
              <Plane size={45} strokeWidth={1.15} />
              <span className="tutorial-id">T01</span>
              <span className="tutorial-level">FOUNDATION</span>
            </div>
            <div className="tutorial-card-content">
              <p className="eyebrow">EXTERNAL AERODYNAMICS</p>
              <h2>First trustworthy lift and drag result</h2>
              <p>Set up a simple aircraft at 0° and 5° angle of attack, then learn why mesh review, convergence, and force stability all matter.</p>
              <div className="tutorial-card-meta">
                <span><Clock3 size={13} /> 15–20 min</span>
                <span><CheckCircle2 size={13} /> Browser guided</span>
                <span>Flow360 25.10</span>
              </div>
              <span className="tutorial-start">Start tutorial <ArrowRight size={15} /></span>
            </div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T02">
            <div className="tutorial-card-visual"><GitBranch size={48} strokeWidth={1.15}/><span className="tutorial-id">T02</span><span className="tutorial-level">WORKFLOW</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">PROJECT ENTRY PATHS</p><h2>Choose the right Project root</h2><p>Compare Geometry, SurfaceMesh, and VolumeMesh roots, then upload a trusted mesh and create two configured Case Drafts.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 12–15 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T03">
            <div className="tutorial-card-visual mesh-card-visual">
              <CircleDot size={52} strokeWidth={1.1} />
              <span className="tutorial-id">T03</span>
              <span className="tutorial-level">MESHING</span>
            </div>
            <div className="tutorial-card-content">
              <p className="eyebrow">EXTERNAL FLOW MESHING</p>
              <h2>Curvature-sensitive cylinder mesh</h2>
              <p>Combine global defaults, local curvature refinement, and boundary layers—then compare a controlled finer mesh before solving.</p>
              <div className="tutorial-card-meta">
                <span><Clock3 size={13} /> 15–20 min</span>
                <span><CheckCircle2 size={13} /> Browser guided</span>
                <span>Flow360 25.10</span>
              </div>
              <span className="tutorial-start">Start tutorial <ArrowRight size={15} /></span>
            </div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T04">
            <div className="tutorial-card-visual airfoil-card-visual"><Waypoints size={52} strokeWidth={1.1}/><span className="tutorial-id">T04</span><span className="tutorial-level">ADVANCED MESHING</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">MULTI-ELEMENT AIRFOIL</p><h2>Preserve critical edges and narrow gaps</h2><p>Match angle, height, aspect-ratio, and projected spacing to edge risk—then compare a Geometry AI passage-preservation strategy.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 18–22 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
        </section>
      </main>
    </div>
  )
}
