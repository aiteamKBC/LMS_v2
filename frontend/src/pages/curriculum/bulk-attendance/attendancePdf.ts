import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { AttendanceStatus, Learner } from "@/types/bulkAttendance";
import { formatDateLabel } from "@/utils/bulkAttendance";
import { slugify } from "@/utils/bulkCsv";
import type { LearnerHistoryRecord } from "./components/LearnerHistoryModal";

type Color = [number, number, number];

const colors = {
  ink: [24, 37, 64] as Color,
  purple: [91, 43, 184] as Color,
  purpleSoft: [242, 238, 253] as Color,
  green: [10, 129, 75] as Color,
  red: [190, 35, 41] as Color,
  muted: [93, 106, 130] as Color,
  line: [220, 225, 235] as Color,
  soft: [248, 249, 252] as Color,
  white: [255, 255, 255] as Color,
};

const pageWidth = 210;
const pageHeight = 297;
const margin = 14;

export interface AttendanceSummaryEntry {
  name: string;
  learners: number;
  present: number;
  absent: number;
  total: number;
  rate: number;
}

export interface AttendancePdfLearner {
  learner: Learner;
  groupName: string;
  cohortName: string;
}

function clean(value: string | null | undefined): string {
  return value?.trim().replace(/[\u2010-\u2015\u2212]/g, "-") || "-";
}

function font(doc: jsPDF, size: number, bold = false, color = colors.ink) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function statusLabel(status: AttendanceStatus): string {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  return "Unmarked";
}

function statusColor(status: AttendanceStatus): Color {
  if (status === "present") return colors.green;
  if (status === "absent") return colors.red;
  return colors.muted;
}

