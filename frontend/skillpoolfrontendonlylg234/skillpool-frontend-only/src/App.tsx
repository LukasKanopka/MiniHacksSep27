"use client"

import { NavLink, Outlet } from "react-router-dom"
import { useState, useEffect } from "react"
import { ThemeToggle } from "./components/ThemeToggle"

export default function App() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem("skillpool-theme")
    return saved ? JSON.parse(saved) : true // Default to dark mode
  })

  useEffect(() => {
    localStorage.setItem("skillpool-theme", JSON.stringify(isDark))
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light")
  }, [isDark])

  const toggleTheme = () => {
    setIsDark(!isDark)
  }

  return (
    <div className="container">
      <header className="header">
        <a className="brand" href="/">
          <img
            src={isDark ? "/skillpool-logo-light.svg" : "/skillpool-logo-dark.svg"}
            width={32}
            height={32}
            alt="SkillPool"
            style={{
              filter: "drop-shadow(0 0 12px rgba(0, 212, 255, 0.4))",
              animation: "logoGlow 3s ease-in-out infinite alternate",
              background: "transparent",
              borderRadius: "50%",
              objectFit: "contain",
            }}
          />
          <h1
            style={{
              background: "var(--gradient-primary)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
              fontSize: "22px",
              fontWeight: "800",
              letterSpacing: "-0.02em",
            }}
          >
            SkillPool
          </h1>
        </a>

        <div className="nav-container">
          <nav className="nav">
            <NavLink to="/" className={({ isActive }) => (isActive ? "active" : "")} style={{ position: "relative" }}>
              🏠 Home
            </NavLink>
            <NavLink
              to="/search"
              className={({ isActive }) => (isActive ? "active" : "")}
              style={{ position: "relative" }}
            >
              🔍 Search
            </NavLink>
            <NavLink
              to="/upload"
              className={({ isActive }) => (isActive ? "active" : "")}
              style={{ position: "relative" }}
            >
              📤 Upload
            </NavLink>
          </nav>

          <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
        </div>
      </header>

      <main style={{ minHeight: "calc(100vh - 200px)" }}>
        <Outlet />
      </main>

      <footer className="footer">
        <div
          style={{
            background: "var(--gradient-primary)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            fontWeight: "600",
          }}
        >
          SkillPool
        </div>
        <div style={{ fontSize: "12px", marginTop: "4px" }}>Powered by AI • Built for Teams</div>
      </footer>
    </div>
  )
}
