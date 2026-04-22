import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";

export default function AuditTrail() {
  const { id } = useParams();
  const [events, setEvents] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.audit(id).then(setEvents).catch((e) => setErr(String(e.message || e)));
  }, [id]);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Audit trail</h2>
        <Link to={`/review/${id}`} className="btn btn-outline">
          Back to draft review
        </Link>
      </div>
      {err && <div className="p-3 rounded bg-rose-50 text-rose-700 text-sm">{err}</div>}
      <ol className="relative border-l border-slate-200 ml-3 space-y-3">
        {events.map((e) => (
          <li key={e.id} className="ml-4">
            <span className="absolute -left-2 w-3 h-3 rounded-full bg-brand-500 block mt-1.5" />
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{e.action}</span>
              <span className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString()}</span>
              <span className="badge bg-slate-100 text-slate-700">{e.actor}</span>
            </div>
            <pre className="text-xs bg-slate-50 rounded p-2 mt-1 overflow-x-auto">
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          </li>
        ))}
        {events.length === 0 && <li className="text-sm text-slate-500">No audit events yet.</li>}
      </ol>
    </div>
  );
}
