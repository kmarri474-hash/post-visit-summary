import { Link, Outlet, useLocation } from "react-router-dom";
import { Stethoscope, ShieldCheck, Sparkles, Sun, Moon } from "lucide-react";
import { useTheme } from "./lib/theme";
import { motion, AnimatePresence } from "framer-motion";

const nav = [
  { to: "/intake", label: "Encounters", icon: Stethoscope },
];

export default function App() {
  const loc = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-brand-500/30">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/60 dark:bg-slate-950/60 border-b border-white/40 dark:border-slate-800/40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/intake" className="group flex items-center gap-4 transition-transform active:scale-95">
            <div className="logo-mark ring-4 ring-brand-500/10 group-hover:ring-brand-500/20 transition-all">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="leading-tight">
              <div className="font-black text-xl text-slate-900 dark:text-slate-50 tracking-tight flex items-center gap-2">
                Post-Visit Summary
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-md bg-brand-gradient text-[10px] text-white uppercase tracking-widest font-bold">Pro</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5 uppercase tracking-wider">
                <Sparkles className="w-3 h-3 text-brand-500" />
                AI Clinical Orchestration
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-2">
              {nav.map((n) => {
                const Icon = n.icon;
                const active = loc.pathname.startsWith(n.to);
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={`relative px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2 ${active
                        ? "text-brand-600 dark:text-brand-400"
                        : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                      }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="nav-active"
                        className="absolute inset-0 bg-brand-500/10 dark:bg-brand-500/20 rounded-xl"
                        transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
                      />
                    )}
                    <Icon className="w-4 h-4" />
                    {n.label}
                  </Link>
                );
              })}
            </nav>

            <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggle}
                aria-label="Toggle dark mode"
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                <AnimatePresence mode="wait">
                  {theme === "dark" ? (
                    <motion.div
                      key="moon"
                      initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
                    >
                      <Moon className="w-5 h-5" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="sun"
                      initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
                    >
                      <Sun className="w-5 h-5" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-6 py-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={loc.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="py-12 border-t border-slate-200/60 dark:border-slate-800/60 bg-white/40 dark:bg-slate-950/40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
            <ShieldCheck className="w-4 h-4" />
            Clinical Safety First
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium text-center md:text-left max-w-md leading-relaxed">
            All outputs are AI-generated drafts. Clinician sign-off is strictly required before final use.
            Full audit trail and evidence preservation is active.
          </p>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            © 2024 Post-Visit Summary Pro
          </div>
        </div>
      </footer>
    </div>
  );
}

