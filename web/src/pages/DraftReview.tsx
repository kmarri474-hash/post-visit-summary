import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../lib/api";
import type { ArtifactOut, EncounterDetail } from "../lib/types";
import ConfidenceBadge from "../components/ConfidenceBadge";
import EvidencePopover from "../components/EvidencePopover";
import { CheckCircle2, Save, AlertTriangle, ClipboardList, Stethoscope, UserRound, ScrollText } from "lucide-react";

const listAnim = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { type: "spring" as const, stiffness: 280, damping: 28 },
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
    <div>
      <div className="label">{label}</div>
      <textarea
        className="input mt-1 text-sm"
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
    <div>
      <div className="label">{label}</div>
      <input
        className="input mt-1"
        value={v}
        disabled={readOnly}
        onChange={(e) => setField(path, e.target.value)}
      />
    </div>
  );
}

const TABS: { key: ArtifactOut["kind"]; label: string; icon: any }[] = [
  { key: "note", label: "Clinical note (SOAP)", icon: ScrollText },
  { key: "pcp_summary", label: "PCP handoff", icon: UserRound },
  { key: "structured", label: "Problems & plan", icon: ClipboardList },
  { key: "coding", label: "Coding", icon: Stethoscope },
  { key: "gaps", label: "Gaps", icon: AlertTriangle },
];

