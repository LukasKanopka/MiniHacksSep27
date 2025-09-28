type LogProps = {
  lines: string[]
  working?: boolean
  progress?: number
}

export default function LogPanel({ lines, working = false, progress = 0 }: LogProps) {
  return (
    <div className="glass card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "16px" }}>
        <div className="small" style={{ fontWeight: "600", display: "flex", alignItems: "center", gap: "8px" }}>
          📊 Process Monitor
        </div>
        <div
          className="badge"
          style={{
            background: working ? "rgba(0, 212, 255, 0.1)" : "rgba(34, 197, 94, 0.1)",
            borderColor: working ? "rgba(0, 212, 255, 0.3)" : "rgba(34, 197, 94, 0.3)",
            color: working ? "#00d4ff" : "#22c55e",
            fontWeight: "600",
          }}
        >
          {working ? "🔄 Active" : "✅ Ready"}
        </div>
      </div>

      <div className="separator" />

      <div
        className="log"
        aria-live="polite"
        style={{
          background: "var(--glass-bg)",
          border: "1px solid var(--glass-border)",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              padding: "2px 0",
              color:
                l.includes("✨") || l.includes("✓")
                  ? "#22c55e"
                  : l.includes("❌") || l.includes("×")
                    ? "#f87171"
                    : l.includes("⚡") || l.includes("•")
                      ? "#00d4ff"
                      : "var(--text-secondary)",
            }}
          >
            {l}
          </div>
        ))}
      </div>

      <div style={{ height: 16 }} />

      <div className="progress" aria-hidden={!working}>
        <div style={{ width: `${progress}%` }} />
      </div>

      {working && (
        <div
          style={{
            marginTop: "8px",
            fontSize: "12px",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          Processing... {Math.round(progress)}%
        </div>
      )}
    </div>
  )
}