function footer(doc: jsPDF, label: string) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...colors.line);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
    font(doc, 7, false, colors.muted);
    doc.text("Kent Business College", margin, pageHeight - 8);
    doc.text(label, pageWidth / 2, pageHeight - 8, { align: "center" });
    doc.text(`Page ${page} of ${pages}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }
}

function documentHeader(doc: jsPDF, title: string, subtitle: string) {
  doc.setFillColor(...colors.purple);
  doc.rect(0, 0, pageWidth, 31, "F");
  font(doc, 8, true, colors.white);
  doc.text("KENT BUSINESS COLLEGE", margin, 11);
  font(doc, 17, true, colors.white);
  doc.text(title, margin, 20);
  font(doc, 8, false, [224, 215, 255]);
  doc.text(subtitle, margin, 26);
}

function statCards(
  doc: jsPDF,
  values: Array<{ label: string; value: string; color: Color }>,
  y: number,
) {
  const width = (pageWidth - margin * 2 - 6 * (values.length - 1)) / values.length;
  values.forEach((item, index) => {
    const x = margin + index * (width + 6);
    doc.setFillColor(...colors.soft);
    doc.roundedRect(x, y, width, 17, 2.5, 2.5, "F");
    doc.setFillColor(...item.color);
    doc.roundedRect(x, y, 2.2, 17, 1.1, 1.1, "F");
    font(doc, 6.5, true, colors.muted);
    doc.text(item.label.toUpperCase(), x + 5.5, y + 6);
    font(doc, 12, true, item.color);
    doc.text(item.value, x + 5.5, y + 13);
  });
}

function learnerStats(
  learner: Learner,
  dayIsos: string[],
  getStatus: (learnerId: string, day: string) => AttendanceStatus,
) {
  const statuses = dayIsos.map((day) => getStatus(learner.id, day));
  const present = statuses.filter((status) => status === "present").length;
  const absent = statuses.filter((status) => status === "absent").length;
  const unmarked = statuses.length - present - absent;
  const marked = present + absent;
  return {
    present,
    absent,
    unmarked,
    rate: marked ? Math.round((present / marked) * 100) : 0,
    status: dayIsos.length === 1 ? statusLabel(statuses[0] ?? "unmarked") : `P ${present} / A ${absent} / U ${unmarked}`,
  };
}

/** Export the selected summary and each learner's attendance outcomes as one PDF. */
export function downloadAttendanceSummaryPdf({
  rows,
  entries,
  breakdownLabel,
  start,
  end,
  scopeLabel,
  dayIsos,
  getStatus,
}: {
  rows: AttendancePdfLearner[];
  entries: AttendanceSummaryEntry[];
  breakdownLabel: string;
  start: string;
  end: string;
  scopeLabel: string;
  dayIsos: string[];
  getStatus: (learnerId: string, day: string) => AttendanceStatus;
}) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `Attendance report - ${scopeLabel}`,
    author: "Kent Business College",
    subject: "Attendance summary and learner details",
  });

  documentHeader(
    doc,
    "Attendance report",
    `${formatDateLabel(start)} to ${formatDateLabel(end)} • ${clean(scopeLabel)}`,
  );
  const totals = entries.reduce(
    (result, entry) => ({
      learners: result.learners + entry.learners,
      present: result.present + entry.present,
      absent: result.absent + entry.absent,
      total: result.total + entry.total,
    }),
    { learners: 0, present: 0, absent: 0, total: 0 },
  );
  const marked = totals.present + totals.absent;
  const rate = marked ? Math.round((totals.present / marked) * 100) : 0;
  statCards(doc, [
    { label: "Learners", value: String(rows.length), color: colors.purple },
    { label: "Present", value: String(totals.present), color: colors.green },
    { label: "Absent", value: String(totals.absent), color: colors.red },
    { label: "Attendance rate", value: `${rate}%`, color: colors.purple },
  ], 39);

  font(doc, 11, true);
  doc.text(`Summary by ${breakdownLabel.toLowerCase()}`, margin, 66);
  font(doc, 7.5, false, colors.muted);
  doc.text(`${dayIsos.length} ${dayIsos.length === 1 ? "day" : "days"} included in this report`, margin, 71);
  autoTable(doc, {
    startY: 76,
    margin: { left: margin, right: margin, bottom: 20 },
    theme: "plain",
    head: [[breakdownLabel, "Learners", "Present", "Absent", "Marked", "Rate"]],
    body: entries.map((entry) => [entry.name, entry.learners, entry.present, entry.absent, entry.total, `${entry.rate}%`]),
    foot: [["Overall", rows.length, totals.present, totals.absent, totals.total, `${rate}%`]],
    styles: { font: "helvetica", fontSize: 7.5, minCellHeight: 8, cellPadding: 2.2, lineWidth: 0, textColor: colors.ink, valign: "middle" },
    headStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: "bold", fontSize: 7.2 },
    footStyles: { fillColor: colors.purpleSoft, textColor: colors.ink, fontStyle: "bold" },
    alternateRowStyles: { fillColor: colors.soft },
    columnStyles: { 0: { cellWidth: 70 }, 1: { halign: "center" }, 2: { halign: "center", textColor: colors.green }, 3: { halign: "center", textColor: colors.red }, 4: { halign: "center" }, 5: { halign: "center", fontStyle: "bold" } },
  });

  doc.addPage();
  documentHeader(doc, "Learner attendance", `${formatDateLabel(start)} to ${formatDateLabel(end)} • ${clean(scopeLabel)}`);
  font(doc, 11, true);
  doc.text("Learner details", margin, 42);
  font(doc, 7.5, false, colors.muted);
  doc.text("Names, groups, cohorts and attendance outcome for the selected period", margin, 47);
  autoTable(doc, {
    startY: 52,
    margin: { left: margin, right: margin, top: 38, bottom: 20 },
    theme: "plain",
    showHead: "everyPage",
    head: [["Learner", "Email", "Group", "Cohort", "Attendance", "Rate"]],
    body: rows.map((row) => {
      const stats = learnerStats(row.learner, dayIsos, getStatus);
      return [row.learner.name, row.learner.email, row.groupName || "Unassigned", row.cohortName || "Unassigned", stats.status, `${stats.rate}%`];
    }),
    styles: { font: "helvetica", fontSize: 7, minCellHeight: 9, cellPadding: 2.1, lineWidth: 0, textColor: colors.ink, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: colors.soft },
    columnStyles: { 0: { cellWidth: 31 }, 1: { cellWidth: 47 }, 2: { cellWidth: 28 }, 3: { cellWidth: 28 }, 4: { cellWidth: 30, halign: "center" }, 5: { cellWidth: 18, halign: "center", fontStyle: "bold" } },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) documentHeader(doc, "Learner attendance", `${formatDateLabel(start)} to ${formatDateLabel(end)} • ${clean(scopeLabel)}`);
    },
  });
  footer(doc, "Attendance report");
  doc.save(`attendance-report_${slugify(scopeLabel)}_${start}_to_${end}.pdf`);
}

/** Export one learner's entire saved KBC and live-session attendance history. */
export function downloadLearnerAttendancePdf({
  learner,
  cohortName,
  moduleLabel,
  history,
}: {
  learner: Learner;
  cohortName: string;
  moduleLabel: string;
  history: Array<LearnerHistoryRecord & { attendance: AttendanceStatus }>;
}) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `Attendance history - ${learner.name}`,
    author: "Kent Business College",
    subject: "Learner attendance history",
  });
  documentHeader(doc, "Learner attendance", "Saved KBC attendance and live-session register history");
  font(doc, 7, true, colors.muted);
  doc.text("LEARNER", margin, 40);
  font(doc, 12, true);
  doc.text(clean(learner.name), margin, 46);
  font(doc, 8, false, colors.muted);
  doc.text(clean(learner.email), margin, 51);
  doc.text(`Cohort: ${clean(cohortName)}`, 108, 43);
  doc.text(`Module: ${clean(moduleLabel || "All modules")}`, 108, 48);

  const countedHistory = history.filter((entry) => entry.countsAsSession !== false);
  const present = countedHistory.filter((entry) => entry.attendance === "present").length;
  const absent = countedHistory.filter((entry) => entry.attendance === "absent").length;
  const unmarked = countedHistory.length - present - absent;
  const marked = present + absent;
  statCards(doc, [
    { label: "Present", value: String(present), color: colors.green },
    { label: "Absent", value: String(absent), color: colors.red },
    { label: "Unmarked", value: String(unmarked), color: colors.muted },
    { label: "Attendance rate", value: `${marked ? Math.round((present / marked) * 100) : 0}%`, color: colors.purple },
  ], 59);

  font(doc, 11, true);
  doc.text("Attendance records", margin, 87);
  font(doc, 7.5, false, colors.muted);
  doc.text(`${countedHistory.length} ${countedHistory.length === 1 ? "session" : "sessions"}`, margin, 92);
  autoTable(doc, {
    startY: 97,
    margin: { left: margin, right: margin, top: 38, bottom: 20 },
    theme: "plain",
    showHead: "everyPage",
    head: [["Date", "Module", "Lecture", "Source", "Status"]],
    body: history.map((entry) => [formatDateLabel(entry.sessionDate), entry.moduleName,
      entry.makeupForDate ? `${entry.lectureName} (${entry.attendance === "present" ? "make-up" : "parallel group"} for ${formatDateLabel(entry.makeupForDate)})` : entry.lectureName,
      entry.source === "live" ? "Live register" : "KBC", statusLabel(entry.attendance)]),
    styles: { font: "helvetica", fontSize: 7.4, minCellHeight: 9, cellPadding: 2.2, lineWidth: 0, textColor: colors.ink, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: colors.ink, textColor: colors.white, fontStyle: "bold", fontSize: 7.1 },
    alternateRowStyles: { fillColor: colors.soft },
    columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 42 }, 2: { cellWidth: 65 }, 3: { cellWidth: 28 }, 4: { cellWidth: 23, halign: "center", fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 4) {
        data.cell.styles.textColor = statusColor(history[data.row.index].attendance);
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) documentHeader(doc, "Learner attendance", "Saved KBC attendance and live-session register history");
    },
  });
  footer(doc, "Learner attendance history");
  doc.save(`attendance-history_${slugify(learner.name)}.pdf`);
}
