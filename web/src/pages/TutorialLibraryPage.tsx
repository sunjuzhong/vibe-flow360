import { ArrowRight, BookOpen, Box, Boxes, CarFront, CheckCircle2, CircleDot, Clock3, Droplets, Flame, Gauge, Plane, Rotate3D, ShieldCheck, Target, Waves, Waypoints } from 'lucide-react'
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
          <span>14 available</span>
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
          <Link className="tutorial-card" to="/tutorials/T02">
            <div className="tutorial-card-visual airfoil-card-visual"><Gauge size={52} strokeWidth={1.1}/><span className="tutorial-id">T02</span><span className="tutorial-level">OPERATING CONDITIONS</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">WIND-TUNNEL SIMILARITY</p><h2>Match Mach and Reynolds number</h2><p>Derive velocity, density, and dynamic pressure, then compare a Mach-only condition with the Reynolds-matched experiment.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 18–22 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
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
          <Link className="tutorial-card" to="/tutorials/T06">
            <div className="tutorial-card-visual airfoil-card-visual"><Box size={52} strokeWidth={1.1}/><span className="tutorial-id">T06</span><span className="tutorial-level">DOMAIN SETUP</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">EXTERNAL FARFIELD</p><h2>Choose automatic or CAD-defined boundaries</h2><p>Match body-only or fluid-volume CAD to the correct farfield workflow, then test whether an 8D boundary changes the solution.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 18–22 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T07">
            <div className="tutorial-card-visual mesh-card-visual"><Droplets size={52} strokeWidth={1.1}/><span className="tutorial-id">T07</span><span className="tutorial-level">INTERNAL FLOW</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">CLOSED DUCT MESHING</p><h2>Mesh the fluid passage and preserve pressure-loss features</h2><p>Identify the connected fluid volume, register its seed point, and compare global-only spacing with obstacle, support, and floor-layer controls.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 20–24 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T08">
            <div className="tutorial-card-visual airfoil-card-visual"><CarFront size={52} strokeWidth={1.1}/><span className="tutorial-id">T08</span><span className="tutorial-level">AUTOMOTIVE CFD</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">MOVING-GROUND WIND TUNNEL</p><h2>Match road and wheel relative motion</h2><p>Build an analytic test section, derive rolling-wheel speed, and compare a stationary floor with belts and rotating tyres.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 22–28 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T09">
            <div className="tutorial-card-visual mesh-card-visual"><Rotate3D size={52} strokeWidth={1.1}/><span className="tutorial-id">T09</span><span className="tutorial-level">ROTORCRAFT CFD</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">NESTED ROTATING ZONES</p><h2>Compose parent and child rotor motion</h2><p>Separate rotor walls, sliding mesh zones, and solver motion, then compare one shared frame with a parent-linked spherical child zone.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 22–28 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T10">
            <div className="tutorial-card-visual airfoil-card-visual"><Boxes size={52} strokeWidth={1.1}/><span className="tutorial-id">T10</span><span className="tutorial-level">SURFACE MESHING</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">MODULAR SNAPPY WORKFLOW</p><h2>Preserve heat-sink fins and cooling channels</h2><p>Relate octree levels, snapping, refinements, and quality limits to six thin fins and five narrow cooling passages.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 22–28 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T12">
            <div className="tutorial-card-visual mesh-card-visual"><Droplets size={52} strokeWidth={1.1}/><span className="tutorial-id">T12</span><span className="tutorial-level">LIQUID CFD</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">WATER + GRAVITY</p><h2>Separate hydrostatic head from current loading</h2><p>Configure Water and LiquidOperatingCondition, compare 39.24 kPa of hydrostatic head with 2.00 kPa of dynamic pressure, and add Gravity as one controlled change.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 20–25 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T13">
            <div className="tutorial-card-visual airfoil-card-visual"><Flame size={52} strokeWidth={1.1}/><span className="tutorial-id">T13</span><span className="tutorial-level">HIGH-TEMPERATURE CFD</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">THERMODYNAMIC MODELLING</p><h2>Compare constant gamma with NASA-9 gas properties</h2><p>Derive how temperature-dependent heat capacity changes sound speed and Mach, then compare a frozen N2-O2 mixture around a hot-exhaust probe.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 20–25 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T14">
            <div className="tutorial-card-visual mesh-card-visual"><Waves size={52} strokeWidth={1.1}/><span className="tutorial-id">T14</span><span className="tutorial-level">TURBULENCE MODELLING</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">RANS MODEL SENSITIVITY</p><h2>Compare SA and k-omega SST on a separated wake</h2><p>Relate closure variables to freestream turbulence inputs, then compare separation, base pressure, drag, wall treatment, mesh, convergence, and reference evidence.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 20–25 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
          <Link className="tutorial-card" to="/tutorials/T15">
            <div className="tutorial-card-visual mesh-card-visual"><Waves size={52} strokeWidth={1.1}/><span className="tutorial-id">T15</span><span className="tutorial-level">MODEL UPGRADE</span></div>
            <div className="tutorial-card-content"><p className="eyebrow">TRANSITION OR DDES</p><h2>Choose the missing physics near stall</h2><p>Distinguish transition-onset uncertainty from unsteady separation, then audit the AFT or DDES mesh, time, statistics, and validation evidence.</p><div className="tutorial-card-meta"><span><Clock3 size={13}/> 25–30 min</span><span><CheckCircle2 size={13}/> Browser guided</span><span>Flow360 25.10</span></div><span className="tutorial-start">Start tutorial <ArrowRight size={15}/></span></div>
          </Link>
        </section>
      </main>
    </div>
  )
}
