import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  Upload,
  Play,
  FileText,
  Mic,
  FolderOpen,
  CheckCircle2,
  Sparkles,
  Activity,
  Stethoscope,
} from "lucide-react";

type Sample = {
  id: string;
  label: string;
  patient_ref: string;
  clinician_ref: string;
  transcript: string;
  structured_input: any;
};

type EncounterListItem = {
  id: string;
  patient_ref: string;
  clinician_ref: string;
  status: string;
  source_type: string;
  created_at: string;
  artifacts_signed?: number;
  artifacts_total?: number;
};

function isFullySigned(e: EncounterListItem): boolean {
  if (e.status === "signed") return true;
  const total = e.artifacts_total ?? 0;
  const signed = e.artifacts_signed ?? 0;
  return total > 0 && signed >= total;
}

function EncounterRow({ e }: { e: EncounterListItem }) {
  const isDemo = e.id.startsWith("demo-");
  const fullySigned = isFullySigned(e);
  const badgeClass = fullySigned
    ? "bg-emerald-100 text-emerald-800"
    : e.status === "draft"
    ? "bg-indigo-100 text-indigo-800"
    : e.status === "running"
    ? "bg-amber-100 text-amber-800"
    : "bg-slate-100 text-slate-700";
  const target = e.status === "created" || e.status === "running" ? `/run/${e.id}` : `/review/${e.id}`;
  return (
    <Link
      to={target}
      className="block border border-slate-200 dark:border-slate-700 rounded-lg p-3 hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-500/10 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate flex items-center gap-2">
            {(isDemo || fullySigned) && (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            {e.patient_ref}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {e.clinician_ref} · {e.source_type} · {new Date(e.created_at).toLocaleString()}
          </div>
          {typeof e.artifacts_total === "number" && e.artifacts_total > 0 && !fullySigned && (
            <div className="text-[11px] mt-1 text-slate-500">
              <span className={e.artifacts_signed ? "text-emerald-700 font-medium" : ""}>
                {e.artifacts_signed ?? 0}
              </span>
              <span> / {e.artifacts_total} artifacts signed</span>
            </div>
          )}
        </div>
        <span className={`badge ${badgeClass}`}>{fullySigned ? "signed off" : e.status}</span>
      </div>
    </Link>
  );
}

export default function EncounterIntake() {
  const nav = useNavigate();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [saved, setSaved] = useState<EncounterListItem[]>([]);
  const [transcript, setTranscript] = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [bp, setBp] = useState("");
  const [hr, setHr] = useState<string>("");
  const [spo2, setSpo2] = useState<string>("");
  const [followup, setFollowup] = useState("");
  const [dxRaw, setDxRaw] = useState("");
  const [medsRaw, setMedsRaw] = useState("");
  const [careRaw, setCareRaw] = useState("");
  const [referralsRaw, setReferralsRaw] = useState("");
  const [ordersRaw, setOrdersRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listSamples().then(setSamples).catch(() => {});
    api.listEncounters().then(setSaved).catch(() => {});
  }, []);

  async function runSample(s: Sample) {
    setBusy(true);
    setErr(null);
    try {
      const enc = await api.createFromSample(s.id);
      nav(`/run/${enc.id}`);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function runCustom() {
    setBusy(true);
    setErr(null);
    try {
      const structured_input = {
        chief_complaint: chiefComplaint || undefined,
        vitals: {
          bp: bp || undefined,
          hr: hr ? Number(hr) : undefined,
          spo2: spo2 ? Number(spo2) : undefined,
        },
        diagnoses: dxRaw
          .split(/\n|;/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => ({ description: s })),
        medications: medsRaw
          .split(/\n|;/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => ({ name: s })),
        care_plan_changes: careRaw.split(/\n|;/).map((s) => s.trim()).filter(Boolean),
        referrals: referralsRaw.split(/\n|;/).map((s) => s.trim()).filter(Boolean),
        orders: ordersRaw.split(/\n|;/).map((s) => s.trim()).filter(Boolean),
        followup: followup || undefined,
      };
      const enc = await api.createEncounter({
        patient_ref: "PT-CUSTOM-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
        clinician_ref: "DR-DEMO",
        source_type: "text",
        transcript,
        structured_input,
      });
      nav(`/run/${enc.id}`);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAudio(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setErr(null);
    try {
      const { text } = await api.transcribe(f);
      setTranscript((t) => (t ? t + "\n\n" + text : text));
    } catch (ex: any) {
      setErr("Transcription failed: " + (ex.message || ex));
    } finally {
      setUploading(false);
    }
  }

  const signedOff = saved.filter(isFullySigned);
  const drafts = saved.filter((e) => !isFullySigned(e));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="hero flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 p-5 sm:p-6">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-[11px] sm:text-xs uppercase tracking-[0.18em] text-white/80 mb-2">
            <Sparkles className="w-3.5 h-3.5" /> New encounter
          </div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight leading-tight">
            Turn a visit into a draft note, PCP handoff and coding in seconds.
          </h1>
          <p className="mt-2 text-white/85 text-sm md:text-base">
            Pick a seeded encounter to run the full agent graph, open a saved draft, or paste your own
            transcript. Every output ships with evidence citations and a mandatory clinician sign-off.
          </p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-2 sm:gap-3 text-center w-full lg:w-auto lg:min-w-[360px]">
          {[
            { label: "Agents", value: "7", to: "/about/agents" },
            { label: "Artifacts", value: "5", to: "/about/artifacts" },
            { label: "Guardrails", value: "on", to: "/about/guardrails" },
          ].map((m) => (
            <Link
              key={m.label}
              to={m.to}
              aria-label={`Learn about ${m.label}`}
              className="group rounded-xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20 px-2 sm:px-4 py-2.5 sm:py-3 hover:bg-white/20 hover:ring-white/40 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              <div className="text-xl sm:text-2xl font-bold">{m.value}</div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-white/80 group-hover:text-white">
                {m.label}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Samples */}
      <section className="card card-gradient p-6 lg:col-span-1">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="logo-mark w-8 h-8">
              <FileText className="w-4 h-4" />
            </span>
            Seeded encounters
          </h2>
          <span className="badge badge-soft">{samples.length}</span>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Fastest path to a demo — loads a realistic encounter and runs the full agent graph live.
        </p>
        <div className="space-y-3">
          {samples.map((s) => (
            <div
              key={s.id}
              className="group relative border border-slate-200/80 rounded-xl p-4 bg-white/70 transition hover:border-brand-300 hover:shadow-soft"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand-gradient-soft ring-1 ring-brand-200 flex items-center justify-center text-brand-700">
                  <Stethoscope className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">{s.label}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {s.patient_ref} · {s.clinician_ref}
                  </div>
                </div>
              </div>
              <button
                className="btn btn-primary mt-3 w-full"
                disabled={busy}
                onClick={() => runSample(s)}
              >
                <Play className="w-4 h-4" /> Run agents
              </button>
            </div>
          ))}
          {samples.length === 0 && <div className="text-sm text-slate-500">No samples available.</div>}
        </div>

        <div className="flex items-center justify-between mt-7 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="logo-mark w-8 h-8 bg-gradient-to-br from-accent-500 to-brand-500">
              <FolderOpen className="w-4 h-4" />
            </span>
            Drafts in review
          </h2>
          <span className="badge badge-soft">{drafts.length}</span>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Open an existing draft — demo encounters are pre-populated, no agent run required.
        </p>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {drafts.map((e) => (
            <EncounterRow key={e.id} e={e} />
          ))}
          {drafts.length === 0 && (
            <div className="text-sm text-slate-500">No drafts yet — run an encounter to start.</div>
          )}
        </div>

        <div className="flex items-center justify-between mt-7 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="logo-mark w-8 h-8 bg-gradient-to-br from-emerald-500 to-brand-500">
              <CheckCircle2 className="w-4 h-4" />
            </span>
            Signed off
          </h2>
          <span className="badge badge-soft">{signedOff.length}</span>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Clinician-reviewed summaries with every artifact signed.
        </p>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {signedOff.map((e) => (
            <EncounterRow key={e.id} e={e} />
          ))}
          {signedOff.length === 0 && (
            <div className="text-sm text-slate-500">No encounters signed off yet.</div>
          )}
        </div>
      </section>

      {/* Custom intake */}
      <section className="card p-6 lg:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <span className="logo-mark w-8 h-8">
              <Mic className="w-4 h-4" />
            </span>
            New encounter
          </h2>
          <span className="badge badge-brand">
            <Activity className="w-3 h-3" /> Live
          </span>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <label className="btn btn-outline cursor-pointer">
            <Upload className="w-4 h-4" />
            <span>{uploading ? "Transcribing…" : "Upload audio (auto-transcribe)"}</span>
            <input type="file" accept="audio/*" className="hidden" onChange={handleAudio} />
          </label>
          <span className="text-xs text-slate-500">or paste a transcript below</span>
        </div>

        <label className="label">Transcript</label>
        <textarea
          className="input mt-1 h-40 font-mono text-sm"
          placeholder="Paste encounter transcript here…"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="label">Chief complaint</label>
            <input className="input mt-1" value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} />
          </div>
          <div>
            <label className="label">Follow-up</label>
            <input className="input mt-1" value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="e.g., 6 weeks" />
          </div>
          <div className="grid grid-cols-3 gap-2 md:col-span-2">
            <div>
              <label className="label">BP</label>
              <input className="input mt-1" value={bp} onChange={(e) => setBp(e.target.value)} placeholder="128/78" />
            </div>
            <div>
              <label className="label">HR</label>
              <input className="input mt-1" value={hr} onChange={(e) => setHr(e.target.value)} />
            </div>
            <div>
              <label className="label">SpO2</label>
              <input className="input mt-1" value={spo2} onChange={(e) => setSpo2(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Diagnoses (one per line)</label>
            <textarea className="input mt-1 h-20 text-sm" value={dxRaw} onChange={(e) => setDxRaw(e.target.value)} />
          </div>
          <div>
            <label className="label">Medications (one per line)</label>
            <textarea className="input mt-1 h-20 text-sm" value={medsRaw} onChange={(e) => setMedsRaw(e.target.value)} />
          </div>
          <div>
            <label className="label">Care plan changes</label>
            <textarea className="input mt-1 h-20 text-sm" value={careRaw} onChange={(e) => setCareRaw(e.target.value)} />
          </div>
          <div>
            <label className="label">Referrals</label>
            <textarea className="input mt-1 h-20 text-sm" value={referralsRaw} onChange={(e) => setReferralsRaw(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Orders</label>
            <textarea className="input mt-1 h-20 text-sm" value={ordersRaw} onChange={(e) => setOrdersRaw(e.target.value)} />
          </div>
        </div>

        {err && <div className="mt-4 p-3 rounded bg-rose-50 text-rose-700 text-sm">{err}</div>}

        <div className="mt-5 flex justify-end">
          <button className="btn btn-primary" disabled={busy} onClick={runCustom}>
            <Play className="w-4 h-4" /> Run agents
          </button>
        </div>
      </section>
      </div>
    </div>
  );
}
