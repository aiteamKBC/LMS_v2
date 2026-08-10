import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type JournalActivity = {
  month_unit: string;
  source_course: string | null;
  activity_unit: string;
  section_title?: string | null;
  activity_description: string | null;
  learner_activity_date: string | null;
  plan_id: string;
  delivery_method: string;
  activity_category: string;
  time_from_to: string | null;
  time_from: string | null;
  time_to: string | null;
  actual_lms_hours: number | null;
  not_accepted?: boolean; // progress-review row → "Accepted: No"
};

type JournalSummary = {
  name: string;
  planned_hours: number;
  actual_hours: number;
  gap_hours: number;
  not_accepted_hours?: number;
};

type JournalProfile = {
  programme?: string | null;
  coach?: { name?: string | null; email?: string | null } | null;
  planned_hours?: number | null;
  learning_delivery?: {
    learner_reference?: string;
    planned_hours?: number;
    start_date?: string;
    first_evidence_date?: string | null;
    planned_end_date?: string;
  } | null;
};

type JournalSignatures = {
  learner?: string;
  coach?: string;
};

const navy: [number, number, number] = [24, 45, 72];
const purple: [number, number, number] = [103, 58, 183];
const green: [number, number, number] = [22, 120, 83];
const red: [number, number, number] = [185, 55, 55];
const border: [number, number, number] = [222, 226, 232];
const soft: [number, number, number] = [246, 248, 251];
const muted: [number, number, number] = [99, 110, 124];

function loadPdfLogo() {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = "/assets/kbc-logo.png";
  });
}

function hours(value: number | null | undefined) {
  return value == null ? "-" : `${value.toFixed(2)} h`;
}

function compactId(value: string) {
  return value.length > 18 ? `${value.slice(0, 15)}...` : value;
}

function displayDate(value: string | null) {
  if (!value) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function activityDetails(row: JournalActivity) {
  const description = row.activity_description || row.activity_unit || "-";
  const topic = row.activity_unit?.trim();
  return topic && topic !== description ? `${description}\n${topic}` : description;
}

function drawProfileColumn(
  doc: jsPDF,
  x: number,
  topLabel: string,
  topValue: string,
  bottomLabel: string,
  bottomValue: string,
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...muted);
  doc.text(topLabel.toUpperCase(), x, 41);
  doc.setFontSize(8.5);
  doc.setTextColor(...navy);
  doc.text(topValue || "-", x, 47, { maxWidth: 78 });
  doc.setFontSize(6.5);
  doc.setTextColor(...muted);
  doc.text(bottomLabel.toUpperCase(), x, 54);
  doc.setFontSize(8.5);
  doc.setTextColor(...navy);
  doc.text(bottomValue || "-", x, 60, { maxWidth: 78 });
}

function drawMetric(doc: jsPDF, x: number, label: string, value: string, accent: [number, number, number]) {
  doc.setFillColor(...soft);
  doc.roundedRect(x, 69, 64.5, 18, 2, 2, "F");
  doc.setFillColor(...accent);
  doc.roundedRect(x, 69, 2.2, 18, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...muted);
  doc.text(label.toUpperCase(), x + 6, 75);
  doc.setFontSize(12);
  doc.setTextColor(...navy);
  doc.text(value, x + 6, 83);
}

