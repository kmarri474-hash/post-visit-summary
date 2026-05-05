import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { EventType, type AuthenticationResult } from "@azure/msal-browser";
import App from "./App";
import EncounterIntake from "./pages/EncounterIntake";
import RunConsole from "./pages/RunConsole";
import DraftReview from "./pages/DraftReview";
import AuditTrail from "./pages/AuditTrail";
import AboutTopic from "./pages/AboutTopic";
import Login from "./pages/Login";
import Logout from "./pages/Logout";
import Profile from "./pages/Profile";
import { AuthProvider, RequireAuth } from "./lib/auth/AuthProvider";
import { msalInstance, isSsoEnabled } from "./lib/auth/msalConfig";
import "./index.css";

// NOTE: We intentionally do NOT wrap in React.StrictMode because it triggers
// mount → cleanup → mount on every component in dev, which causes the SSE
// fetch to abort-and-restart within microseconds. That aborts our POST /run
// connection and the backend's asyncpg pool sees dangling connections.
// StrictMode is a dev-only check; production behaviour is unchanged.

// MSAL v3 requires explicit init + handleRedirectPromise BEFORE any React
// component mounts that calls msalInstance APIs.
async function bootstrap() {
  if (isSsoEnabled) {
    await msalInstance.initialize();

    // Promote a returning auth-code response into an active account.
    const result = await msalInstance.handleRedirectPromise();
    if (result?.account) {
      msalInstance.setActiveAccount(result.account);
    } else if (!msalInstance.getActiveAccount()) {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) msalInstance.setActiveAccount(accounts[0]);
    }

    // Keep the active account in sync on subsequent logins (e.g. account switch).
    msalInstance.addEventCallback((event) => {
      if (
        event.eventType === EventType.LOGIN_SUCCESS ||
        event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS
      ) {
        const payload = event.payload as AuthenticationResult | null;
        if (payload?.account) msalInstance.setActiveAccount(payload.account);
      }
    });
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public auth routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/logout" element={<Logout />} />

          {/* Protected app shell */}
          <Route
            path="/"
            element={
              <RequireAuth>
                <App />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/intake" replace />} />
            <Route path="intake" element={<EncounterIntake />} />
            <Route path="run/:id" element={<RunConsole />} />
            <Route path="review/:id" element={<DraftReview />} />
            <Route path="audit/:id" element={<AuditTrail />} />
            <Route path="about/:topic" element={<AboutTopic />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[bootstrap] failed to initialize app", err);
});
