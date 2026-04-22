import { Link, useParams, Navigate } from "react-router-dom";
import {
  ArrowLeft,
  Workflow,
  FileStack,
  ShieldCheck,
  Stethoscope,
  FileText,
  Send,
  Hash,
  AlertTriangle,
  Sparkles,
  Layers,
  CheckCircle2,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type Item = {
  title: string;
  subtitle?: string;
  body: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

type Topic = {
  slug: string;
  eyebrow: string;
  title: string;
  intro: string;
  HeroIcon: ComponentType<SVGProps<SVGSVGElement>>;
  items: Item[];
  footnote?: string;
};

const TOPICS: Record<string, Topic> = {
  agents: {
    slug: "agents",
    eyebrow: "7 Agents",
    title: "The agent graph that drafts your visit",
    intro:
      "Each encounter flows through a LangGraph pipeline of seven specialized agents. They fan out after structuring and converge at the guardrail for a single, reviewable draft.",
    HeroIcon: Workflow,
    items: [
      {
        title: "Intake",
        subtitle: "Normalizes inputs",
        body: "Validates the encounter payload, transcript, vitals, and any structured fields before the rest of the graph runs.",
        icon: Stethoscope,
      },
      {
        title: "Structurer",
        subtitle: "Extracts a structured encounter",
        body: "Turns free-text transcript and partial structured input into problems, medications, vitals, assessments, care-plan changes, referrals, orders, and follow-up with evidence spans.",
        icon: Layers,
      },
      {
        title: "Note drafter",
        subtitle: "SOAP clinical note",
        body: "Drafts the Subjective / Objective / Assessment / Plan note grounded in the structured encounter and transcript, with per-claim evidence.",
        icon: FileText,
      },
      {
        title: "PCP summary",
        subtitle: "Primary-care handoff",
        body: "Writes a concise letter to the PCP: reason for visit, key findings, changes made, actions for PCP, and follow-up.",
        icon: Send,
      },
      {
        title: "Coding",
        subtitle: "ICD-10 / CPT / E/M / HCC",
        body: "Suggests diagnosis and procedure codes, an E/M level, and HCC opportunities, each with a rationale and evidence.",
        icon: Hash,
      },
      {
        title: "Gap detector",
        subtitle: "Documentation gaps",
        body: "Flags missing elements (for example vitals, follow-up interval) that weaken coding or block sign-off, with severity.",
        icon: AlertTriangle,
      },
      {
        title: "Guardrail",
        subtitle: "Final safety net",
        body: "Joins every branch, drops claims without evidence, and routes the draft to human review when confidence is low or gaps block sign-off.",
        icon: ShieldCheck,
      },
    ],
  },
  artifacts: {
    slug: "artifacts",
    eyebrow: "5 Artifacts",
    title: "What every run produces",
    intro:
      "A run is not a single blob of text. It produces five typed artifacts that the clinician can review, edit, and sign off independently.",
    HeroIcon: FileStack,
    items: [
      {
        title: "Structured encounter",
        body: "The canonical structured view of the visit: chief complaint, HPI, problems with status, medications, vitals, assessments, care-plan changes, referrals, orders, and follow-up.",
        icon: Layers,
      },
      {
        title: "Clinical note (SOAP)",
        body: "A drafted Subjective / Objective / Assessment / Plan note, ready for clinician edits, with evidence spans backing each section.",
        icon: FileText,
      },
      {
        title: "PCP summary",
        body: "A short handoff letter for the primary care provider covering reason for visit, key findings, changes made, PCP actions, and follow-up.",
        icon: Send,
      },
      {
        title: "Coding bundle",
        body: "ICD-10 and CPT suggestions, a proposed E/M level, and HCC candidates — each with rationale, confidence, and evidence.",
        icon: Hash,
      },
      {
        title: "Guardrail report",
        body: "A transparent record of which items were dropped, which thresholds were tripped, and whether human review is required before sign-off.",
        icon: ShieldCheck,
      },
    ],
  },
  guardrails: {
    slug: "guardrails",
    eyebrow: "Guardrails · on",
    title: "Safety rails on every draft",
    intro:
      "Nothing leaves the system without evidence, a confidence check, and a clinician sign-off. Guardrails run on every encounter, every time.",
    HeroIcon: ShieldCheck,
    items: [
      {
        title: "Evidence required",
        body: "Any code, assessment, or claim without a linked evidence span from the transcript or structured input is dropped before the draft reaches review.",
        icon: CheckCircle2,
      },
      {
        title: "Confidence floor",
        body: "Coding, note, and PCP summary confidences are compared against a configured floor. Anything below flips the draft into human-review mode.",
        icon: Sparkles,
      },
      {
        title: "Blocking gaps",
        body: "High-severity documentation gaps (for example missing vitals for an E/M level) block sign-off until they are resolved.",
        icon: AlertTriangle,
      },
      {
        title: "Mandatory clinician sign-off",
        body: "All outputs are drafts. A clinician must review and sign off before anything is considered final, and every decision is auditable.",
        icon: ShieldCheck,
      },
      {
        title: "Full audit trail",
        body: "Every agent event, model response, dropped item, and human action is preserved so runs can be replayed and explained end-to-end.",
        icon: FileStack,
      },
    ],
    footnote:
      "Guardrail thresholds (for example the confidence floor) are configured server-side and surfaced in the guardrail report for each run.",
  },
};

export default function AboutTopic() {
  const { topic } = useParams<{ topic: string }>();
  const data = topic ? TOPICS[topic] : undefined;
  if (!data) return <Navigate to="/intake" replace />;
  const { HeroIcon } = data;

  return (
    <div className="space-y-6">
      <section className="hero flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 p-5 sm:p-6">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-[11px] sm:text-xs uppercase tracking-[0.18em] text-white/80 mb-2">
            <Sparkles className="w-3.5 h-3.5" /> {data.eyebrow}
          </div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight leading-tight">
            {data.title}
          </h1>
          <p className="mt-2 text-white/85 text-sm md:text-base">{data.intro}</p>
          <div className="mt-4">
            <Link to="/intake" className="btn btn-ghost !text-white !bg-white/10 hover:!bg-white/20">
              <ArrowLeft className="w-4 h-4" /> Back to intake
            </Link>
          </div>
        </div>
        <div className="relative z-10 hidden lg:flex items-center justify-center w-40 h-40 rounded-2xl bg-white/10 ring-1 ring-white/20">
          <HeroIcon className="w-20 h-20 text-white/90" />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.items.map((it, idx) => {
          const Icon = it.icon;
          return (
            <div key={it.title} className="card card-gradient p-5">
              <div className="flex items-start gap-3">
                <span className="logo-mark w-10 h-10 shrink-0">
                  <Icon className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-50">
                      {it.title}
                    </h3>
                  </div>
                  {it.subtitle && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {it.subtitle}
                    </div>
                  )}
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {it.body}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {data.footnote && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{data.footnote}</p>
      )}
    </div>
  );
}
