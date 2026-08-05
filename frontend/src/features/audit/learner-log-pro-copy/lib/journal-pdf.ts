import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { LearnerActivity, LearnerSummary } from "./api";

const navy: [number, number, number] = [31, 49, 73];
const border: [number, number, number] = [205, 202, 193];
const soft: [number, number, number] = [244, 243, 238];

function hours(value: number | null | undefined) {
  return value == null ? "-" : `${value.toFixed(2)} h`;
}

export function downloadLearnerJournalPdf(
  learner: LearnerSummary,
  monthLabel: string,
  rows: LearnerActivity[],
  cumulative?: LearnerSummary,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const totalPagesToken = "{total_pages_count_string}";
  const moduleName = rows[0]?.month_unit ?? "-";
  const topic = moduleName.replace(/^Month\s+\d+\s*:\s*/i, "") || rows[0]?.activity_unit || "-";
  const programme = rows.find((row) => row.source_course)?.source_course ?? "-";
  const cumulativeData = cumulative ?? learner;
  const gap = learner.gap_hours;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Learner Journal — Monthly Off-the-Job Record", 12, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(73, 83, 96);
  doc.text(`${monthLabel} · Learning topic of the month: ${topic}`, 12, 23);

  autoTable(doc, {
    startY: 28,
    margin: { left: 12, right: 38 },
    theme: "grid",
    body: [
      ["Learner", learner.name, "Programme", programme],
      ["Module", moduleName, "Coach", "-"],
      ["Planned hours (month)", hours(learner.planned_hours), "Accepted hours (month)", hours(learner.actual_hours)],
      ["Claimed hours (month)", hours(learner.actual_hours), "Gap (month)", hours(gap)],
      ["Cumulative actual hours", hours(cumulativeData.actual_hours), "Cumulative planned hours", hours(cumulativeData.planned_hours)],
      ["Cumulative gap", hours(cumulativeData.gap_hours), "", ""],
    ],
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.5, lineColor: border, lineWidth: 0.2, textColor: [15, 23, 42] },
    columnStyles: {
      0: { cellWidth: 39, fillColor: soft, fontStyle: "bold" },
      1: { cellWidth: 82 },
      2: { cellWidth: 43, fillColor: soft, fontStyle: "bold" },
      3: { cellWidth: 83 },
    },
  });

  const summaryEndY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 63;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Activity log", 12, summaryEndY + 8);

  autoTable(doc, {
    startY: summaryEndY + 11,
    margin: { left: 12, right: 10, bottom: 18 },
    theme: "grid",
    head: [[
      "Activity ID", "Date", "Activity description", "Topic", "Activity type",
      "Timestamp (from-to)", "Source of information", "Claimed", "Accepted", "Paid hour",
    ]],
    body: rows.map((row) => {
      return [
        row.plan_id,
        row.learner_activity_date ?? "-",
        row.activity_description || row.activity_unit,
        row.activity_unit,
        row.delivery_method || row.activity_category,
        row.time_from_to ?? "-",
        row.source_course || row.source_url || "-",
        hours(row.actual_lms_hours),
        hours(row.actual_lms_hours),
        "True",
      ];
    }),
    foot: [["", "", "", "", "", "", "Month claimed / accepted", hours(learner.actual_hours), hours(learner.actual_hours), ""]],
    styles: {
      font: "helvetica",
      fontSize: 5.9,
      cellPadding: 1.25,
      lineColor: border,
      lineWidth: 0.15,
      overflow: "linebreak",
      valign: "middle",
      textColor: [15, 23, 42],
    },
    headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 5.7 },
    footStyles: { fillColor: soft, textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 15 }, 1: { cellWidth: 16 }, 2: { cellWidth: 42 },
      3: { cellWidth: 27 }, 4: { cellWidth: 22 }, 5: { cellWidth: 23 },
      6: { cellWidth: 26 }, 7: { cellWidth: 14, halign: "right" },
      8: { cellWidth: 15, halign: "right" }, 9: { cellWidth: 13, halign: "center" },
    },
    didDrawPage: () => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(92, 103, 115);
      doc.text("Evidence pack — off-the-job hours. Generated live from Audit.learner_match.", 12, pageHeight - 7);
      doc.text(`Page ${doc.getNumberOfPages()} of ${totalPagesToken}`, pageWidth - 12, pageHeight - 7, { align: "right" });
    },
  });

  if (typeof doc.putTotalPages === "function") doc.putTotalPages(totalPagesToken);
  doc.save(`Learner-Journal_${learner.name}_${monthLabel.replace(/[^a-z0-9]+/gi, "-")}.pdf`);
}
