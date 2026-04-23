import { useState } from "react";
import { Info } from "lucide-react";
import type { EvidenceSpan } from "../lib/types";

export default function EvidencePopover({ items }: { items: EvidenceSpan[] }) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0)
    return <span className="badge bg-rose-100 text-rose-700">no evidence</span>;
  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="badge bg-slate-100 text-slate-700 hover:bg-slate-200"
        onClick={() => setOpen((v) => !v)}
      >
        <Info className="w-3 h-3 mr-1" /> {items.length} evidence
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] card p-3 text-sm shadow-pop">
          <div className="font-semibold mb-2 text-slate-700">Supporting evidence</div>
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {items.map((e, i) => (
              <li key={i} className="border-l-2 border-brand-500 pl-2">
                <div className="text-xs uppercase text-slate-500">{e.source}</div>
                <div className="italic">"{e.quote}"</div>
              </li>
            ))}
          </ul>
          <button className="btn btn-ghost text-xs mt-2" onClick={() => setOpen(false)}>
            close
          </button>
        </div>
      )}
    </div>
  );
}
