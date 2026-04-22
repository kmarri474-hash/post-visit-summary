import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import EncounterIntake from "./pages/EncounterIntake";
import RunConsole from "./pages/RunConsole";
import DraftReview from "./pages/DraftReview";
import AuditTrail from "./pages/AuditTrail";
import AboutTopic from "./pages/AboutTopic";
import "./index.css";

// NOTE: We intentionally do NOT wrap in React.StrictMode because it triggers
// mount → cleanup → mount on every component in dev, which causes the SSE
// fetch to abort-and-restart within microseconds. That aborts our POST /run
// connection and the backend's asyncpg pool sees dangling connections.
// StrictMode is a dev-only check; production behaviour is unchanged.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route index element={<Navigate to="/intake" replace />} />
        <Route path="intake" element={<EncounterIntake />} />
        <Route path="run/:id" element={<RunConsole />} />
        <Route path="review/:id" element={<DraftReview />} />
        <Route path="audit/:id" element={<AuditTrail />} />
        <Route path="about/:topic" element={<AboutTopic />} />
      </Route>
    </Routes>
  </BrowserRouter>
);
