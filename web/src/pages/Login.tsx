import { useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { ShieldCheck, Sparkles, LogIn, CheckCircle2 } from "lucide-react";
import { loginRequest, isSsoEnabled } from "../lib/auth/msalConfig";

export default function Login() {
  // When SSO is off, /login should never gate the user — bounce straight in.
  if (!isSsoEnabled) return <SsoDisabledRedirect />;
  return <LoginAuthed />;
}

function SsoDisabledRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/intake", { replace: true });
  }, [navigate]);
  return null;
}

function LoginAuthed() {
  const isAuthenticated = useIsAuthenticated();
  const { instance, inProgress } = useMsal();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const signedOut = params.get("signedOut") === "1";

  useEffect(() => {
    if (isAuthenticated) navigate("/intake", { replace: true });
  }, [isAuthenticated, navigate]);

  const busy = inProgress !== InteractionStatus.None;

  const onSignIn = () => {
    instance.loginRedirect(loginRequest).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[auth] loginRedirect failed", err);
    });
  };

  return (
    <div className="bg-app min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md card-glass p-10 animate-slide-up">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="logo-mark ring-4 ring-brand-500/10 w-14 h-14 flex items-center justify-center rounded-2xl bg-brand-gradient text-white">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center justify-center gap-1.5">
              <Sparkles className="w-3 h-3 text-brand-500" />
              AI Clinical Orchestration
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-slate-50">
              Post-Visit Summary
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Sign in with your Optum corporate account to continue.
            </p>
          </div>
        </div>

        {signedOut && (
          <div className="mt-6 flex items-start gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>You have been signed out. Sign in again to continue.</span>
          </div>
        )}

        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className="btn btn-primary btn-lg w-full mt-8"
        >
          <LogIn className="w-5 h-5" />
          {busy ? "Redirecting…" : "Sign in with Microsoft"}
        </button>

        <p className="mt-6 text-[11px] text-slate-400 dark:text-slate-500 text-center leading-relaxed">
          Authentication via HCP SSO (Microsoft Entra ID).
          <br />
          Access is restricted to members of the linked Active Directory group.
        </p>

        <div className="mt-6 text-center">
          <Link
            to="/logout"
            className="text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-brand-500"
          >
            Trouble signing in?
          </Link>
        </div>
      </div>
    </div>
  );
}
