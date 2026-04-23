import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api, API_BASE } from "../lib/api";
import {
  Upload,
  Play,
  FileText,
  Mic,
  MicOff,
  FolderOpen,
  CheckCircle2,
  Sparkles,
  Activity,
  Stethoscope,
  Radio,
  ChevronDown,
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

const containerAnim = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemAnim = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

function EncounterRow({ e }: { e: EncounterListItem }) {
  const isDemo = e.id.startsWith("demo-");
  const fullySigned = isFullySigned(e);
  const badgeClass = fullySigned
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
    : e.status === "draft"
      ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400"
      : e.status === "running"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400";
  const target = e.status === "created" || e.status === "running" ? `/run/${e.id}` : `/review/${e.id}`;

  return (
    <motion.div variants={itemAnim}>
      <Link
        to={target}
        className="group block border border-slate-200 dark:border-slate-700/50 rounded-xl p-3.5 hover:border-brand-400/50 hover:bg-brand-50/40 dark:hover:bg-brand-500/5 transition-all duration-300 hover:shadow-soft"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold truncate flex items-center gap-2 text-slate-900 dark:text-slate-100">
              {(isDemo || fullySigned) && (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              )}
              {e.patient_ref}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {e.clinician_ref} · {e.source_type} · {new Date(e.created_at).toLocaleDateString()}
            </div>
            {typeof e.artifacts_total === "number" && e.artifacts_total > 0 && !fullySigned && (
              <div className="text-[10px] mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full"
                    style={{ width: `${((e.artifacts_signed ?? 0) / e.artifacts_total) * 100}%` }}
                  />
                </div>
                <span className="text-slate-500 shrink-0">
                  {e.artifacts_signed ?? 0}/{e.artifacts_total} signed
                </span>
              </div>
            )}
          </div>
          <span className={`badge text-[10px] px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
            {fullySigned ? "signed" : e.status}
          </span>
        </div>
      </Link>
    </motion.div>
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
  const [expandedSample, setExpandedSample] = useState<string | null>(null);

  // ── Ambient live listening (WebSocket proxy through backend) ──────────────
  const [listening, setListening] = useState(false);
  const [listenErr, setListenErr] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");
  const recognizerRef = useRef<{ ws: WebSocket; stream: MediaStream; ctx: AudioContext; src: MediaStreamAudioSourceNode; proc: ScriptProcessorNode } | null>(null);

  async function startListening() {
    setListenErr(null);
    setInterimText("");
    try {
      if (!navigator.mediaDevices) {
        throw new Error(
          "Microphone access requires HTTPS. Live transcription is not available over plain HTTP."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      let wsBase = "";
      if (API_BASE && API_BASE.startsWith("http")) {
        wsBase = API_BASE.replace(/^https?:/, wsProtocol).replace("localhost", "127.0.0.1");
      } else {
        wsBase = `${wsProtocol}//${window.location.host}${API_BASE || ""}`;
      }
      const wsUrl = `${wsBase}/api/speech/stream`.replace(/([^:]\/)\/+/g, "$1");
      console.log("[EncounterIntake] Connecting to WebSocket:", wsUrl);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      const ctx = new AudioContext({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);

      proc.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        ws.send(int16.buffer);
      };

      src.connect(proc);
      proc.connect(ctx.destination);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "recognizing") {
            setInterimText(msg.text);
          } else if (msg.type === "recognized") {
            const text = msg.text?.trim();
            if (text) {
              setTranscript((prev) => (prev ? prev + " " + text : text));
            }
            setInterimText("");
          } else if (msg.type === "error") {
            setListenErr(`Listening error: ${msg.message}`);
            stopListening();
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onopen = () => setListening(true);
      ws.onerror = () => {
        setListenErr("WebSocket connection failed. If you are on a VPN, it may be blocking WebSockets.");
        stopListening();
      };
      ws.onclose = () => {
        setListening(false);
        setInterimText("");
      };

      recognizerRef.current = { ws, stream, ctx, src, proc };
    } catch (e: any) {
      let msg = e.message || String(e);
      if (msg.includes("503") || msg.includes("not configured")) {
        msg = "Azure Speech is not configured on the server. Add AZURE_SPEECH_* vars to your .env.";
      } else if (msg.includes("Permission denied") || msg.includes("NotAllowedError")) {
        msg = "Microphone access denied. Please check your browser permissions.";
      } else if (msg.includes("WebSocket") || msg.includes("connection")) {
        msg = "Connection failed. If you are on a VPN, it may be blocking WebSockets.";
      } else {
        msg = `Live transcription unavailable: ${msg}`;
      }
      setListenErr(msg);
    }
  }

  function stopListening() {
    const r = recognizerRef.current;
    if (r) {
      try { r.proc.disconnect(); } catch { /* ok */ }
      try { r.src.disconnect(); } catch { /* ok */ }
      try { r.ctx.close(); } catch { /* ok */ }
      r.stream.getTracks().forEach((t) => t.stop());
      if (r.ws.readyState === WebSocket.OPEN || r.ws.readyState === WebSocket.CONNECTING) {
        r.ws.close();
      }
      recognizerRef.current = null;
    }
    setListening(false);
    setInterimText("");
  }

  useEffect(() => {
    return () => { stopListening(); };
  }, []);

  useEffect(() => {
    api.listSamples().then(setSamples).catch(() => { });
    api.listEncounters().then(setSaved).catch(() => { });
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
    <motion.div
      initial="hidden"
      animate="show"
      variants={containerAnim}
      className="space-y-8 pb-12"
    >
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 p-8 sm:p-10 shadow-2xl ring-1 ring-white/10">
        <div className="absolute inset-0 bg-brand-gradient opacity-10 blur-3xl animate-pulse" />
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-accent-500/20 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
          <div className="max-w-2xl">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-[10px] sm:text-xs uppercase tracking-[0.2em] text-brand-300 mb-4"
            >
              <Sparkles className="w-3.5 h-3.5" /> New encounter
            </motion.div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.1] text-white">
              Turn a visit into a <span className="text-transparent bg-clip-text bg-brand-gradient">draft note</span>, PCP handoff and coding in seconds.
            </h1>
            <p className="mt-4 text-slate-400 text-base md:text-lg max-w-xl leading-relaxed">
              Pick a seeded encounter to run the full agent graph, open a saved draft, or paste your own
              transcript. Every output ships with evidence citations and a mandatory clinician sign-off.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:gap-4 w-full lg:w-auto lg:min-w-[400px]">
            {[
              { label: "Agents", value: "7", to: "/about/agents", icon: Activity },
              { label: "Artifacts", value: "5", to: "/about/artifacts", icon: FileText },
              { label: "Guardrails", value: "on", to: "/about/guardrails", icon: CheckCircle2 },
            ].map((m) => (
              <Link
                key={m.label}
                to={m.to}
                className="group relative flex flex-col items-center justify-center rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 p-4 hover:bg-white/10 hover:border-white/20 transition-all duration-300"
              >
                <m.icon className="w-5 h-5 text-brand-400 mb-2 group-hover:scale-110 transition-transform" />
                <div className="text-2xl font-bold text-white">{m.value}</div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500 group-hover:text-slate-300">
                  {m.label}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Lists */}
        <div className="lg:col-span-1 space-y-8">
          {/* Samples */}
          <section className="card-glass p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-lg flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <div className="w-8 h-8 rounded-lg bg-brand-500/10 flex items-center justify-center text-brand-600">
                  <FileText className="w-4 h-4" />
                </div>
                Seeded encounters
              </h2>
              <span className="badge badge-soft">{samples.length}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
              Fastest path to a demo — loads a realistic encounter and runs the full agent graph live.
            </p>

            <div className="space-y-4">
              {samples.map((s) => {
                const isExpanded = expandedSample === s.id;
                const si = s.structured_input ?? {};
                return (
                  <motion.div
                    key={s.id}
                    variants={itemAnim}
                    layout
                    className="group relative border border-slate-200 dark:border-slate-700/50 rounded-2xl p-4 bg-white/40 dark:bg-slate-900/40 hover:border-brand-400/50 transition-all duration-300 hover:shadow-soft"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-brand-gradient-soft ring-1 ring-brand-200/50 dark:ring-brand-500/20 flex items-center justify-center text-brand-700 dark:text-brand-400">
                        <Stethoscope className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900 dark:text-slate-100 leading-tight">{s.label}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          {s.patient_ref} · {s.clinician_ref}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 transition-colors"
                      onClick={() => setExpandedSample(isExpanded ? null : s.id)}
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                      />
                      {isExpanded ? "Hide input" : "Preview input"}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3 text-[11px] text-slate-600 dark:text-slate-400">
                            {si.chief_complaint && (
                              <div>
                                <span className="font-bold text-slate-900 dark:text-slate-200">Chief complaint: </span>
                                {si.chief_complaint}
                              </div>
                            )}
                            {si.vitals && Object.values(si.vitals).some(Boolean) && (
                              <div>
                                <span className="font-bold text-slate-900 dark:text-slate-200">Vitals: </span>
                                {[
                                  si.vitals.bp && `BP ${si.vitals.bp}`,
                                  si.vitals.hr && `HR ${si.vitals.hr}`,
                                  si.vitals.spo2 && `SpO₂ ${si.vitals.spo2}%`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            )}
                            {s.transcript && (
                              <div>
                                <div className="font-bold text-slate-900 dark:text-slate-200 mb-1">Transcript</div>
                                <p className="whitespace-pre-wrap font-mono text-[10px] bg-slate-50 dark:bg-slate-950/50 rounded-lg p-2.5 text-slate-500 dark:text-slate-400 max-h-40 overflow-y-auto border border-slate-100 dark:border-slate-800">
                                  {s.transcript}
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <button
                      className="btn btn-primary mt-4 w-full shadow-brand"
                      disabled={busy}
                      onClick={() => runSample(s)}
                    >
                      <Play className="w-4 h-4" /> Run agents
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* Drafts */}
          <section className="card-glass p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-lg flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <div className="w-8 h-8 rounded-lg bg-accent-500/10 flex items-center justify-center text-accent-600">
                  <FolderOpen className="w-4 h-4" />
                </div>
                Drafts in review
              </h2>
              <span className="badge badge-soft">{drafts.length}</span>
            </div>
            <div className="space-y-3 mt-5 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
              {drafts.map((e) => (
                <EncounterRow key={e.id} e={e} />
              ))}
              {drafts.length === 0 && (
                <div className="text-center py-8 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-2xl">
                  <p className="text-xs text-slate-500">No drafts yet — run an encounter to start.</p>
                </div>
              )}
            </div>
          </section>

          {/* Signed */}
          <section className="card-glass p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-lg flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                Signed off
              </h2>
              <span className="badge badge-soft">{signedOff.length}</span>
            </div>
            <div className="space-y-3 mt-5 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
              {signedOff.map((e) => (
                <EncounterRow key={e.id} e={e} />
              ))}
              {signedOff.length === 0 && (
                <div className="text-center py-8 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-2xl">
                  <p className="text-xs text-slate-500">No encounters signed yet.</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Custom Intake */}
        <div className="lg:col-span-2">
          <section className="card-glass p-8 sticky top-24">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-xl flex items-center gap-3 text-slate-900 dark:text-slate-100">
                <div className="w-10 h-10 rounded-xl bg-brand-gradient flex items-center justify-center text-white shadow-brand">
                  <Mic className="w-5 h-5" />
                </div>
                New encounter
              </h2>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-[10px] font-bold uppercase tracking-widest">
                <Activity className="w-3 h-3 animate-pulse" /> Live
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 mb-6">
              <label className="btn btn-outline cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <Upload className="w-4 h-4" />
                <span className="font-semibold">{uploading ? "Transcribing…" : "Upload audio"}</span>
                <input type="file" accept="audio/*" className="hidden" onChange={handleAudio} disabled={uploading || listening} />
              </label>

              {!listening ? (
                <button
                  type="button"
                  className="btn btn-outline flex items-center gap-2 border-slate-200 dark:border-slate-700 hover:border-rose-400 hover:text-rose-600 transition-all"
                  onClick={startListening}
                  disabled={uploading || busy}
                >
                  <Radio className="w-4 h-4 text-rose-500" />
                  <span className="font-semibold">Start live transcript</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary bg-rose-500 border-rose-500 hover:bg-rose-600 hover:border-rose-600 animate-pulse"
                  onClick={stopListening}
                >
                  <MicOff className="w-4 h-4" />
                  <span className="font-semibold">Stop listening</span>
                </button>
              )}

              <span className="text-xs text-slate-400 font-medium">or paste a transcript below</span>
            </div>

            <AnimatePresence>
              {(listening || interimText) && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mb-4 flex items-center gap-3 rounded-2xl border border-rose-100 dark:border-rose-900/30 bg-rose-50/50 dark:bg-rose-900/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-400 backdrop-blur-sm"
                >
                  <div className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span className="italic font-medium">{interimText || "Listening for speech…"}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {listenErr && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30"
              >
                {listenErr}
              </motion.div>
            )}

            <div className="space-y-6">
              <div>
                <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1">Transcript</label>
                <textarea
                  className="input mt-1 h-48 font-mono text-sm bg-white/50 dark:bg-slate-950/30 focus:ring-brand-500/20 transition-all"
                  placeholder="Paste encounter transcript here…"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1">Chief complaint</label>
                    <input className="input" value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} placeholder="e.g., Lower back pain" />
                  </div>
                  <div>
                    <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1">Follow-up</label>
                    <input className="input" value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="e.g., 6 weeks" />
                  </div>
                  <div>
                    <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1">Vitals</label>
                    <div className="grid grid-cols-3 gap-2">
                      <input className="input text-center" value={bp} onChange={(e) => setBp(e.target.value)} placeholder="BP" />
                      <input className="input text-center" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="HR" />
                      <input className="input text-center" value={spo2} onChange={(e) => setSpo2(e.target.value)} placeholder="SpO2" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1">Diagnoses</label>
                    <textarea className="input h-20 text-sm" value={dxRaw} onChange={(e) => setDxRaw(e.target.value)} placeholder="One per line..." />
                  </div>
                  <div>
                    <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1">Medications</label>
                    <textarea className="input h-20 text-sm" value={medsRaw} onChange={(e) => setMedsRaw(e.target.value)} placeholder="One per line..." />
                  </div>
                </div>

                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1 text-xs">Care plan changes</label>
                    <textarea className="input h-20 text-sm" value={careRaw} onChange={(e) => setCareRaw(e.target.value)} />
                  </div>
                  <div>
                    <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1 text-xs">Referrals</label>
                    <textarea className="input h-20 text-sm" value={referralsRaw} onChange={(e) => setReferralsRaw(e.target.value)} />
                  </div>
                  <div>
                    <label className="label text-slate-900 dark:text-slate-200 font-bold mb-1.5 ml-1 text-xs">Orders</label>
                    <textarea className="input h-20 text-sm" value={ordersRaw} onChange={(e) => setOrdersRaw(e.target.value)} />
                  </div>
                </div>
              </div>

              {err && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 text-sm border border-rose-100 dark:border-rose-900/30"
                >
                  {err}
                </motion.div>
              )}

              <div className="pt-4 flex justify-end">
                <button
                  className="btn btn-primary btn-lg px-8 shadow-brand group"
                  disabled={busy || !transcript.trim()}
                  onClick={runCustom}
                >
                  <Play className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  <span>Run agents</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  );
}

