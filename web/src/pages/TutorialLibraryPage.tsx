import { ArrowRight, BookOpen, CheckCircle2, CircleDot, Clock3, Plane, ShieldCheck, Target, Waypoints } from 'lucide-react'
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
      <TopBar status={status} title="Flow360 CFD tutorials" />
      <main className="tutorial-library">
        <header className="tutorial-library-hero">
          <div>
            <p className="eyebrow">GUIDED TUTORIALS</p>
            <h1>Build and review Flow360 CFD simulations.</h1>
            <p>Configure geometry, mesh, operating conditions, controlled variants, and acceptance evidence for each case.</p>
          </div>
          <div className="tutorial-library-principle">
            <ShieldCheck size={21} />
            <div><strong>Four review stages</strong><span>Check geometry, mesh, convergence, and outputs before using a result.</span></div>
          </div>
        </header>

        <section className="tutorial-catalog-heading">
          <div><BookOpen size={18} /><div><h2>Golden path tutorials</h2><p>Each tutorial supplies geometry, validated parameters, and a controlled variant.</p></div></div>
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
              <h2>Aircraft lift and drag at two angles of attack</h2>
              <p>Set up the same aircraft at 0° and 5°, then check mesh quality, residual convergence, and force stability.</p>
              <div className="tutorial-card-meta">
                <span><Clock3 size={13} /> 15–20 min</span>
                <span><CheckCircle2 size={13} /> Browser guided</span>
                <span>Flow360 25.10</span>
              </div>
              <span className="tutorial-start">Start tutorial <ArrowRight size={15} /></span>
            </div>
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
          <Link className="tutorial-card" to="/tutorials/T05">
            <div className="tutorial-card-visual mesh-card-visual"><Target size={52} strokeWidth={1.1}/><span className="tutorial-id">T05</span><span className="tutorial-level">VOLUME MESHING</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">WAKE REFINEMENT</p><h2>Place volume cells along wake transport</h2><p>Assign near-body, structured-box, and axisymmetric controls by physical role—then compare a longer, tighter wake corridor.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 16–20 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
        </section>
      </main>
    </div>
  )
}
