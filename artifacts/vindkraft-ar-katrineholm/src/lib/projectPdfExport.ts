import jsPDF from "jspdf";

/**
 * Genererar ett A4-PDF-dokument med turbinplaceringar.
 * Returnerar `jsPDF`-instansen — anroparen ansvarar för att öppna/spara den.
 *
 * iOS PWA-not: använd `doc.output("blob")` + `window.open(blobURL, "_blank")`
 * istället för `doc.save()` — `<a download>` no-opar tyst i Safari standalone-läge.
 */
export function generatePlacementPdf(
  name: string,
  turbines: Array<{ lat: number; lon: number }>,
  timestamp?: number,
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(name, margin, y);
  y += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Antal verk: ${turbines.length}`, margin, y);
  y += 6;
  if (timestamp) {
    doc.text(`Sparad: ${new Date(timestamp).toISOString().slice(0, 10)}`, margin, y);
    y += 6;
  }
  y += 4;

  // Bbox + kartskiss
  if (turbines.length > 0) {
    const lats = turbines.map((t) => t.lat);
    const lons = turbines.map((t) => t.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const latRange = maxLat - minLat || 0.01;
    const lonRange = maxLon - minLon || 0.01;

    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120);
    doc.text(
      `Bounding box: ${minLat.toFixed(4)}–${maxLat.toFixed(4)} N, ${minLon.toFixed(4)}–${maxLon.toFixed(4)} E`,
      margin,
      y,
    );
    y += 5;
    doc.setTextColor(0);

    const mapW = pageW - margin * 2;
    const mapH = 80;
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.rect(margin, y, mapW, mapH);
    doc.setFillColor(34, 139, 34);
    turbines.forEach((t) => {
      const x = margin + ((t.lon - minLon) / lonRange) * mapW;
      const z = y + mapH - ((t.lat - minLat) / latRange) * mapH;
      doc.circle(x, z, 0.8, "F");
    });
    y += mapH + 6;
  }

  // Turbin-lista
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text("Turbinpositioner:", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("#", margin, y);
  doc.text("Lat", margin + 10, y);
  doc.text("Lon", margin + 45, y);
  y += 5;

  const maxRows = Math.min(turbines.length, 35);
  for (let i = 0; i < maxRows; i++) {
    if (y > 272) {
      doc.addPage();
      y = margin;
    }
    doc.text(String(i + 1), margin, y);
    doc.text(turbines[i].lat.toFixed(5), margin + 10, y);
    doc.text(turbines[i].lon.toFixed(5), margin + 45, y);
    y += 4.5;
  }
  if (turbines.length > 35) {
    doc.setFont("helvetica", "italic");
    doc.text(`…och ${turbines.length - 35} till`, margin, y);
  }

  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(
    `Genererad ${new Date().toISOString().slice(0, 10)} från Vindkollen AR`,
    margin,
    290,
  );

  return doc;
}
