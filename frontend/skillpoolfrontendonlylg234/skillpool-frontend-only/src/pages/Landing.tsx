"use client"

import { useNavigate } from "react-router-dom"

export default function Landing() {
  const nav = useNavigate()

  return (
    <section className="hero">
      <div className="hero-title-container">
        <h2 className="hero-title-line">Discover Talent,</h2>
        <h2 className="hero-title-line">Amplify Teams.</h2>
      </div>
      <p className="hero-sub">
        SkillPool revolutionizes team discovery with AI-powered expertise mapping. Find the perfect collaborators across
        projects and unlock your team's full potential with our next-generation talent intelligence platform.
      </p>
      <div className="cta-row">
        <button className="btn btn-accent pulse interactive-shape" onClick={() => nav("/search")}>
          Start Exploring
          <span style={{ fontSize: "12px" }}>→</span>
        </button>
        <button className="btn pulse interactive-shape" onClick={() => nav("/upload")}>
          Upload Data
          <span style={{ fontSize: "12px" }}>↑</span>
        </button>
      </div>
    </section>
  )
}
