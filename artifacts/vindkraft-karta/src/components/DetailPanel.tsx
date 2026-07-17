import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, X } from "lucide-react";
import {
  useGetWindTurbine,
  useGetWindProjectArea,
  type WindTurbine,
  type WindProjectArea,
} from "@workspace/api-client-react";
import { statusColor, statusLabel } from "@/lib/statusMeta";
import type { MapSelection } from "@/components/MapCanvas";
import type { UseQueryOptions } from "@tanstack/react-query";
import { sourceLabel, sourceUrl } from "@/lib/sourceMeta";

const AR_HANDOFF_KEY = "vindkraft-ar-katrineholm:customPlacement";
const EDIT_HANDOFF_KEY = "vindkraft:editHandoff";

// På native Capacitor använder AR-appen hash-routing (/#/sida).
// På webb används vanlig path-routing (/sida). Detekteras via window.Capacitor.
function isCapacitorNative(): boolean {
  return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor?.isNativePlatform?.();
}

function openInAr(
  turbines: { id: string; lat: number; lon: number }[],
  projectMeta?: { projectId?: number; projectName?: string; projectMunicipality?: string },
) {
  if (turbines.length === 0) return;
  localStorage.setItem(
    AR_HANDOFF_KEY,
    JSON.stringify({
      turbines,
      savedAt: Date.now(),
      projectId: projectMeta?.projectId,
      projectName: projectMeta?.projectName,
      projectMunicipality: projectMeta?.projectMunicipality,
      source: "handoff",
    }),
  );
  // Native: hash-routing; webb: path-routing
  window.location.href = isCapacitorNative() ? "/#/" : "/";
}

function openInEditor(
  projectName: string,
  turbines: { id: string; lat: number; lon: number }[],
  centerLat?: number | null,
  centerLng?: number | null,
  projectId?: number | null,
) {
  localStorage.setItem(
    EDIT_HANDOFF_KEY,
    JSON.stringify({
      projectName,
      turbines,
      centerLat: centerLat ?? null,
      centerLng: centerLng ?? null,
      // projectId krävs av PlaceTurbines för att hämta verk via API
      // när exakta koordinater saknas i kartvy (nationell zoom)
      projectId: projectId != null ? String(projectId) : undefined,
      savedAt: Date.now(),
    }),
  );
  // Native: "/#/placera" (hash routing); webb: "/placera" (path routing)
  window.location.href = isCapacitorNative() ? "/#/placera" : "/placera";
}

