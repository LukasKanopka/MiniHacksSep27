"use client"

import type React from "react"

import { useRef, useState, useEffect } from "react"

type Props = {
  initial?: string
  loading: boolean
  onSubmit: (q: string) => void
  samples?: string[]
}

const AUTOCOMPLETE_SUGGESTIONS = [
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
]

export default function SearchBar({ initial = "", loading, onSubmit, samples }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(initial)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([])

  useEffect(() => {
    if (query.length > 2) {
      const filtered = AUTOCOMPLETE_SUGGESTIONS.filter((suggestion) =>
        suggestion.toLowerCase().includes(query.toLowerCase()),
      ).slice(0, 5) // Limit to 5 suggestions
      setFilteredSuggestions(filtered)
      setShowSuggestions(filtered.length > 0)
    } else {
      setShowSuggestions(false)
    }
  }, [query])

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion)
    setShowSuggestions(false)
    if (input.current) {
      input.current.value = suggestion
    }
    onSubmit(suggestion)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)
  }

  const handleInputBlur = () => {
    // Delay hiding to allow suggestion clicks
    setTimeout(() => setShowSuggestions(false), 200)
  }

  return (
    <div className="glass card pill-shape" role="search" aria-label="Skill search">
      <div className="row">
        <div style={{ position: "relative", flex: 1 }}>
          <input
            ref={input}
            className="input"
            defaultValue={initial}
            placeholder="🔍 Ask: Who are the React experts with GraphQL experience?"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit(input.current?.value || "")
            }}
            onChange={handleInputChange}
            onFocus={() => query.length > 2 && setShowSuggestions(filteredSuggestions.length > 0)}
            onBlur={handleInputBlur}
            aria-label="Search query"
            style={{ paddingLeft: "20px" }}
          />

          {showSuggestions && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "var(--dropdown-solid-bg)",
                border: "1px solid var(--glass-border)",
                borderRadius: "12px",
                marginTop: "8px",
                zIndex: 9999,
                maxHeight: "200px",
                overflowY: "auto",
                boxShadow: "0 8px 32px var(--glass-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
              }}
            >
              {filteredSuggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion)}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    background: "transparent",
                    border: "none",
                    color: "var(--text-primary)",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: "14px",
                    borderBottom: index < filteredSuggestions.length - 1 ? "1px solid var(--glass-border)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--glass-bg)"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent"
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="btn btn-accent"
          disabled={loading}
          onClick={() => onSubmit(input.current?.value || "")}
          style={{ minWidth: "120px" }}
        >
          {loading ? (
            <>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚡</span>
              Searching
            </>
          ) : (
            <>
              Search
              <span style={{ fontSize: "12px" }}>→</span>
            </>
          )}
        </button>
      </div>

      {samples && samples.length > 0 && (
        <div style={{ marginTop: 20, position: "relative", zIndex: 1 }}>
          <span className="small" style={{ fontWeight: "600", marginBottom: "12px", display: "block" }}>
            💡 Try these sample queries:
          </span>
          <div className="samples-inline">
            {samples.map((s) => (
              <button
                key={s}
                className="btn sample-btn"
                onClick={() => onSubmit(s)}
                style={{
                  fontSize: "14px",
                  padding: "10px 16px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
