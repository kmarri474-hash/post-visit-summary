import { useState } from "react";
import { Link } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import {
  UserRound,
  Mail,
  Building2,
  Fingerprint,
  Clock,
  Copy,
  Check,
  LogOut,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { isSsoEnabled } from "../lib/auth/msalConfig";

function formatExp(exp: number | undefined): string {
  if (!exp) return "—";
  try {
    return new Date(exp * 1000).toLocaleString();
  } catch {
    return String(exp);
  }
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/60 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60">
      <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </div>
        <div className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100 break-all">
          {value || "—"}
        </div>
      </div>
    </div>
  );
}

export default function Profile() {
  if (!isSsoEnabled) return <ProfileSsoDisabled />;
  return <ProfileAuthed />;
}

function ProfileSsoDisabled() {
  return (
    <div className="max-w-2xl mx-auto card-glass p-8 text-center">
      <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300">
        <ShieldOff className="w-7 h-7" />
      </div>
      <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-slate-50">
        Profile unavailable
      </h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        SSO is disabled (<code className="font-mono text-xs">VITE_SSO_ENABLED=false</code>),
        so there is no signed-in user to display. Re-enable SSO and sign in
        to view your AAD claims.
      </p>
    </div>
  );
}

function ProfileAuthed() {
  const { accounts } = useMsal();
  const account = accounts[0];
  const [copied, setCopied] = useState(false);

  if (!account) {
    return (
      <div className="card-glass p-8 max-w-2xl mx-auto text-center text-slate-500">
        No active account.
      </div>
    );
  }

  const claims = (account.idTokenClaims ?? {}) as Record<string, any>;
  const groups: string[] = Array.isArray(claims.groups) ? claims.groups : [];
  const roles: string[] = Array.isArray(claims.roles) ? claims.roles : [];

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(claims, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-brand-500" />
            Signed-in user
          </div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-50">
            Profile
          </h1>
        </div>
        <Link to="/logout" className="btn btn-outline">
          <LogOut className="w-4 h-4" />
          Sign out
        </Link>
      </div>

      <div className="card-glass p-6 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-brand-gradient text-white flex items-center justify-center text-2xl font-black shrink-0">
          {(account.name || account.username || "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-xl font-black text-slate-900 dark:text-slate-50 truncate">
            {account.name || account.username}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
            {account.username}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field icon={UserRound} label="Display name" value={account.name} />
        <Field icon={Mail} label="Username (UPN)" value={account.username} />
        <Field
          icon={Fingerprint}
          label="Object ID (oid)"
          value={account.localAccountId || claims.oid}
        />
        <Field
          icon={Building2}
          label="Tenant ID"
          value={account.tenantId || claims.tid}
        />
        <Field
          icon={Clock}
          label="ID token expires"
          value={formatExp(claims.exp)}
        />
        <Field
          icon={ShieldCheck}
          label="Auth method"
          value={Array.isArray(claims.amr) ? claims.amr.join(", ") : claims.amr}
        />
      </div>

      {(groups.length > 0 || roles.length > 0) && (
        <div className="card-glass p-6 space-y-4">
          {groups.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                Groups ({groups.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => (
                  <span key={g} className="badge badge-soft">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
          {roles.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                Roles ({roles.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => (
                  <span key={r} className="badge badge-soft">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card-glass p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Raw ID token claims
          </div>
          <button type="button" onClick={onCopy} className="btn btn-outline !py-1.5 !px-3 text-xs">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
        <pre className="custom-scrollbar overflow-auto max-h-80 text-xs bg-slate-900/95 text-slate-100 rounded-xl p-4 font-mono leading-relaxed">
{JSON.stringify(claims, null, 2)}
        </pre>
      </div>
    </div>
  );
}
