#!/usr/bin/env bash
# Build a self-contained HTML preview of the Postgres state for a screenshot.
set -euo pipefail
DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:55432/pvs}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SCRIPT_DIR/db_preview.html}"

render() { psql "$DB" -X -P "format=html" -P "border=1" -P "tuples_only=off" -c "$1"; }

counts=$(render "select
  (select count(*) from encounters)        as encounters,
  (select count(*) from artifacts)         as artifacts,
  (select count(*) from artifact_versions) as versions,
  (select count(*) from signoffs)          as signoffs,
  (select count(*) from audit_log)         as audit_log;")

enc=$(render "select substring(id,1,8) as id, patient_ref, clinician_ref, status,
                     to_char(created_at,'YYYY-MM-DD HH24:MI') as created_at
              from encounters
              order by created_at desc
              limit 8;")

art=$(render "select e.patient_ref,
                     string_agg(a.kind || case when s.id is not null then ' ✓' else '' end, ', ' order by a.kind) as artifacts,
                     count(s.id) || '/' || count(a.id) as signed
              from encounters e
              join artifacts a on a.encounter_id = e.id
              left join signoffs s on s.artifact_id = a.id
              group by e.id, e.patient_ref, e.created_at
              order by e.created_at desc
              limit 6;")

cat > "$OUT" <<HTML
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Database — Post-Visit Summary</title>
<style>
 :root { color-scheme: light; }
 body { font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        background: #f8fafc; color: #0f172a; margin: 0; padding: 32px;
        background-image:
          radial-gradient(800px 400px at 0% -10%, rgba(99,102,241,.12), transparent 60%),
          radial-gradient(700px 400px at 100% 0%, rgba(168,85,247,.10), transparent 60%); }
 h1 { font-size: 22px; margin: 0 0 4px; letter-spacing:-.01em; }
 .sub { color: #475569; font-size: 13px; margin-bottom: 24px; }
 .card { background: white; border: 1px solid #e2e8f0; border-radius: 16px;
         padding: 18px 20px; margin-bottom: 18px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
 h2 { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #334155; text-transform: uppercase; letter-spacing: .1em; }
 table { border-collapse: collapse; width: 100%; font-size: 13px; }
 th { text-align: left; color: #64748b; font-weight: 600; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
 td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
 tr:last-child td { border-bottom: 0; }
 p.navfooter, p[align="center"] { display: none; }
 table[border] { border: 0 !important; }
 code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #1e293b; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; }
 .pills { display:flex; gap:12px; flex-wrap: wrap; }
 .pill { background: linear-gradient(135deg,#6366f1,#a855f7); color:white; padding: 10px 16px; border-radius: 14px;
         min-width: 90px; text-align: center; box-shadow: 0 4px 14px rgba(99,102,241,.25);}
 .pill b { display:block; font-size:22px; }
 .pill span { font-size:11px; opacity:.9; letter-spacing:.1em; text-transform: uppercase;}
 .footer { color:#94a3b8; font-size: 11px; margin-top: 12px; }
</style>
</head>
<body>
<h1>Postgres — <code>pvs</code></h1>
<div class="sub">host <code>127.0.0.1:55432</code> · live snapshot rendered from <code>psql</code></div>

<div class="card">
  <h2>Row counts</h2>
  ${counts}
</div>

<div class="card">
  <h2>Recent encounters</h2>
  ${enc}
</div>

<div class="card">
  <h2>Artifacts per encounter (✓ = signed)</h2>
  ${art}
</div>

<div class="footer">Generated at $(date '+%Y-%m-%d %H:%M:%S %Z') from live Postgres.</div>
</body>
</html>
HTML

echo "wrote $OUT"
