import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../lib/api";
import type { ArtifactOut, EncounterDetail } from "../lib/types";
import ConfidenceBadge from "../components/ConfidenceBadge";
import EvidencePopover from "../components/EvidencePopover";
import SignoffModal from "../components/SignoffModal";
import {
  CheckCircle2,
  Save,
  AlertTriangle,
  ClipboardList,
  Stethoscope,
  UserRound,
  ScrollText,
  ChevronLeft,
  History
} from "lucide-react";

const listAnim = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { type: "spring" as const, stiffness: 280, damping: 28 },
};

const tabContentAnim = {
  initial: { opacity: 0, x: 10 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
  transition: { duration: 0.2 }
};

type FieldProps = {
  label: string;
  path: string[];
  rows?: number;
  draft: any;
  readOnly: boolean;
  setField: (path: string[], value: any) => void;
};

function TextArea({ label, path, rows = 4, draft, readOnly, setField }: FieldProps) {
  const v = path.reduce((o: any, k) => (o ? o[k] : ""), draft) || "";
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">{label}</div>
      <textarea
        className="input w-full min-h-[100px] text-sm bg-white/50 dark:bg-slate-950/30 focus:ring-brand-500/20 transition-all leading-relaxed"
        style={{ minHeight: rows * 24 }}
        value={v}
        disabled={readOnly}
        onChange={(e) => setField(path, e.target.value)}
      />
    </div>
  );
}

function TextInput({ label, path, draft, readOnly, setField }: Omit<FieldProps, "rows">) {
  const v = path.reduce((o: any, k) => (o ? o[k] : ""), draft) || "";
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">{label}</div>
      <input
        className="input w-full bg-white/50 dark:bg-slate-950/30 focus:ring-brand-500/20 transition-all"
        value={v}
        disabled={readOnly}
        onChange={(e) => setField(path, e.target.value)}
      />
    </div>
  );
}

const TABS: { key: ArtifactOut["kind"]; label: string; icon: any }[] = [
  { key: "note", label: "Clinical note", icon: ScrollText },
  { key: "pcp_summary", label: "PCP handoff", icon: UserRound },
  { key: "structured", label: "Problems & plan", icon: ClipboardList },
  { key: "coding", label: "Coding", icon: Stethoscope },
  { key: "gaps", label: "Gaps", icon: AlertTriangle },
];

