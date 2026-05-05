import { Link } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { LogOut, UserRound, ShieldOff } from "lucide-react";
import { isSsoEnabled } from "../lib/auth/msalConfig";

export default function UserMenu() {
  // Feature-flag bypass: render a clear "SSO off" indicator instead of
  // calling MSAL hooks (the MsalProvider isn't mounted in this mode).
  if (!isSsoEnabled) {
    return (
      <div
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-bold"
        title="SSO is disabled via VITE_SSO_ENABLED=false"
      >
        <ShieldOff className="w-4 h-4" />
        SSO off (dev)
      </div>
    );
  }

  return <UserMenuAuthed />;
}

function UserMenuAuthed() {
  const { accounts } = useMsal();
  const account = accounts[0];

  if (!account) return null;

  const display = account.name || account.username;

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/profile"
        title={`${account.username} — view profile`}
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold max-w-[220px] hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
      >
        <UserRound className="w-4 h-4 text-brand-500 shrink-0" />
        <span className="truncate">{display}</span>
      </Link>
      <Link
        to="/logout"
        aria-label="Sign out"
        title="Sign out"
        className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
      >
        <LogOut className="w-4 h-4" />
      </Link>
    </div>
  );
}