function drawSignatureCard(doc: jsPDF, x: number, y: number, title: string, name: string, signature?: string) {
  doc.setFillColor(...soft);
  doc.roundedRect(x, y, 132, 22, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...muted);
  doc.text(title.toUpperCase(), x + 6, y + 5.5);
  doc.setDrawColor(168, 176, 187);
  doc.setLineWidth(0.25);
  doc.line(x + 6, y + 16, x + 126, y + 16);
  if (signature) doc.addImage(signature, "PNG", x + 7, y + 7, 42, 8.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.setTextColor(...muted);
  doc.text(signature ? name : "Signature", x + 6, y + 20, { maxWidth: 120 });
}

export async function downloadLearnerJournalPdf(
  learner: JournalSummary,
  monthLabel: string,
  rows: JournalActivity[],
  _cumulative?: JournalSummary,
  profile?: JournalProfile,
  signatures?: JournalSignatures,
) {
  const logo = await loadPdfLogo();
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const totalPagesToken = "{total_pages_count_string}";
  const moduleName = rows[0]?.month_unit ?? "-";
  const topic = moduleName.replace(/^Month\s+\d+\s*:\s*/i, "") || rows[0]?.activity_unit || "-";
  const programme = profile?.programme?.trim()
    || rows.find((row) => row.source_course && !/^https?:\/\//i.test(row.source_course))?.source_course
    || "-";
  const coach = profile?.coach?.name?.trim() || "-";
  const startDate = profile?.learning_delivery?.start_date || "-";
  const firstEvidenceDate = profile?.learning_delivery?.first_evidence_date || "-";
  const plannedEndDate = profile?.learning_delivery?.planned_end_date || "-";

  doc.setFillColor(...navy);
  doc.rect(0, 0, pageWidth, 3.5, "F");
  if (logo) doc.addImage(logo, "PNG", 12, 8, 38, 17.5);
  doc.setDrawColor(...border);
  doc.setLineWidth(0.3);
  doc.line(56, 8, 56, 26);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...navy);
  doc.text("Learner Journal", 63, 13.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...muted);
  doc.text("Monthly off-the-job learning record", 63, 20);
  doc.setFontSize(7.5);
  doc.text(`Learning topic: ${topic}`, 63, 25.5);
  doc.setFillColor(...soft);
  doc.roundedRect(pageWidth - 55, 9, 43, 15, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...muted);
  doc.text("REPORTING MONTH", pageWidth - 33.5, 14, { align: "center" });
  doc.setFontSize(9.5);
  doc.setTextColor(...navy);
  doc.text(monthLabel, pageWidth - 33.5, 20.5, { align: "center" });
  doc.setDrawColor(...border);
  doc.line(12, 31, pageWidth - 12, 31);

  doc.setFillColor(...soft);
  doc.roundedRect(12, 35, 273, 29, 2.5, 2.5, "F");
  doc.setDrawColor(...border);
  doc.setLineWidth(0.25);
  doc.line(102, 39, 102, 60);
  doc.line(195, 39, 195, 60);
  drawProfileColumn(doc, 18, "Learner", learner.name, "Start date", startDate);
  drawProfileColumn(doc, 108, "Programme", programme, "First evidence", firstEvidenceDate);
  drawProfileColumn(doc, 201, "Coach", coach, "Planned end", plannedEndDate);

  drawMetric(doc, 12, "Monthly plan", hours(learner.planned_hours), navy);
  drawMetric(doc, 81.5, "Claimed", hours(learner.actual_hours), purple);
  // Progress-review hours kept out of the accepted total, shown separately.
  drawMetric(doc, 151, "Not accepted", hours(learner.not_accepted_hours ?? 0), red);
  drawMetric(doc, 220.5, "Variance", hours(learner.gap_hours), (learner.gap_hours ?? 0) < 0 ? red : green);

  doc.setFontSize(11.5);
  doc.setTextColor(...navy);
  doc.text("Activity log", 12, 97);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  doc.text("Claimed off-the-job learning time and whether it is accepted", 12, 102);

  autoTable(doc, {
    startY: 106,
    margin: { left: 12, right: 12, top: 27, bottom: 16 },
    theme: "plain",
    showHead: "everyPage",
    showFoot: "lastPage",
    rowPageBreak: "avoid",
    // A single "Time" column carrying the combined from–to value
    // (it'll later hold other kinds of value too).
    head: [[
      "Date",
      "Activity ID",
      "Activity details",
      "Type",
      { content: "Time", styles: { halign: "center" as const } },
      { content: "Claimed", styles: { halign: "right" as const } },
      { content: "Accepted", styles: { halign: "center" as const } },
    ]],
    body: rows.map((row) => [
      displayDate(row.learner_activity_date),
      compactId(row.plan_id || "-"),
      activityDetails(row),
      row.delivery_method || row.activity_category || "-",
      row.time_from_to ?? "-",
      hours(row.actual_lms_hours),
      row.not_accepted ? "No" : "Yes",
    ]),
    foot: [
      // Accepted total = the claimed hours that count; progress reviews are
      // listed as "Accepted: No" and summarised on their own line below.
      [
        { content: "Accepted total", colSpan: 5, styles: { halign: "right" as const } },
        hours(learner.actual_hours),
        "",
      ],
      ...(((learner.not_accepted_hours ?? 0) > 0)
        ? [[
            { content: "Not accepted total", colSpan: 5, styles: { halign: "right" as const } },
            hours(learner.not_accepted_hours ?? 0),
            "",
          ]]
        : []),
    ],
    styles: {
      font: "helvetica", fontSize: 7.3, minCellHeight: 8,
      cellPadding: { top: 2.5, right: 2.4, bottom: 2.5, left: 2.4 },
      lineWidth: 0, overflow: "linebreak", valign: "middle", textColor: [35, 47, 62],
    },
    headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, minCellHeight: 10 },
    footStyles: { fillColor: [238, 241, 246], textColor: navy, fontStyle: "bold", fontSize: 7.2 },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: {
      0: { cellWidth: 24 }, 1: { cellWidth: 28 }, 2: { cellWidth: 125 }, 3: { cellWidth: 34 },
      // The combined from–to time, in one 26mm column.
      4: { cellWidth: 26, halign: "center" },
      5: { cellWidth: 20, halign: "right", fontStyle: "bold" },
      6: { cellWidth: 16, halign: "center" },
    },
    didParseCell: (data) => {
      // Colour the Accepted column: green "Yes", red "No" (progress reviews).
      if (data.section === "body" && data.column.index === 6) {
        data.cell.styles.textColor = data.cell.raw === "No" ? red : green;
        data.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFillColor(...navy);
        doc.rect(0, 0, pageWidth, 3, "F");
        if (logo) doc.addImage(logo, "PNG", 12, 7, 25, 11.5);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...navy);
        doc.text(`${learner.name}  /  ${monthLabel}`, 44, 12);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...muted);
        doc.text("Activity log continued", 44, 17);
        doc.setDrawColor(...border);
        doc.line(12, 22, pageWidth - 12, 22);
      }
      doc.setDrawColor(...border);
      doc.line(12, pageHeight - 12, pageWidth - 12, pageHeight - 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.8);
      doc.setTextColor(...muted);
      doc.text("Kent Business College  |  Off-the-job learning record", 12, pageHeight - 7);
      doc.text(`Page ${doc.getNumberOfPages()} of ${totalPagesToken}`, pageWidth - 12, pageHeight - 7, { align: "right" });
    },
  });

  const tableEndY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 150;
  let signatureY = tableEndY + 6;
  if (signatureY + 22 > pageHeight - 14) {
    doc.addPage();
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageWidth, 3, "F");
    if (logo) doc.addImage(logo, "PNG", 12, 7, 25, 11.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...navy);
    doc.text(`${learner.name}  /  ${monthLabel}`, 44, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text("Monthly record sign-off", 44, 17);
    doc.setDrawColor(...border);
    doc.line(12, 22, pageWidth - 12, 22);
    doc.line(12, pageHeight - 12, pageWidth - 12, pageHeight - 12);
    doc.setFontSize(6.8);
    doc.text("Kent Business College  |  Off-the-job learning record", 12, pageHeight - 7);
    doc.text(`Page ${doc.getNumberOfPages()} of ${totalPagesToken}`, pageWidth - 12, pageHeight - 7, { align: "right" });
    signatureY = 32;
  }
  drawSignatureCard(doc, 12, signatureY, "Learner sign-off", learner.name, signatures?.learner);
  drawSignatureCard(doc, 153, signatureY, "Coach sign-off", coach, signatures?.coach);

  if (typeof doc.putTotalPages === "function") doc.putTotalPages(totalPagesToken);
  doc.save(`Learner-Journal_${learner.name}_${monthLabel.replace(/[^a-z0-9]+/gi, "-")}.pdf`);
}
