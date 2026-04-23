import { Link, Outlet, useLocation } from "react-router-dom";
import { Stethoscope, ShieldCheck, Sparkles, Sun, Moon } from "lucide-react";
import { useTheme } from "./lib/theme";

const nav = [
  { to: "/intake", label: "Intake", icon: Stethoscope },
];

export default function App() {
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 dark:bg-slate-950/60 border-b border-slate-200/70 dark:border-slate-800/70">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link to="/intake" className="flex items-center gap-3">
            <span className="logo-mark">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div className="leading-tight">
              <div className="font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                Post-Visit Summary
                <span className="text-slate-400 font-semibold"> · </span>
                <span className="bg-clip-text text-transparent bg-brand-gradient">Coding Agent</span>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-accent-500" />
                Multi-agent clinical drafting with evidence & guardrails
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {!loc.pathname.startsWith("/review") && (
              <span className="badge badge-brand hidden sm:inline-flex">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                Draft — clinician review required
              </span>
            )}
            <nav className="flex items-center gap-1">
              {nav.map((n) => {
                const Icon = n.icon;
                const active = loc.pathname.startsWith(n.to);
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={`btn ${active ? "btn-primary" : "btn-ghost"}`}
                  >
                    <Icon className="w-4 h-4" /> {n.label}
                  </Link>
                );
              })}
              <button
                type="button"
                onClick={toggle}
                aria-label="Toggle dark mode"
                title={theme === "dark" ? "Switch to light" : "Switch to dark"}
                className="btn btn-ghost !px-2"
              >
                <span className="relative block w-4 h-4">
                  <Sun
                    className={`absolute inset-0 w-4 h-4 transition-all duration-300 ${
                      theme === "dark" ? "opacity-0 rotate-90" : "opacity-100 rotate-0"
                    }`}
                  />
                  <Moon
                    className={`absolute inset-0 w-4 h-4 transition-all duration-300 ${
                      theme === "dark" ? "opacity-100 rotate-0" : "opacity-0 -rotate-90"
                    }`}
                  />
                </span>
              </button>
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        <div key={loc.pathname} className="route-enter">
          <Outlet />
        </div>
      </main>
      <footer className="text-center text-xs text-slate-500 dark:text-slate-400 py-6 border-t border-slate-200/60 dark:border-slate-800/60 bg-white/40 dark:bg-slate-950/40 backdrop-blur-sm">
        All outputs are drafts. Clinician sign-off required before use. Full audit trail preserved.
      </footer>
    </div>
  );
}
