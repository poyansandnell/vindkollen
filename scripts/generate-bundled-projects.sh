#!/usr/bin/env bash
# Regenererar bundledProjects.ts från live-databasen.
# Kör efter wind-sync för att hålla offline-fallbacken uppdaterad.
# Användning: bash scripts/generate-bundled-projects.sh

set -euo pipefail

echo "[generate-bundled-projects] Hämtar projektdata från databasen…"

psql "${DATABASE_URL}" -t -A -c "
SELECT json_agg(json_build_object(
  'id', id, 'name', name, 'status', status,
  'kommun', kommun, 'region', region,
  'tmin', turbine_count_planned_min,
  'tmax', turbine_count_planned_max,
  'lat', center_lat, 'lng', center_lng
))
FROM wind_project_areas
WHERE center_lat IS NOT NULL AND center_lng IS NOT NULL
" > /tmp/bp_projects.json

python3 - << 'PYEOF'
import json, datetime

STATUS_MAP = {
  'aktuellt':'planned','inledande_undersokning':'proposed',
  'samrad':'consultation','ansokan_inlamnad':'consultation',
  'andringsansokan':'permitted','beviljat':'permitted',
  'uppfort':'operational','inte_aktuellt':'cancelled',
  'avslaget':'cancelled','handlaggs':'planned',
  'overklagat':'planned','nedmonterat':'cancelled','uppgift_saknas':'proposed',
}
def ns(s): return STATUS_MAP.get(s or '', 'planned')
def esc(s):
    if not s: return 'null'
    return '"' + str(s).replace('\\','\\\\').replace('"','\\"') + '"'

with open('/tmp/bp_projects.json') as f:
    rows = json.load(f)

today = datetime.date.today().isoformat()
lines = []
for r in rows:
    tmin = r['tmin'] if r['tmin'] is not None else 'null'
    tmax = r['tmax'] if r['tmax'] is not None else 'null'
    lines.append(
        f'  {{ id: {r["id"]}, name: {esc(r["name"])}, status: "{ns(r["status"])}", '
        f'kommun: {esc(r["kommun"])}, region: {esc(r["region"])}, '
        f'turbineCountPlannedMin: {tmin}, turbineCountPlannedMax: {tmax}, '
        f'centerLat: {float(r["lat"]):.6f}, centerLng: {float(r["lng"]):.6f} }},'
    )

out = f'''/**
 * Statisk projektregistret för Vindkollen.
 *
 * Primär datakälla på native (Capacitor/iOS/Android) där relativa API-URL:er
 * ej fungerar (capacitor://localhost/api/... → DOMException). Används även som
 * omedelbar fallback på webben medan ett API-anrop pågår i bakgrunden.
 *
 * GENERERAT AUTOMATISKT — kör scripts/generate-bundled-projects.sh för att uppdatera.
 * Senast genererat: {today}
 * Källa: Vindbrukskollen via API-serverns databas ({len(lines)} projekt).
 */

export interface ApiProjectArea {{
  id: number;
  name: string;
  status: string;
  kommun?: string | null;
  region?: string | null;
  turbineCountPlannedMin?: number | null;
  turbineCountPlannedMax?: number | null;
  centerLat?: number;
  centerLng?: number;
  polygon?: {{ type: string; coordinates: unknown }} | null;
  campaign?: {{
    enabled: boolean;
    type: "referendum-interest";
    title: string;
    description: string;
    municipality: string;
  }} | null;
}}

export const BUNDLED_PROJECTS: ApiProjectArea[] = [
  // ── Ericsberg (special — campaign config) ──────────────────────────────
  {{
    id: 10001,
    name: "Ericsbergs planer",
    status: "consultation",
    kommun: "Katrineholm",
    region: "Södermanland",
    turbineCountPlannedMin: 29,
    turbineCountPlannedMax: 29,
    centerLat: 58.97,
    centerLng: 16.27,
    polygon: null,
    campaign: {{
      enabled: true,
      type: "referendum-interest" as const,
      title: "Folkomröstning om vindkraft 2026",
      description: "Skriv under för att kräva en kommunal folkomröstning om vindkraftsetableringen norr om Katrineholm.",
      municipality: "Katrineholm",
    }},
  }},
  // ── Live-data från Vindbrukskollen ({len(lines)} projekt, {today}) ───────────────
{chr(10).join(lines)}
];
'''

dest = 'artifacts/vindkraft-ar-katrineholm/src/lib/bundledProjects.ts'
with open(dest, 'w') as f:
    f.write(out)
print(f'[generate-bundled-projects] {len(lines)} projekt → {dest} ({len(out)//1024} KB)')
PYEOF

echo "[generate-bundled-projects] Klar."
