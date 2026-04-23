import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { runEncounterSSE, type AgentEvent } from "../lib/sse";
import { useTheme } from "../lib/theme";
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Stethoscope,
  ListTree,
  FileText,
  UserRound,
  Tags,
  Search,
  Shield,
  Activity,
  Terminal
} from "lucide-react";
import type { ComponentType } from "react";
import WaitingAnimation from "../components/WaitingAnimation";

type NodeKey =
  | "intake"
  | "structurer"
  | "note_drafter"
  | "pcp_summary"
  | "coding"
  | "gap_detector"
  | "guardrail";

const NODES: NodeKey[] = [
  "intake",
  "structurer",
  "note_drafter",
  "pcp_summary",
  "coding",
  "gap_detector",
  "guardrail",
];
const NODE_LABELS: Record<NodeKey, string> = {
  intake: "Intake normalizer",
  structurer: "Encounter structurer",
  note_drafter: "Clinical note drafter",
  pcp_summary: "PCP summary drafter",
  coding: "Coding agent (ICD-10 / CPT / E/M / HCC)",
  gap_detector: "Documentation gap detector",
  guardrail: "Guardrail review",
};
const NODE_SHORT: Record<NodeKey, string> = {
  intake: "Intake",
  structurer: "Structurer",
  note_drafter: "SOAP note",
  pcp_summary: "PCP handoff",
  coding: "Coding",
  gap_detector: "Gaps",
  guardrail: "Guardrail",
};
const NODE_ICON: Record<NodeKey, ComponentType<{ className?: string }>> = {
  intake: Stethoscope,
  structurer: ListTree,
  note_drafter: FileText,
  pcp_summary: UserRound,
  coding: Tags,
  gap_detector: Search,
  guardrail: Shield,
};

/* Flowchart layout */
type Pos = { x: number; y: number };
const LAYOUT: Record<NodeKey, Pos> = {
  intake: { x: 100, y: 210 },
  structurer: { x: 290, y: 210 },
  note_drafter: { x: 560, y: 60 },
  pcp_summary: { x: 560, y: 160 },
  coding: { x: 560, y: 260 },
  gap_detector: { x: 560, y: 360 },
  guardrail: { x: 830, y: 210 },
};
const EDGES: Array<[NodeKey, NodeKey]> = [
  ["intake", "structurer"],
  ["structurer", "note_drafter"],
  ["structurer", "pcp_summary"],
  ["structurer", "coding"],
  ["structurer", "gap_detector"],
  ["note_drafter", "guardrail"],
  ["pcp_summary", "guardrail"],
  ["coding", "guardrail"],
  ["gap_detector", "guardrail"],
];

type Status = "pending" | "running" | "done" | "error";

