export default function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round((value ?? 0) * 100);
  const cls =
    value >= 0.85
      ? "bg-emerald-100 text-emerald-800"
      : value >= 0.7
      ? "bg-sky-100 text-sky-800"
      : value >= 0.5
      ? "bg-amber-100 text-amber-800"
      : "bg-rose-100 text-rose-800";
  return <span className={`badge ${cls}`}>confidence {pct}%</span>;
}
