import { useEffect, useRef } from "react";

interface NetworkInformation {
  type?: string;
  effectiveType?: string;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

/**
 * Svag, alltid valfri signal till "Outdoor Confidence Index" (5% vikt):
 * `navigator.connection`-typ som en mycket grov wifi/inomhus-indikator —
 * många hem/kontor har wifi men mobilnät utomhus, men det är långt ifrån en
 * pålitlig regel (många hem saknar wifi, många utomhusplatser har det).
 * Degraderar alltid till neutralt (0.5) när Network Information API saknas
 * (t.ex. Safari) eller inte ger någon typinformation.
 */
export function useConnectionHint(): React.MutableRefObject<number> {
  const hintRef = useRef(0.5);

  useEffect(() => {
    const connection = (navigator as unknown as { connection?: NetworkInformation }).connection;
    if (!connection) return;

    function update() {
      if (!connection) return;
      const type = connection.type ?? connection.effectiveType;
      if (type === "wifi") {
        hintRef.current = 0.4;
      } else if (type === "cellular" || type === "4g" || type === "5g") {
        hintRef.current = 0.6;
      } else {
        hintRef.current = 0.5;
      }
    }

    update();
    connection.addEventListener?.("change", update);
    return () => connection.removeEventListener?.("change", update);
  }, []);

  return hintRef;
}