export default function DraftReview() {
  const { id } = useParams();
  const [data, setData] = useState<EncounterDetail | null>(null);
  const [active, setActive] = useState<ArtifactOut["kind"]>("note");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  if (!data) return <div className="card p-6">Loading…</div>;

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

  async function doSignoff(override = false) {
    if (!current) return;
    const comment = prompt("Sign-off comment (optional):") || "";
    setBusy(true);
    setErr(null);
    try {
      const res: any = await api.signoffArtifact(current.id, comment, override);
      await load();
      setToast(
        res?.encounter_signed
          ? "Encounter fully signed off"
          : `${TABS.find((t) => t.key === active)?.label || "Artifact"} signed off`
      );
    } catch (e: any) {
      const msg = String(e.message || e);
      if (msg.includes("blocked") && !override) {
        if (confirm("Signoff blocked by open gaps. Override with comment?")) {
          await doSignoff(true);
        }
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
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 relative">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-20 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white shadow-pop ring-1 ring-emerald-500/50 animate-fade-in"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">{toast}</span>
        </div>
      )}
      <aside className="card p-4 lg:col-span-1">
        <div className="mb-3">
          <div className="label">Encounter</div>
          <div className="font-medium">{data.encounter.patient_ref}</div>
          <div className="text-xs text-slate-500">
            {data.encounter.clinician_ref} · {data.encounter.source_type}
          </div>
          <span
            className={`badge mt-2 ${
              data.encounter.status === "signed"
                ? "bg-emerald-100 text-emerald-800"
                : data.encounter.status === "draft"
                ? "bg-indigo-100 text-indigo-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            status: {data.encounter.status}
          </span>
          {current?.latest_version?.requires_human_review && (
            <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded p-2 text-amber-800">
              Guardrail flagged this draft for human review.
            </div>
          )}
        </div>
        <nav className="space-y-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const a = byKind[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setActive(t.key)}
                className={`tab ${active === t.key ? "tab-active" : ""}`}
              >
                <span className="flex items-center gap-2"><Icon className="w-4 h-4" /> {t.label}</span>
                {a?.signed && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              </button>
            );
          })}
        </nav>
        <Link to={`/audit/${id}`} className="btn btn-outline mt-4 w-full justify-center">
          View audit trail
        </Link>
      </aside>

      <section className="card p-5 lg:col-span-3">
        {err && <div className="mb-3 p-3 rounded bg-rose-50 text-rose-700 text-sm">{err}</div>}
        {!current && <div>No artifact of this kind yet.</div>}
        {current && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{TABS.find((t) => t.key === active)?.label}</h2>
                <ConfidenceBadge value={current.latest_version?.confidence || 0} />
                {current.signed && <span className="badge bg-emerald-100 text-emerald-800">signed</span>}
              </div>
              <div className="flex items-center gap-2">
                {!current.signed && (
                  <button className="btn btn-primary" disabled={busy} onClick={() => doSignoff(false)}>
                    <CheckCircle2 className="w-4 h-4" /> Sign off
                  </button>
                )}
              </div>
            </div>
            {active === "coding" && openBlockers > 0 && !current.signed && (
              <div className="mb-3 p-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                {openBlockers} high-severity gap(s) will block sign-off. Resolve them or override with a comment.
              </div>
            )}
            <ArtifactEditor
              kind={active}
              content={current.latest_version?.content}
              signed={current.signed}
              busy={busy}
              onSave={saveEdit}
            />
          </>
        )}
      </section>
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
    <div className="mt-4 flex justify-end">
      {!readOnly && (
        <button className="btn btn-outline" disabled={busy} onClick={() => onSave(draft, "manual edit")}>
          <Save className="w-4 h-4" /> Save edits
        </button>
      )}
    </div>
  );

  if (kind === "note") {
    return (
      <div className="space-y-3">
        <TextArea {...f} label="Subjective" path={["subjective"]} />
        <TextArea {...f} label="Objective" path={["objective"]} />
        <TextArea {...f} label="Assessment" path={["assessment"]} />
        <TextArea {...f} label="Plan" path={["plan"]} rows={6} />
        <div>
          <div className="label mb-1">Evidence</div>
          <EvidencePopover items={draft.evidence || []} />
        </div>
        {footer}
      </div>
    );
  }

  if (kind === "pcp_summary") {
    return (
      <div className="space-y-3">
        <TextInput {...f} label="Greeting" path={["greeting"]} />
        <TextArea {...f} label="Reason for visit" path={["reason_for_visit"]} />
        <TextArea {...f} label="Key findings" path={["key_findings"]} />
        <TextArea {...f} label="Changes made" path={["changes_made"]} />
        <div>
          <div className="label">Actions for PCP (one per line)</div>
          <textarea
            className="input mt-1 text-sm"
            style={{ minHeight: 100 }}
            value={(draft.actions_for_pcp || []).join("\n")}
            disabled={readOnly}
            onChange={(e) =>
              setField(["actions_for_pcp"], e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
            }
          />
        </div>
        <TextInput {...f} label="Follow-up" path={["followup"]} />
        <TextInput {...f} label="Closing" path={["closing"]} />
        {footer}
      </div>
    );
  }

  if (kind === "structured") {
    return (
      <div className="space-y-3">
        <TextInput {...f} label="Chief complaint" path={["chief_complaint"]} />
        <TextArea {...f} label="HPI" path={["hpi"]} />
        <div>
          <div className="label mb-1">Problems</div>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white/70 dark:bg-slate-900/40">
            {(draft.problems || []).map((p: any, i: number) => (
              <li key={i} className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-100">{p.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">status: {p.status}</div>
                </div>
                <EvidencePopover items={p.evidence || []} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="label mb-1">Care plan changes</div>
          <ul className="list-disc ml-5 text-sm">
            {(draft.care_plan_changes || []).map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="label mb-1">Orders</div>
          <ul className="list-disc ml-5 text-sm">
            {(draft.orders || []).map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
        <TextInput {...f} label="Follow-up" path={["followup"]} />
      </div>
    );
  }

  if (kind === "coding") {
    return (
      <div className="space-y-5">
        <CodeList title="ICD-10" items={draft.icd10 || []} path="icd10" setField={setField} readOnly={readOnly} />
        <CodeList title="CPT" items={draft.cpt || []} path="cpt" setField={setField} readOnly={readOnly} />
        {draft.em_level && (
          <div>
            <div className="label mb-1">E/M level</div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center justify-between bg-white/70 dark:bg-slate-900/40">
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-100">
                  {draft.em_level.code} — {draft.em_level.description}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-300">{draft.em_level.rationale}</div>
              </div>
              <div className="flex gap-2 items-center">
                <ConfidenceBadge value={draft.em_level.confidence || 0} />
                <EvidencePopover items={draft.em_level.evidence || []} />
              </div>
            </div>
          </div>
        )}
        <div>
          <div className="label mb-1">HCC (risk adjustment)</div>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <AnimatePresence initial={false}>
            {(draft.hcc || []).map((h: any, i: number) => (
              <motion.li
                key={`hcc-${h.icd10}-${i}`}
                layout
                {...listAnim}
                className="p-3 flex items-center justify-between bg-white/70 dark:bg-slate-900/40"
              >
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-100">
                    {h.icd10} → {h.hcc_category}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">{h.description}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{h.rationale}</div>
                </div>
                <div className="flex gap-2 items-center">
                  <ConfidenceBadge value={h.confidence || 0} />
                  <EvidencePopover items={h.evidence || []} />
                </div>
              </motion.li>
            ))}
            </AnimatePresence>
            {(draft.hcc || []).length === 0 && (
              <li className="p-3 text-sm text-slate-500">No HCC mappings suggested.</li>
            )}
          </ul>
        </div>
        {footer}
      </div>
    );
  }

  if (kind === "gaps") {
    return (
      <div>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <AnimatePresence initial={false}>
          {(draft.gaps || []).map((g: any, i: number) => (
            <motion.li
              key={`gap-${g.field}-${i}`}
              layout
              {...listAnim}
              className="p-3 flex items-center justify-between bg-white/70 dark:bg-slate-900/40 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition"
            >
              <div>
                <div className="font-medium">
                  {g.field}{" "}
                  <span
                    className={`badge ml-2 ${
                      g.severity === "high"
                        ? "bg-rose-100 text-rose-800"
                        : g.severity === "medium"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {g.severity}
                  </span>
                  {g.blocks_signoff && (
                    <span className="badge ml-2 bg-rose-100 text-rose-800">blocks signoff</span>
                  )}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-300">{g.why_it_matters}</div>
              </div>
            </motion.li>
          ))}
          </AnimatePresence>
          {(draft.gaps || []).length === 0 && (
            <li className="p-3 text-sm text-slate-500">No documentation gaps detected.</li>
          )}
        </ul>
      </div>
    );
  }

  return <pre className="text-xs">{JSON.stringify(draft, null, 2)}</pre>;
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
    <div>
      <div className="label mb-1">{title}</div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <AnimatePresence initial={false}>
        {items.map((c, i) => (
          <motion.li
            key={`${c.code}-${i}`}
            layout
            {...listAnim}
            whileHover={{ scale: 1.004 }}
            className="p-3 flex items-center justify-between bg-white/70 dark:bg-slate-900/40"
          >
            <div>
              <div className="font-medium text-slate-800 dark:text-slate-100">
                {c.code} — {c.description}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300">{c.rationale}</div>
            </div>
            <div className="flex gap-2 items-center">
              <ConfidenceBadge value={c.confidence || 0} />
              <EvidencePopover items={c.evidence || []} />
              {!readOnly && (
                <button className="btn btn-ghost text-xs text-rose-700" onClick={() => remove(i)}>
                  remove
                </button>
              )}
            </div>
          </motion.li>
        ))}
        </AnimatePresence>
        {items.length === 0 && <li className="p-3 text-sm text-slate-500">None suggested.</li>}
      </ul>
    </div>
  );
}
