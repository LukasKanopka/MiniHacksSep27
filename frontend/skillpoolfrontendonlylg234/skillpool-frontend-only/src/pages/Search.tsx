"use client"

import { useMemo, useState } from "react"
import SearchBar from "../components/SearchBar"
import LogPanel from "../components/LogPanel"

const STEPS = [
  "Initializing neural pathways",
  "Parsing query semantics",
  "Mapping skill vectors",
  "Traversing knowledge graph",
  "Computing relevance scores",
  "Synthesizing results",
]

const ALL_SAMPLE_QUERIES = [
  "Senior React developers with GraphQL experience",
  "Data scientists proficient in Python and TensorFlow",
  "Full-stack developers with Node.js and MongoDB",
  "DevOps engineers experienced with AWS and Docker",
  "Frontend developers skilled in Vue.js and TypeScript",
  "Backend developers with Java and Spring Boot",
  "Mobile developers with React Native experience",
  "UI/UX designers with Figma and Adobe Creative Suite",
  "Machine learning engineers with PyTorch",
  "Cloud architects with Azure and Kubernetes",
  "Cybersecurity specialists with penetration testing",
  "Product managers with Agile methodology",
  "QA engineers with automated testing frameworks",
  "Database administrators with PostgreSQL",
  "Blockchain developers with Solidity",
  "iOS developers with Swift and SwiftUI",
  "Android developers with Kotlin",
  "Game developers with Unity and C#",
  "Data analysts with SQL and Tableau",
  "Technical writers with API documentation",
  "Scrum masters with team leadership experience",
  "Solutions architects with microservices",
  "Site reliability engineers with monitoring tools",
  "Business analysts with requirements gathering",
  "Digital marketing specialists with SEO",
]

function getRandomSamples(count = 3): string[] {
  const shuffled = [...ALL_SAMPLE_QUERIES].sort(() => 0.5 - Math.random())
  return shuffled.slice(0, count)
}

export default function Search() {
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState<string[]>(["System ready. Awaiting query..."])
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const samples = useMemo(() => getRandomSamples(3), [])

  function fakeRun(q: string) {
    const qtrim = q.trim()
    if (!qtrim) return
    setError(null)
    setLoading(true)
    setProgress(0)
    setLog([`🔍 Analyzing: "${qtrim}"`])
    const shouldFail = /error/i.test(qtrim)
    let pct = 0,
      step = 0
    const id = setInterval(() => {
      pct += 15
      setProgress(Math.min(100, pct))
      if (step < STEPS.length) {
        setLog((prev) => [...prev, `⚡ ${STEPS[step]}...`])
        step++
      } else {
        clearInterval(id)
        if (shouldFail) {
          setError("Query processing failed. Please try again.")
          setLog((prev) => [...prev, "❌ Process terminated."])
        } else {
          setLog((prev) => [...prev, "✨ Analysis complete. Results ready."])
        }
        setLoading(false)
      }
    }, 400)
  }

  return (
    <section style={{ display: "grid", gap: 24 }}>
      <SearchBar loading={loading} onSubmit={fakeRun} samples={samples} />
      {error && (
        <div
          className="glass card"
          role="alert"
          style={{
            borderColor: "rgba(244, 63, 94, 0.3)",
            background: "rgba(244, 63, 94, 0.05)",
          }}
        >
          <div style={{ color: "#f87171", fontWeight: "600" }}>⚠️ {error}</div>
        </div>
      )}
      <div className="grid">
        <div className="glass card">
          <div className="small" style={{ marginBottom: "16px", fontWeight: "600" }}>
            🎯 Search Results
          </div>
          <div className="separator" />
          <div
            className="small"
            style={{
              textAlign: "center",
              padding: "32px",
              color: "var(--text-muted)",
            }}
          >
            {loading ? "🔄 Processing your query..." : "💡 Results will appear here after search"}
          </div>
        </div>
        <LogPanel lines={log} working={loading} progress={progress} />
      </div>
    </section>
  )
}