export default function RunConsole() {
  const { id } = useParams();
  const nav = useNavigate();
  const [statuses, setStatuses] = useState<Record<string, Status>>(
    Object.fromEntries(NODES.map((n) => [n, "pending"])) as any
  );
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [done, setDone] = useState(false);
  const [requiresReview, setRequiresReview] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let cancelled = false;

    runEncounterSSE(
      id,
      (ev) => {
        if (cancelled) return;
        setEvents((es) => [...es, ev]);
        if (ev.node && ev.type === "node_started") {
          setStatuses((s) => ({ ...s, [ev.node!]: "running" }));
          if (ev.message) setMessages((m) => ({ ...m, [ev.node!]: ev.message! }));
        } else if (ev.node && ev.type === "node_completed") {
          setStatuses((s) => ({ ...s, [ev.node!]: "done" }));
          if (ev.message) setMessages((m) => ({ ...m, [ev.node!]: ev.message! }));
        } else if (ev.type === "node_error") {
          setStatuses((s) => ({ ...s, [ev.node || "graph"]: "error" }));
        } else if (ev.type === "run_completed") {
          setDone(true);
          setRequiresReview(Boolean(ev.data?.requires_human_review));
        }
      },
      controller.signal
    ).catch(() => { });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const total = NODES.length;
  const completed = NODES.filter((n) => statuses[n] === "done").length;
  const progress = Math.round((completed / total) * 100);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-1 lg:grid-cols-3 gap-8"
    >
      <section className="card-glass p-8 lg:col-span-2 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-gradient flex items-center justify-center text-white shadow-brand">
                <Activity className="w-5 h-5" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Agent run</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium ml-1">
              Multi-agent orchestration · Streamed via SSE
            </p>
          </div>

          <AnimatePresence>
            {done && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="btn btn-primary btn-lg px-8 shadow-brand group"
                onClick={() => nav(`/review/${id}`)}
              >
                <span>Review drafts</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Progress Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
            <span className="flex items-center gap-2">
              {completed === total ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />
              )}
              {completed} of {total} nodes complete
            </span>
            <span className="text-brand-600 dark:text-brand-400">{progress}%</span>
          </div>
          <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5 ring-1 ring-slate-200/50 dark:ring-slate-700/50">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-brand-gradient rounded-full shadow-sm"
            />
          </div>
        </div>

        {/* Flowchart */}
        <div className="relative rounded-3xl bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800 p-4 overflow-hidden">
          <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-800/20 [mask-image:radial-gradient(ellipse_at_center,white,transparent)]" />
          <FlowGraph statuses={statuses} />
        </div>

        {/* Funny waiting animation */}
        <AnimatePresence>
          {!done && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="pt-4"
            >
              <WaitingAnimation isRunning={!done} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active node message strip */}
        <div className="min-h-[2rem] flex items-center justify-center">
          <AnimatePresence mode="wait">
            {(() => {
              const running = NODES.find((n) => statuses[n] === "running");
              if (running) {
                return (
                  <motion.div
                    key={running}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2 bg-white/50 dark:bg-slate-800/50 px-4 py-2 rounded-full border border-slate-100 dark:border-slate-700/50 backdrop-blur-sm"
                  >
                    <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {NODE_SHORT[running]}:
                    </span>
                    <span className="italic">{messages[running] || "working…"}</span>
                  </motion.div>
                );
              }
              return null;
            })()}
          </AnimatePresence>
        </div>

        {done && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`p-5 rounded-2xl text-sm border-2 flex items-start gap-4 ${requiresReview
              ? "bg-amber-50/50 dark:bg-amber-900/10 text-amber-800 dark:text-amber-400 border-amber-100 dark:border-amber-900/30"
              : "bg-emerald-50/50 dark:bg-emerald-900/10 text-emerald-800 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30"
              }`}
          >
            {requiresReview ? (
              <AlertTriangle className="w-6 h-6 shrink-0" />
            ) : (
              <CheckCircle2 className="w-6 h-6 shrink-0" />
            )}
            <div>
              <div className="font-bold mb-1">
                {requiresReview ? "Human review required" : "Draft generated successfully"}
              </div>
              <div className="opacity-80">
                {requiresReview
                  ? "Guardrail flagged this draft for human review. Please check the Draft Review page for details."
                  : "Draft generated. Clinician sign-off is still required before final use."}
              </div>
            </div>
          </motion.div>
        )}
      </section>

      <section className="card-glass p-0 flex flex-col overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <Terminal className="w-4 h-4 text-brand-500" />
            Event log
          </h3>
          <span className="badge badge-soft px-2 py-0.5 rounded-full text-[10px] font-bold">{events.length}</span>
        </div>
        <div className="flex-1 min-h-[400px] lg:h-auto overflow-auto text-[11px] font-mono bg-slate-950 text-slate-300 p-6 space-y-2 custom-scrollbar">
          {events.length === 0 && (
            <div className="text-slate-600 italic flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Establishing stream connection…
            </div>
          )}
          {events.map((e, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="leading-relaxed border-l-2 border-slate-800 pl-3 py-0.5 hover:bg-white/5 transition-colors"
            >
              <span className="text-slate-600 font-bold">[{e.type}]</span>{" "}
              <span className="text-brand-400 font-bold">{e.node || "system"}</span>{" "}
              <span className="text-slate-400">{e.message}</span>
            </motion.div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>
    </motion.div>
  );
}

/* ---------- Flowchart subcomponent ---------- */

const W = 1000;
const H = 420;
const NODE_W = 180;
const NODE_H = 68;

function FlowGraph({ statuses }: { statuses: Record<string, Status> }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="w-full overflow-x-auto custom-scrollbar">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[380px] sm:h-[420px] select-none"
        role="img"
        aria-label="Agent graph"
      >
        <defs>
          <linearGradient id="edge-active" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Edges */}
        {EDGES.map(([from, to]) => {
          const a = LAYOUT[from];
          const b = LAYOUT[to];
          const x1 = a.x + NODE_W / 2;
          const y1 = a.y;
          const x2 = b.x - NODE_W / 2;
          const y2 = b.y;
          const dx = Math.max(40, (x2 - x1) / 2);
          const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          const active = statuses[from] === "done" || statuses[from] === "running";
          const isRunning = statuses[from] === "running";

          return (
            <g key={`${from}-${to}`}>
              <path
                d={d}
                fill="none"
                strokeWidth={active ? 3 : 1.5}
                stroke={active ? "url(#edge-active)" : isDark ? "rgba(71,85,105,0.3)" : "rgba(203,213,225,0.8)"}
                strokeDasharray={isRunning ? "8 8" : undefined}
                className={isRunning ? "animate-[dash_1.5s_linear_infinite]" : ""}
                markerEnd="url(#arrow)"
                color={active ? "#a855f7" : isDark ? "#334155" : "#cbd5e1"}
                style={{ transition: "all 0.5s ease" }}
              />
            </g>
          );
        })}

        {/* Nodes */}
        {NODES.map((n) => {
          const { x, y } = LAYOUT[n];
          const st = statuses[n];
          const Icon = NODE_ICON[n];

          const isDone = st === "done";
          const isRunning = st === "running";
          const isError = st === "error";

          const fill = isDark
            ? isDone ? "rgba(16, 185, 129, 0.1)" : isRunning ? "rgba(99, 102, 241, 0.1)" : isError ? "rgba(244, 63, 94, 0.1)" : "rgba(15, 23, 42, 0.4)"
            : isDone ? "#f0fdf4" : isRunning ? "#f5f3ff" : isError ? "#fff1f2" : "#ffffff";

          const stroke = isDone ? "#10b981" : isRunning ? "#6366f1" : isError ? "#f43f5e" : isDark ? "#334155" : "#e2e8f0";

          const labelColor = isDark
            ? isDone ? "#6ee7b7" : isRunning ? "#c7d2fe" : isError ? "#fda4af" : "#94a3b8"
            : isDone ? "#065f46" : isRunning ? "#4338ca" : isError ? "#be123c" : "#475569";

          return (
            <g
              key={n}
              transform={`translate(${x - NODE_W / 2}, ${y - NODE_H / 2})`}
              style={{ transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)" }}
            >
              {isRunning && (
                <rect
                  x={-4}
                  y={-4}
                  width={NODE_W + 8}
                  height={NODE_H + 8}
                  rx={20}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth={2}
                  opacity="0.4"
                  className="animate-pulse"
                />
              )}

              <rect
                width={NODE_W}
                height={NODE_H}
                rx={16}
                fill={fill}
                stroke={stroke}
                strokeWidth={isRunning ? 2.5 : 1.5}
                className="shadow-sm"
                style={{ filter: isRunning ? "url(#glow)" : "none" }}
              />

              <foreignObject x="0" y="0" width={NODE_W} height={NODE_H}>
                <div
                  // @ts-ignore
                  xmlns="http://www.w3.org/1999/xhtml"
                  className="w-full h-full flex items-center gap-3 px-4"
                >
                  <div
                    className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-all duration-500 ${isDone ? "bg-emerald-500 text-white shadow-emerald-500/20" :
                        isRunning ? "bg-brand-gradient text-white shadow-brand" :
                          isError ? "bg-rose-500 text-white shadow-rose-500/20" :
                            "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                      }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : isRunning ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : isError ? (
                      <AlertTriangle className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-xs font-bold truncate transition-colors duration-500"
                      style={{ color: labelColor }}
                    >
                      {NODE_SHORT[n]}
                    </div>
                    <div
                      className={`text-[9px] uppercase tracking-[0.15em] font-bold transition-colors duration-500 ${isDone ? "text-emerald-500" :
                          isRunning ? "text-brand-500" :
                            isError ? "text-rose-500" :
                              "text-slate-400 dark:text-slate-500"
                        }`}
                    >
                      {st}
                    </div>
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })}

        <style>{`@keyframes dash { to { stroke-dashoffset: -32 } }`}</style>
      </svg>
    </div>
  );
}

