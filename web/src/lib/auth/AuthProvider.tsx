import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { MsalProvider, useIsAuthenticated, useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { msalInstance, isSsoEnabled } from "./msalConfig";

export function AuthProvider({ children }: { children: ReactNode }) {
  // When SSO is disabled, skip the MsalProvider entirely so the rest of the
  // tree renders without ever touching MSAL state. Components that call
  // useMsal()/useIsAuthenticated() must guard with isSsoEnabled.
  if (!isSsoEnabled) return <>{children}</>;
  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}

/**
 * Gates child routes behind an authenticated MSAL session.
 * Unauthenticated users are forwarded to /login (preserving the original path
 * in router state so we can return them after sign-in).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  // Feature-flag bypass — render children directly. We must short-circuit
  // BEFORE calling any MSAL hooks because <MsalProvider> isn't mounted.
  if (!isSsoEnabled) return <>{children}</>;

  return <RequireAuthGate>{children}</RequireAuthGate>;
}

function RequireAuthGate({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const location = useLocation();

  // While MSAL is still processing a redirect response, don't navigate yet
  // or we'll bounce out of the auth-code exchange.
  if (
    inProgress !== InteractionStatus.None &&
    inProgress !== InteractionStatus.Startup
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Signing you in…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <>{children}</>;
}
