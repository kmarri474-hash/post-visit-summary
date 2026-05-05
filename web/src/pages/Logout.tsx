import { useState } from "react";
import { Link } from "react-router-dom";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { ShieldCheck, LogOut, LogIn, ShieldOff } from "lucide-react";
import { isSsoEnabled } from "../lib/auth/msalConfig";

export default function Logout() {
  if (!isSsoEnabled) return <SsoDisabledNotice />;
  return <LogoutAuthed />;
}

function SsoDisabledNotice() {
  return (
    <div className="bg-app min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md card-glass p-10 animate-slide-up text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300">
          <ShieldOff className="w-7 h-7" />
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-slate-50">
          SSO is disabled
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          The app is running in anonymous dev mode
          (<code className="font-mono text-xs">VITE_SSO_ENABLED=false</code>).
          There is no session to sign out of.
        </p>
        <Link to="/intake" className="btn btn-primary btn-lg w-full mt-6">
          Back to app
        </Link>
      </div>
    </div>
  );
}

function LogoutAuthed() {
  const isAuthenticated = useIsAuthenticated();
  const { instance, accounts } = useMsal();
  const [busy, setBusy] = useState(false);

  const account = accounts[0];
  const display = account?.name || account?.username;

  const onConfirm = () => {
    if (!account) return;
    setBusy(true);
    instance
      .logoutRedirect({
        account,
        // Land on /login with a "signed out" banner. We send users to the
        // registered redirect URI (/) and the SPA's RequireAuth gate forwards
        // unauthenticated users to /login?signedOut=1.
        postLogoutRedirectUri:
          (import.meta as any).env?.VITE_MSAL_POST_LOGOUT_REDIRECT_URI ??
          window.location.origin + "/",
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[auth] logoutRedirect failed", err);
        setBusy(false);
      });
  };

  return (
    <div className="bg-app min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md card-glass p-10 animate-slide-up">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            <ShieldCheck className="w-7 h-7" />
          </div>

          {isAuthenticated ? (
            <>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-50">
                Sign out?
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {display ? (
                  <>
                    You are signed in as{" "}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {display}
                    </span>
                    .
                  </>
                ) : (
                  "You are currently signed in."
                )}
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3 w-full">
                <Link to="/intake" className="btn btn-outline">
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy}
                  className="btn btn-primary"
                >
                  <LogOut className="w-4 h-4" />
                  {busy ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-50">
                You're signed out
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Your session has ended. Sign in again to continue.
              </p>
              <Link
                to="/login?signedOut=1"
                className="btn btn-primary btn-lg w-full mt-6"
              >
                <LogIn className="w-5 h-5" />
                Sign in again
              </Link>
            </>
          )}
        </div>

        <p className="mt-8 text-[11px] text-slate-400 dark:text-slate-500 text-center leading-relaxed">
          Signing out clears your local session. Your Microsoft Entra ID
          session may persist across other Optum apps until it expires.
        </p>
      </div>
    </div>
  );
}
