"use client"

import { useRef, useState } from "react"
import LogPanel from "../components/LogPanel"

export default function Upload() {
  const [drag, setDrag] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>(["🚀 System ready. Awaiting data upload..."])
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function validatePDFFile(file: File): boolean {
    // Check file extension
    const validExtensions = [".pdf"]
    const fileExtension = "." + file.name.split(".").pop()?.toLowerCase()

    // Check MIME type
    const validMimeTypes = ["application/pdf"]

    return validExtensions.includes(fileExtension) && validMimeTypes.includes(file.type)
  }

  function onFiles(files: FileList | null) {
    const f = files?.[0]
    if (!f) return

    if (!validatePDFFile(f)) {
      setError("❌ Invalid file type. Please select a PDF file only.")
      setFileName(null)
      setLog(["🚀 System ready. Awaiting data upload...", "❌ Upload failed: Invalid file type. PDF files only."])
      return
    }

    setError(null)
    setFileName(f.name)
    setLog([`📁 File selected: ${f.name} (${Math.round(f.size / 1024)} KB)`])
    setWorking(true)
    setProgress(0)

    const steps = [
      "Validating file structure",
      "Parsing skill taxonomies",
      "Extracting team relationships",
      "Building knowledge graph",
      "Optimizing search indices",
      "Finalizing data integration",
    ]

    let pct = 0,
      i = 0
    const id = setInterval(() => {
      pct += 16
      setProgress(Math.min(100, pct))
      if (i < steps.length) {
        setLog((prev) => [...prev, `⚡ ${steps[i]}...`])
        i++
      } else {
        clearInterval(id)
        setLog((prev) => [...prev, "✨ Upload completed successfully!"])
        setWorking(false)
      }
    }, 450)
  }

  return (
    <section className="grid">
      <div className="glass card">
        <h3
          style={{
            marginTop: 0,
            marginBottom: "16px",
            background: "var(--gradient-primary)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            fontSize: "24px",
            fontWeight: "700",
          }}
        >
          📤 Data Upload Center
        </h3>

        <p className="small" style={{ marginBottom: "24px", lineHeight: "1.6" }}>
          Supports PDF format only.
        </p>

        <div
          className={`drop ${drag ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            onFiles(e.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          aria-label="File upload dropzone"
          style={{
            cursor: "pointer",
            transition: "all 0.3s ease",
            minHeight: "120px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            fontWeight: "500",
          }}
        >
          {fileName ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>📄</div>
              <div style={{ color: "var(--text-primary)" }}>Selected: {fileName}</div>
            </div>
          ) : (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>{drag ? "⬇️" : "📁"}</div>
              <div>{drag ? "Drop your file here" : "Drop file here or click to browse"}</div>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={(e) => onFiles(e.target.files)}
          style={{ display: "none" }}
        />

        <div style={{ height: 20 }} />

        <div className="row" style={{ gap: "16px" }}>
          <button className="btn btn-accent pulse" onClick={() => inputRef.current?.click()} style={{ flex: 1 }}>
            📂 Choose File
          </button>
          <button
            className="btn pulse"
            disabled={!fileName || working}
            style={{
              flex: 1,
              opacity: !fileName || working ? 0.5 : 1,
              cursor: !fileName || working ? "not-allowed" : "pointer",
            }}
          >
            {working ? "⚡ Processing..." : "🚀 Start Upload"}
          </button>
        </div>

        {error && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "12px",
              fontSize: "14px",
              color: "#ef4444",
            }}
          >
            {error}
          </div>
        )}

        {fileName && !working && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px",
              background: "rgba(34, 197, 94, 0.1)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: "12px",
              fontSize: "14px",
              color: "#22c55e",
            }}
          >
            ✅ File ready for upload. Click "Start Upload" to begin processing.
          </div>
        )}
      </div>

      <LogPanel lines={log} working={working} progress={progress} />
    </section>
  )
}
