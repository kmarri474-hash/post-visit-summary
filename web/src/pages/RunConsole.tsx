import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
} from "lucide-react";
import type { ComponentType } from "react";

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

/* Flowchart layout (percentages of the 1000x420 viewBox). Kept simple so the
   SVG rescales gracefully on mobile. */
type Pos = { x: number; y: number };
const LAYOUT: Record<NodeKey, Pos> = {
  intake:       { x: 100, y: 210 },
  structurer:   { x: 290, y: 210 },
  note_drafter: { x: 560, y: 60  },
  pcp_summary:  { x: 560, y: 160 },
  coding:       { x: 560, y: 260 },
  gap_detector: { x: 560, y: 360 },
  guardrail:    { x: 830, y: 210 },
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
  const started = useRef(false);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let cancelled = false;
    console.log("[RunConsole] starting SSE for", id);

    runEncounterSSE(
      id,
      (ev) => {
        if (cancelled) return;
        console.log("[RunConsole] event", ev.type, ev.node || "", ev.message || "");
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
    )
      .then(() => console.log("[RunConsole] stream ended"))
      .catch((e) => {
        if (e?.name === "AbortError") {
          console.log("[RunConsole] stream aborted");
        } else {
          console.error("[RunConsole] stream failed", e);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  const total = NODES.length;
  const completed = NODES.filter((n) => statuses[n] === "done").length;
  const progress = Math.round((completed / total) * 100);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="card p-6 lg:col-span-2">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div>
            <h2 className="font-semibold text-lg">Agent run</h2>
            <p className="text-xs text-slate-500">
              Structurer → drafters (parallel) → guardrail · streamed via SSE
            </p>
          </div>
          <button
            className="btn btn-primary"
            disabled={!done}
            onClick={() => nav(`/review/${id}`)}
          >
            Review drafts <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mt-4 mb-6">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-slate-500 mb-1.5">
            <span>
              {completed} of {total} nodes complete
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden ring-1 ring-slate-200/70 dark:ring-slate-700/60">
            <div
              className="h-full bg-brand-gradient rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Flowchart */}
        <FlowGraph statuses={statuses} />

        {/* Active node message strip */}
        <div className="mt-4 text-sm text-slate-600 dark:text-slate-300 min-h-[1.25rem]">
          {(() => {
            const running = NODES.find((n) => statuses[n] === "running");
            if (running) {
              return (
                <span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {NODE_LABELS[running]}:
                  </span>{" "}
                  {messages[running] || "working…"}
                </span>
              );
            }
            return null;
          })()}
        </div>

        {done && (
          <div
            className={`mt-6 p-4 rounded-xl text-sm ring-1 ${
              requiresReview
                ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-emerald-50 text-emerald-800 ring-emerald-200"
            }`}
          >
            {requiresReview
              ? "Guardrail flagged this draft for human review. Check the Draft Review page."
              : "Draft generated. Clinician sign-off still required before final use."}
          </div>
        )}
      </section>

      <section className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Event log</h3>
          <span className="badge badge-soft">{events.length}</span>
        </div>
        <div className="h-[30rem] overflow-auto text-xs font-mono bg-slate-900 text-slate-200 rounded-xl p-3 space-y-1 shadow-inner">
          {events.length === 0 && (
            <div className="text-slate-500 italic">Waiting for stream…</div>
          )}
          {events.map((e, i) => (
            <div key={i} className="leading-relaxed animate-fade-in">
              <span className="text-slate-500">[{e.type}]</span>{" "}
              <span className="text-brand-300 font-semibold">{e.node}</span>{" "}
              <span className="text-slate-300">{e.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
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
    <div className="w-full overflow-x-auto">
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
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Edges */}
        {EDGES.map(([from, to]) => {
          const a = LAYOUT[from];
          const b = LAYOUT[to];
          // Start/end on the right/left edge of the node boxes
          const x1 = a.x + NODE_W / 2;
          const y1 = a.y;
          const x2 = b.x - NODE_W / 2;
          const y2 = b.y;
          // Cubic bezier with horizontal tangents for smooth S-curves
          const dx = Math.max(40, (x2 - x1) / 2);
          const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          const active = statuses[from] === "done" || statuses[from] === "running";
          return (
            <path
              key={`${from}-${to}`}
              d={d}
              fill="none"
              strokeWidth={active ? 2.5 : 1.5}
              stroke={active ? "url(#edge-active)" : isDark ? "rgba(148,163,184,0.55)" : "rgba(100,116,139,0.7)"}
              strokeDasharray={statuses[from] === "running" ? "6 6" : undefined}
              className={statuses[from] === "running" ? "animate-[dash_1.2s_linear_infinite]" : ""}
              style={
                statuses[from] === "running"
                  ? ({ strokeDashoffset: 0 } as React.CSSProperties)
                  : undefined
              }
              markerEnd="url(#arrow)"
              color={active ? "#a855f7" : isDark ? "rgb(148,163,184)" : "rgb(100,116,139)"}
            />
          );
        })}

        {/* Nodes */}
        {NODES.map((n) => {
          const { x, y } = LAYOUT[n];
          const st = statuses[n];
          const Icon = NODE_ICON[n];
          const fill = isDark
            ? st === "done"
              ? "rgba(6, 95, 70, 0.35)"
              : st === "running"
              ? "rgba(67, 56, 202, 0.35)"
              : st === "error"
              ? "rgba(159, 18, 57, 0.35)"
              : "rgba(15, 23, 42, 0.65)"
            : st === "done"
              ? "#ecfdf5"
              : st === "running"
              ? "#eef2ff"
              : st === "error"
              ? "#fff1f2"
              : "#f8fafc";
          const stroke =
            st === "done"
              ? "#10b981"
              : st === "running"
              ? "#6366f1"
              : st === "error"
              ? "#f43f5e"
              : isDark
              ? "rgba(71,85,105,0.9)"
              : "#cbd5e1";
          const labelColor = isDark
            ? st === "done"
              ? "#6ee7b7"
              : st === "running"
              ? "#c7d2fe"
              : st === "error"
              ? "#fda4af"
              : "#e2e8f0"
            : st === "done"
              ? "#065f46"
              : st === "running"
              ? "#312e81"
              : st === "error"
              ? "#9f1239"
              : "#1e293b";
          return (
            <g
              key={n}
              transform={`translate(${x - NODE_W / 2}, ${y - NODE_H / 2})`}
              className={st === "running" ? "animate-fade-in" : ""}
            >
              {/* Glow for running node */}
              {st === "running" && (
                <rect
                  x={-6}
                  y={-6}
                  width={NODE_W + 12}
                  height={NODE_H + 12}
                  rx={18}
                  fill="none"
                  stroke="#a5b4fc"
                  strokeWidth={3}
                  opacity="0.5"
                  className="animate-pulse"
                />
              )}
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={14}
                fill={fill}
                stroke={stroke}
                strokeWidth={2}
                className="drop-shadow-sm"
              />
              <foreignObject x="0" y="0" width={NODE_W} height={NODE_H}>
                <div
                  // @ts-ignore - xmlns needed for SVG foreignObject
                  xmlns="http://www.w3.org/1999/xhtml"
                  className="w-full h-full flex items-center gap-3 px-3"
                >
                  <div
                    className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${
                      st === "done"
                        ? "bg-emerald-500 text-white"
                        : st === "running"
                        ? "bg-brand-gradient text-white"
                        : st === "error"
                        ? "bg-rose-500 text-white"
                        : "bg-slate-200 text-slate-600 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                    }`}
                  >
                    {st === "done" ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : st === "running" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : st === "error" ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-xs font-semibold truncate"
                      style={{ color: labelColor }}
                    >
                      {NODE_SHORT[n]}
                    </div>
                    <div
                      className={`text-[10px] uppercase tracking-widest font-semibold ${
                        st === "done"
                          ? "text-emerald-600"
                          : st === "running"
                          ? "text-brand-600"
                          : st === "error"
                          ? "text-rose-600"
                          : "text-slate-500 dark:text-slate-400"
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

        <style>{`@keyframes dash { to { stroke-dashoffset: -24 } }`}</style>
      </svg>
    </div>
  );
}