interface DetailPanelProps {
  selection: MapSelection;
  onClose: () => void;
  focusPoint?: { lat: number; lng: number } | null;
  turbines?: WindTurbine[];
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between text-sm py-1 border-b border-border/60 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

export default function DetailPanel({ selection, onClose, focusPoint, turbines }: DetailPanelProps) {
  const pointParams = focusPoint ? { lat: focusPoint.lat, lng: focusPoint.lng } : undefined;
  const turbineQuery = useGetWindTurbine(selection.id, pointParams, {
    query: { enabled: selection.kind === "turbine" } as UseQueryOptions<WindTurbine>,
  });
  const projectAreaQuery = useGetWindProjectArea(selection.id, pointParams, {
    query: { enabled: selection.kind === "projectArea" } as UseQueryOptions<WindProjectArea>,
  });

  const isLoading =
    selection.kind === "turbine" ? turbineQuery.isLoading : projectAreaQuery.isLoading;

  return (
    <div
      className="absolute top-0 right-0 h-full w-full sm:w-96 bg-background border-l shadow-lg z-20 flex flex-col"
      data-testid="panel-detail"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-semibold text-base">
          {selection.kind === "turbine" ? "Vindkraftverk" : "Projekteringsområde"}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-detail">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="p-4">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {selection.kind === "turbine" && turbineQuery.data && (
            <div>
              <h3 className="text-lg font-semibold mb-1">{turbineQuery.data.name}</h3>
              <Badge
                style={{ backgroundColor: statusColor(turbineQuery.data.status), color: "white" }}
                className="mb-4"
              >
                {statusLabel(turbineQuery.data.status)}
              </Badge>
              <div className="space-y-0.5">
                <Field label="Kommun" value={turbineQuery.data.kommun} />
                <Field label="Län" value={turbineQuery.data.region} />
                <Field label="Total höjd" value={turbineQuery.data.totalHeightM ? `${turbineQuery.data.totalHeightM} m` : null} />
                <Field label="Navhöjd" value={turbineQuery.data.hubHeightM ? `${turbineQuery.data.hubHeightM} m` : null} />
                <Field label="Rotordiameter" value={turbineQuery.data.rotorDiameterM ? `${turbineQuery.data.rotorDiameterM} m` : null} />
                <Field label="Maxeffekt" value={turbineQuery.data.maxEffectMw ? `${turbineQuery.data.maxEffectMw} MW` : null} />
                <Field label="Tillverkare" value={turbineQuery.data.manufacturer} />
                <Field label="Modell" value={turbineQuery.data.model} />
                <Field label="Verksamhetsutövare" value={turbineQuery.data.organisationName} />
                <Field
                  label="Närmaste ort"
                  value={
                    turbineQuery.data.nearestLocalityName
                      ? `${turbineQuery.data.nearestLocalityName} (${turbineQuery.data.nearestLocalityDistanceKm?.toFixed(1)} km)`
                      : null
                  }
                />
                <Field
                  label="Avstånd från din plats"
                  value={
                    turbineQuery.data.distanceKm != null
                      ? `${turbineQuery.data.distanceKm.toFixed(1)} km`
                      : null
                  }
                />
                <Field label="Senast uppdaterad" value={turbineQuery.data.lastUpdated ? String(turbineQuery.data.lastUpdated).slice(0, 10) : null} />
              </div>
              {turbineQuery.data.lat != null && turbineQuery.data.lng != null && (
                <Button
                  className="w-full mt-4 bg-[#FF8B01] hover:bg-[#FFB347] text-[#090909] font-semibold"
                  onClick={() =>
                    openInAr([{
                      id: String(turbineQuery.data!.id),
                      lat: turbineQuery.data!.lat!,
                      lon: turbineQuery.data!.lng!,
                    }])
                  }
                >
                  📱 Visa i AR
                </Button>
              )}
              {sourceLabel(turbineQuery.data.source) && (
                <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                  Källa:{" "}
                  {sourceUrl(turbineQuery.data.source) ? (
                    <a
                      href={sourceUrl(turbineQuery.data.source) as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                      data-testid="link-source-turbine"
                    >
                      {sourceLabel(turbineQuery.data.source)}
                    </a>
                  ) : (
                    sourceLabel(turbineQuery.data.source)
                  )}
                </div>
              )}
            </div>
          )}

          {selection.kind === "projectArea" && projectAreaQuery.data && (
            <div>
              <h3 className="text-lg font-semibold mb-1">{projectAreaQuery.data.name}</h3>
              <div className="flex gap-2 mb-4">
                <Badge
                  style={{ backgroundColor: statusColor(projectAreaQuery.data.status), color: "white" }}
                >
                  {statusLabel(projectAreaQuery.data.status)}
                </Badge>
                <Badge variant="outline">
                  {projectAreaQuery.data.category === "offshore" ? "Havsbaserat" : "Landbaserat"}
                </Badge>
              </div>
              <div className="space-y-0.5">
                <Field label="Kommun" value={projectAreaQuery.data.kommun} />
                <Field label="Län" value={projectAreaQuery.data.region} />
                <Field
                  label="Antal planerade verk"
                  value={
                    projectAreaQuery.data.turbineCountPlannedMin ||
                    projectAreaQuery.data.turbineCountPlannedMax
                      ? `${projectAreaQuery.data.turbineCountPlannedMin ?? "?"}–${projectAreaQuery.data.turbineCountPlannedMax ?? "?"}`
                      : null
                  }
                />
                <Field label="Maxhöjd" value={projectAreaQuery.data.heightMaxM ? `${projectAreaQuery.data.heightMaxM} m` : null} />
                <Field label="Installerad effekt" value={projectAreaQuery.data.installedEffectMw ? `${projectAreaQuery.data.installedEffectMw} MW` : null} />
                <Field label="Årsproduktion" value={projectAreaQuery.data.annualProductionGwh ? `${projectAreaQuery.data.annualProductionGwh} GWh` : null} />
                <Field label="Planerad byggstart" value={projectAreaQuery.data.plannedConstructionStart} />
                <Field label="Planerat drifttagande" value={projectAreaQuery.data.plannedOperationDate} />
                <Field label="Verksamhetsutövare" value={projectAreaQuery.data.organisationName} />
                <Field
                  label="Närmaste ort"
                  value={
                    projectAreaQuery.data.nearestLocalityName
                      ? `${projectAreaQuery.data.nearestLocalityName} (${projectAreaQuery.data.nearestLocalityDistanceKm?.toFixed(1)} km)`
                      : null
                  }
                />
                <Field
                  label="Avstånd från din plats"
                  value={
                    projectAreaQuery.data.distanceKm != null
                      ? `${projectAreaQuery.data.distanceKm.toFixed(1)} km`
                      : null
                  }
                />
                <Field label="Senast uppdaterad" value={projectAreaQuery.data.lastUpdated ? String(projectAreaQuery.data.lastUpdated).slice(0, 10) : null} />
              </div>
              {(() => {
                const projectTurbines = (turbines ?? [])
                  .filter((t) => t.projectAreaId === selection.id && t.lat != null && t.lng != null)
                  .map((t) => ({ id: String(t.id), lat: t.lat!, lon: t.lng! }));
                const projectName = projectAreaQuery.data?.name ?? "Vindkraftsprojekt";
                const turbineCount = projectAreaQuery.data?.turbineCountPlannedMax ?? projectTurbines.length;
                return (
                  <div className="mt-4 space-y-2">
                    <Button
                      className="w-full font-semibold"
                      style={{ backgroundColor: '#fff7ed', color: '#1f2937', border: '2px solid #FF8B01' }}
                      onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#ffedd5')}
                      onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#fff7ed')}
                      onClick={() => openInEditor(
                        projectName,
                        projectTurbines,
                        projectAreaQuery.data?.centerLat,
                        projectAreaQuery.data?.centerLng,
                        projectAreaQuery.data?.id,
                      )}
                      data-testid="button-edit-project"
                    >
                      {projectTurbines.length > 0
                        ? `✏️ Redigera ${projectTurbines.length} verk`
                        : `✏️ Placera ${turbineCount ? `${turbineCount} ` : ""}verk`}
                    </Button>
                    {projectTurbines.length === 0 && (
                      <p className="text-xs text-muted-foreground/60 text-center -mt-1">
                        Exakta positioner saknas — du kan placera dem manuellt
                      </p>
                    )}
                    {projectTurbines.length > 0 && (
                      <Button
                        className="w-full bg-[#FF8B01] hover:bg-[#FFB347] text-[#090909] font-semibold"
                        onClick={() =>
                          openInAr(projectTurbines, {
                            projectId: projectAreaQuery.data?.id,
                            projectName: projectAreaQuery.data?.name,
                            projectMunicipality: projectAreaQuery.data?.kommun ?? undefined,
                          })
                        }
                        data-testid="button-ar-project"
                      >
                        📱 Visa {projectTurbines.length} verk i AR
                      </Button>
                    )}
                  </div>
                );
              })()}
              {sourceLabel(projectAreaQuery.data.source) && (
                <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                  Källa:{" "}
                  {sourceUrl(projectAreaQuery.data.source) ? (
                    <a
                      href={sourceUrl(projectAreaQuery.data.source) as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                      data-testid="link-source-project-area"
                    >
                      {sourceLabel(projectAreaQuery.data.source)}
                    </a>
                  ) : (
                    sourceLabel(projectAreaQuery.data.source)
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
