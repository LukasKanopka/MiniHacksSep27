"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"

const ClientRouter = dynamic(() => import("../components/ClientRouter"), {
  ssr: false,
  loading: () => (
    <div className="loading-container">
      <div className="liquid-glass-card" style={{ padding: "2rem", textAlign: "center" }}>
        <div className="loading-spinner"></div>
        <p style={{ marginTop: "1rem", color: "var(--text-primary)" }}>Loading SkillPool...</p>
      </div>
    </div>
  ),
})

export default function Page() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="loading-container">
        <div className="liquid-glass-card" style={{ padding: "2rem", textAlign: "center" }}>
          <div className="loading-spinner"></div>
          <p style={{ marginTop: "1rem", color: "var(--text-primary)" }}>Loading SkillPool...</p>
        </div>
      </div>
    )
  }

  return <ClientRouter />
}