export default function DraftReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<EncounterDetail | null>(null);
  const [active, setActive] = useState<ArtifactOut["kind"]>("note");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [signoffModal, setSignoffModal] = useState<{ open: boolean; mode: "comment" | "blocked" }>({ open: false, mode: "comment" });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    if (!id) return;
    const d = await api.getEncounter(id);
    setData(d);
  }

  useEffect(() => {
    load().catch((e) => setErr(String(e.message || e)));
  }, [id]);

  if (!data) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-slate-500 font-medium">Loading encounter details...</p>
      </div>
    </div>
  );

  const byKind: Record<string, ArtifactOut | undefined> = Object.fromEntries(
    data.artifacts.map((a) => [a.kind, a])
  );
  const current = byKind[active];

  async function saveEdit(content: any, reason?: string) {
    if (!current) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patchArtifact(current.id, content, reason);
      await load();
      setToast("Edits saved");
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  function requestSignoff() {
    setSignoffModal({ open: true, mode: "comment" });
  }

  async function executeSignoff(comment: string, override: boolean) {
    if (!current) return;
    setSignoffModal({ open: false, mode: "comment" });
    setBusy(true);
    setErr(null);
    try {
      const res: any = await api.signoffArtifact(current.id, comment, override);
      await load();
      if (res?.encounter_signed) {
        setToast("Encounter fully signed! Redirecting…");
        setTimeout(() => navigate("/intake"), 1800);
      } else {
        setToast(`${TABS.find((t) => t.key === active)?.label || "Artifact"} signed`);
      }
    } catch (e: any) {
      const msg = String(e.message || e);
      if (msg.includes("blocked") && !override) {
        setSignoffModal({ open: true, mode: "blocked" });
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const gapsArt = byKind["gaps"];
  const openBlockers =
    (gapsArt?.latest_version?.content?.gaps || []).filter((g: any) => g.blocks_signoff).length;

  return (
    <div className="space-y-6">
      {/* Header / Breadcrumbs */}
      <div className="flex items-center justify-between">
        <Link to="/intake" className="group flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-brand-600 transition-colors">
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to encounters
        </Link>
        <div className="flex items-center gap-3">
          <Link to={`/audit/${id}`} className="btn btn-outline btn-sm gap-2">
            <History className="w-4 h-4" /> Audit trail
          </Link>
        </div>
      </div>

      {data.encounter.status === "signed" && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-300 shadow-sm"
        >
          <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />
          <div>
            <div className="font-bold">Encounter complete</div>
            <div className="text-xs opacity-80">All artifacts have been reviewed and signed by a clinician.</div>
          </div>
        </motion.div>
      )}

      {toast && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          className="fixed top-24 right-8 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-slate-900 dark:bg-brand-600 text-white shadow-2xl ring-1 ring-white/10"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span className="text-sm font-bold">{toast}</span>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar */}
        <aside className="lg:col-span-1 space-y-6">
          <section className="card-glass p-6">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3">Encounter info</div>
            <div className="space-y-4">
              <div>
                <div className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
                  {data.encounter.patient_ref}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                  {data.encounter.clinician_ref} · {data.encounter.source_type}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`badge px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${data.encounter.status === "signed"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : data.encounter.status === "draft"
                      ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                    }`}
                >
                  {data.encounter.status}
                </span>
              </div>

              {current?.latest_version?.requires_human_review && !current?.signed && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 text-amber-800 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="text-[11px] font-medium leading-relaxed">
                    Guardrail flagged this draft for human review.
                  </div>
                </div>
              )}
            </div>
          </section>

          <nav className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold mb-3 ml-2">Artifacts</div>
            {TABS.map((t) => {
              const Icon = t.icon;
              const a = byKind[t.key];
              const isActive = active === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActive(t.key)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all duration-300 group ${isActive
                    ? "bg-brand-gradient text-white shadow-brand"
                    : "bg-white/40 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                    }`}
                >
                  <span className="flex items-center gap-3 font-bold text-sm">
                    <Icon className={`w-4 h-4 ${isActive ? "text-white" : "text-slate-400 group-hover:text-brand-500"}`} />
                    {t.label}
                  </span>
                  {a?.signed && <CheckCircle2 className={`w-4 h-4 ${isActive ? "text-white/80" : "text-emerald-500"}`} />}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <section className="lg:col-span-3 space-y-6">
          <div className="card-glass p-8 min-h-[600px]">
            {err && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 text-sm border border-rose-100 dark:border-rose-900/30 flex items-center gap-3"
              >
                <AlertTriangle className="w-5 h-5" />
                {err}
              </motion.div>
            )}

            {!current && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <ScrollText className="w-12 h-12 mb-4 opacity-20" />
                <p className="font-medium">No artifact of this kind yet.</p>
              </div>
            )}

            {current && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  variants={tabContentAnim}
                  className="space-y-8"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                          {TABS.find((t) => t.key === active)?.label}
                        </h2>
                        {current.signed && (
                          <span className="badge bg-emerald-500 text-white border-none px-3 py-1">signed</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Confidence</span>
                          <ConfidenceBadge value={current.latest_version?.confidence || 0} />
                        </div>
                        {current.latest_version?.content?.evidence?.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Evidence</span>
                            <EvidencePopover items={current.latest_version?.content?.evidence || []} />
                          </div>
                        )}
                      </div>
                    </div>

                    {!current.signed && (
                      <button
                        className="btn btn-primary btn-lg px-8 shadow-brand group"
                        disabled={busy}
                        onClick={requestSignoff}
                      >
                        <CheckCircle2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        <span>Sign off</span>
                      </button>
                    )}
                  </div>

                  {active === "coding" && openBlockers > 0 && !current.signed && (
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 text-amber-800 dark:text-amber-400 text-sm flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <p className="font-medium">
                        {openBlockers} high-severity gap(s) will block sign-off. Resolve them or override with a comment.
                      </p>
                    </div>
                  )}

                  <div className="relative">
                    <ArtifactEditor
                      kind={active}
                      content={current.latest_version?.content}
                      signed={current.signed}
                      busy={busy}
                      onSave={saveEdit}
                    />
                  </div>
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </section>
      </div>

      <SignoffModal
        open={signoffModal.open}
        mode={signoffModal.mode}
        blockerCount={openBlockers}
        onConfirm={(comment) => executeSignoff(comment, signoffModal.mode === "blocked")}
        onCancel={() => setSignoffModal({ open: false, mode: "comment" })}
      />
    </div>
  );
}

function ArtifactEditor({
  kind,
  content,
  signed,
  busy,
  onSave,
}: {
  kind: ArtifactOut["kind"];
  content: any;
  signed: boolean;
  busy: boolean;
  onSave: (content: any, reason?: string) => void;
}) {
  const [draft, setDraft] = useState<any>(content);
  useEffect(() => setDraft(content), [content]);

  if (!draft) return null;

  const readOnly = signed;

  function setField(path: string[], value: any) {
    setDraft((d: any) => {
      const copy = structuredClone(d);
      let cur = copy;
      for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
      cur[path[path.length - 1]] = value;
      return copy;
    });
  }

  const f = { draft, readOnly, setField };

  const footer = (
    <div className="mt-8 flex justify-end">
      {!readOnly && (
        <button
          className="btn btn-outline btn-lg px-8 border-slate-200 dark:border-slate-700 hover:border-brand-500 hover:text-brand-600 transition-all group"
          disabled={busy}
          onClick={() => onSave(draft, "manual edit")}
        >
          <Save className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <span>Save edits</span>
        </button>
      )}
    </div>
  );

  if (kind === "note") {
    return (
      <div className="space-y-6">
        <TextArea {...f} label="Subjective" path={["subjective"]} rows={6} />
        <TextArea {...f} label="Objective" path={["objective"]} rows={6} />
        <TextArea {...f} label="Assessment" path={["assessment"]} rows={6} />
        <TextArea {...f} label="Plan" path={["plan"]} rows={8} />
        {footer}
      </div>
    );
  }

  if (kind === "pcp_summary") {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <TextInput {...f} label="Greeting" path={["greeting"]} />
          <TextInput {...f} label="Follow-up" path={["followup"]} />
        </div>
        <TextArea {...f} label="Reason for visit" path={["reason_for_visit"]} />
        <TextArea {...f} label="Key findings" path={["key_findings"]} />
        <TextArea {...f} label="Changes made" path={["changes_made"]} />
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">Actions for PCP (one per line)</div>
          <textarea
            className="input w-full min-h-[120px] text-sm bg-white/50 dark:bg-slate-950/30 focus:ring-brand-500/20 transition-all leading-relaxed"
            value={(draft.actions_for_pcp || []).join("\n")}
            disabled={readOnly}
            onChange={(e) =>
              setField(["actions_for_pcp"], e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
            }
          />
        </div>
        <TextInput {...f} label="Closing" path={["closing"]} />
        {footer}
      </div>
    );
  }

  if (kind === "structured") {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <TextInput {...f} label="Chief complaint" path={["chief_complaint"]} />
          <TextInput {...f} label="Follow-up" path={["followup"]} />
        </div>
        <TextArea {...f} label="HPI" path={["hpi"]} />

        <div className="space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">Problem List</div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white/30 dark:bg-slate-950/20">
            {(draft.problems || []).map((p: any, i: number) => (
              <div key={i} className="p-4 flex items-center justify-between hover:bg-white/50 dark:hover:bg-slate-900/30 transition-colors">
                <div>
                  <div className="font-bold text-slate-900 dark:text-slate-100">{p.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-0.5">Status: {p.status}</div>
                </div>
                <EvidencePopover items={p.evidence || []} />
              </div>
            ))}
            {(draft.problems || []).length === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm italic">No problems identified.</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">Care plan changes</div>
            <ul className="space-y-2">
              {(draft.care_plan_changes || []).map((c: string, i: number) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">Orders</div>
            <ul className="space-y-2">
              {(draft.orders || []).map((c: string, i: number) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-1.5 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "coding") {
    return (
      <div className="space-y-8">
        <CodeList title="ICD-10 Diagnoses" items={draft.icd10 || []} path="icd10" setField={setField} readOnly={readOnly} />
        <CodeList title="CPT Procedures" items={draft.cpt || []} path="cpt" setField={setField} readOnly={readOnly} />

        {draft.em_level && (
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">E/M level</div>
            <div className="border border-slate-100 dark:border-slate-800 rounded-2xl p-5 bg-brand-50/30 dark:bg-brand-900/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="font-bold text-lg text-slate-900 dark:text-slate-100">
                  {draft.em_level.code} <span className="text-slate-400 font-normal mx-2">·</span> {draft.em_level.description}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{draft.em_level.rationale}</div>
              </div>
              <div className="flex gap-3 items-center shrink-0">
                <ConfidenceBadge value={draft.em_level.confidence || 0} />
                <EvidencePopover items={draft.em_level.evidence || []} />
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">HCC (risk adjustment)</div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white/30 dark:bg-slate-950/20">
            <AnimatePresence initial={false}>
              {(draft.hcc || []).map((h: any, i: number) => (
                <motion.div
                  key={`hcc-${h.icd10}-${i}`}
                  layout
                  {...listAnim}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/50 dark:hover:bg-slate-900/30 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {h.icd10} <span className="text-brand-500 mx-1">→</span> {h.hcc_category}
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-300 font-medium">{h.description}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-1 leading-relaxed">{h.rationale}</div>
                  </div>
                  <div className="flex gap-3 items-center shrink-0">
                    <ConfidenceBadge value={h.confidence || 0} />
                    <EvidencePopover items={h.evidence || []} />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {(draft.hcc || []).length === 0 && (
              <div className="p-8 text-center text-slate-400 text-sm italic">No HCC mappings suggested.</div>
            )}
          </div>
        </div>
        {footer}
      </div>
    );
  }

  if (kind === "gaps") {
    return (
      <div className="space-y-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">Documentation gaps</div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white/30 dark:bg-slate-950/20">
          <AnimatePresence initial={false}>
            {(draft.gaps || []).map((g: any, i: number) => (
              <motion.div
                key={`gap-${g.field}-${i}`}
                layout
                {...listAnim}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/50 dark:hover:bg-slate-900/30 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <div className="font-bold text-slate-900 dark:text-slate-100">{g.field}</div>
                    <span
                      className={`badge px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${g.severity === "high"
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400"
                        : g.severity === "medium"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                    >
                      {g.severity}
                    </span>
                    {g.blocks_signoff && (
                      <span className="badge bg-rose-500 text-white border-none px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                        blocks signoff
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{g.why_it_matters}</div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {(draft.gaps || []).length === 0 && (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3 opacity-20" />
              <p className="text-slate-400 text-sm font-medium">No documentation gaps detected.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <pre className="text-xs p-4 bg-slate-950 text-slate-300 rounded-xl overflow-auto">{JSON.stringify(draft, null, 2)}</pre>;
}

function CodeList({
  title,
  items,
  path,
  setField,
  readOnly,
}: {
  title: string;
  items: any[];
  path: string;
  setField: (p: string[], v: any) => void;
  readOnly: boolean;
}) {
  function remove(i: number) {
    setField([path], items.filter((_, j) => j !== i));
  }
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">{title}</div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white/30 dark:bg-slate-950/20">
        <AnimatePresence initial={false}>
          {items.map((c, i) => (
            <motion.div
              key={`${c.code}-${i}`}
              layout
              {...listAnim}
              whileHover={{ x: 4 }}
              className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/50 dark:hover:bg-slate-900/30 transition-all"
            >
              <div className="space-y-1">
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  <span className="text-brand-600 dark:text-brand-400">{c.code}</span>
                  <span className="text-slate-300 mx-2">·</span>
                  {c.description}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">{c.rationale}</div>
              </div>
              <div className="flex gap-3 items-center shrink-0">
                <ConfidenceBadge value={c.confidence || 0} />
                <EvidencePopover items={c.evidence || []} />
                {!readOnly && (
                  <button
                    className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
                    onClick={() => remove(i)}
                    title="Remove code"
                  >
                    <AlertTriangle className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {items.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm italic">None suggested.</div>
        )}
      </div>
    </div>
  );
}

