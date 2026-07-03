export interface StatusMeta {
  label: string;
  color: string;
}

export const STATUS_META: Record<string, StatusMeta> = {
  uppfort: { label: "Uppfört", color: "#16a34a" },
  beviljat: { label: "Beviljat", color: "#2563eb" },
  aktuellt: { label: "Aktuellt", color: "#2563eb" },
  handlaggs: { label: "Under handläggning", color: "#d97706" },
  samrad: { label: "Samråd pågår", color: "#d97706" },
  ansokan_inlamnad: { label: "Ansökan inlämnad", color: "#d97706" },
  inledande_undersokning: { label: "Inledande undersökning", color: "#a16207" },
  andringsansokan: { label: "Ändringsansökan", color: "#7c3aed" },
  avslaget: { label: "Avslaget", color: "#dc2626" },
  overklagat: { label: "Överklagat", color: "#ea580c" },
  nedmonterat: { label: "Nedmonterat", color: "#6b7280" },
  inte_aktuellt: { label: "Inte aktuellt / återkallat", color: "#9ca3af" },
  uppgift_saknas: { label: "Uppgift saknas", color: "#9ca3af" },
};

export function statusLabel(status: string): string {
  return STATUS_META[status]?.label ?? status;
}

export function statusColor(status: string): string {
  return STATUS_META[status]?.color ?? "#6b7280";
}

export const ALL_STATUSES = Object.keys(STATUS_META);

export const ACTIVE_STATUSES = [
  "uppfort",
  "beviljat",
  "aktuellt",
  "handlaggs",
  "samrad",
  "ansokan_inlamnad",
  "inledande_undersokning",
  "andringsansokan",
];
