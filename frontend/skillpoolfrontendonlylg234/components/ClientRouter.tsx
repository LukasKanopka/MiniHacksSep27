"use client"

import { BrowserRouter as Router, Routes, Route } from "react-router-dom"
import App from "../skillpool-frontend-only/src/App"
import Landing from "../skillpool-frontend-only/src/pages/Landing"
import Search from "../skillpool-frontend-only/src/pages/Search"
import Upload from "../skillpool-frontend-only/src/pages/Upload"

// Import the styles
import "../skillpool-frontend-only/src/styles.css"

export default function ClientRouter() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Landing />} />
          <Route path="search" element={<Search />} />
          <Route path="upload" element={<Upload />} />
        </Route>
      </Routes>
    </Router>
  )
}
