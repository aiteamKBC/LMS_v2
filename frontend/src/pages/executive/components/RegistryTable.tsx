import { memo, Fragment, useMemo, useState } from "react";
import Panel from "@/components/base/Panel";
import { formatDate, formatNumber, formatPct } from "@/lib/qms";
import type { FormDefinition, QualityRecord } from "@/types/qms";
import styles from "../ExecutiveOverview.module.css";

interface RegistryTableProps {
  forms: FormDefinition[];
  records?: QualityRecord[];
}

type Outcome = { label: string; value: number; tone: string };

const TONES = {
  gold: "border-amber-200 bg-amber-50 text-amber-900",
  green: "border-emerald-100 bg-emerald-50 text-emerald-800",
  amber: "border-amber-100 bg-amber-50 text-amber-800",
  red: "border-rose-100 bg-rose-50 text-rose-800",
  grey: "border-background-200 bg-background-50 text-foreground-700",
};

function outcomesFor(form: FormDefinition, records: QualityRecord[]): { title: string; items: Outcome[]; note: string } {
  const rows = records.filter((record) => record.formId === form.id);
  if (form.category === "Quality Audit") {
    const totals = { gold: 0, green: 0, amber: 0, red: 0, na: 0 };
    let rated = 0;
    rows.forEach((record) => {
      if (!record.ratingCounts) return;
      rated += 1;
      (Object.keys(totals) as (keyof typeof totals)[]).forEach((key) => { totals[key] += record.ratingCounts?.[key] ?? 0; });
    });
    const drafts = rows.filter((record) => record.reviewStatus !== "completed").length;
    return {
      title: "Criterion ratings in scope",
      items: [
        { label: "Gold", value: totals.gold, tone: TONES.gold },
        { label: "Green", value: totals.green, tone: TONES.green },
        { label: "Amber", value: totals.amber, tone: TONES.amber },
        { label: "Red", value: totals.red, tone: TONES.red },
        { label: "Not applicable", value: totals.na, tone: TONES.grey },
      ],
      note: `${formatNumber(rated)} completed review${rated === 1 ? "" : "s"} with stored ratings${drafts ? ` · ${formatNumber(drafts)} draft${drafts === 1 ? "" : "s"}` : ""}`,
    };
  }
  const count = (value: string) => rows.filter((record) => record.feedbackClassification === value).length;
  const unclassified = rows.filter((record) => !record.feedbackClassification).length;
  return {
    title: "Response classifications in scope",
    items: [
      { label: "Positive", value: count("positive"), tone: TONES.green },
      { label: "Neutral", value: count("neutral"), tone: TONES.amber },
      { label: "Negative", value: count("negative"), tone: TONES.red },
      { label: "Unscored", value: count("unscored"), tone: TONES.grey },
    ],
    note: `${formatNumber(rows.length)} completed response${rows.length === 1 ? "" : "s"}${unclassified ? ` · ${formatNumber(unclassified)} without a classification` : ""}`,
  };
}

type SortKey = "submissions" | "latest" | "name";

function RegistryTable({ forms, records = [] }: RegistryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("submissions");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...forms];
    copy.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "latest") return (b.latest || "").localeCompare(a.latest || "");
      return b.submissions - a.submissions;
    });
    return copy;
  }, [forms, sortKey]);

  const headerButton = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSortKey(key)}
      className={`inline-flex items-center gap-1 font-label text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors ${
        sortKey === key ? "text-foreground-950" : "text-foreground-600 hover:text-foreground-900"
      }`}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <i
        className={`text-[12px] ${sortKey === key ? "ri-arrow-down-line" : "ri-arrow-up-down-line opacity-60"}`}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <Panel
      title="Form registry"
      description="Every registered form type. Expand a row for its outcome breakdown and evaluation rule."
      headingId="registry-heading"
      className={styles.registry}
      bodyClassName="px-0 pb-1 pt-0"
      action={<span className={styles.countBadge}>{formatNumber(forms.length)} form types</span>}
    >
      <div className={`kbc-scroll ${styles.registryScroll}`} tabIndex={0} role="region" aria-label="Registered quality forms">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <caption className="sr-only">
            Registered quality forms, their respondent and subject, and record counts
          </caption>
          <thead className={styles.tableHead}>
            <tr className="border-b border-background-200">
              <th scope="col" className="px-4 py-2.5 sm:px-5">{headerButton("name", "Form")}</th>
              <th scope="col" className="px-3 py-2.5 font-label text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground-600">
                Respondent → subject
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">{headerButton("submissions", "Records")}</th>
              <th scope="col" className="px-3 py-2.5">{headerButton("latest", "Latest")}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-label text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground-600 sm:px-5">
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((form) => {
              const isOpen = expanded === form.id;
              return (
                <Fragment key={form.id}>
                  <tr
                    className={`border-b border-background-100 align-top transition-colors ${
                      isOpen ? "bg-background-100/60" : "hover:bg-background-100/60"
                    }`}
                  >
                    <td className="px-4 py-3 sm:px-5">
                      <p className="font-label text-[12.5px] font-semibold text-foreground-950">
                        {form.shortName}
                      </p>
                      <p className="mt-0.5 font-label text-[11px] text-foreground-500">
                        {form.id} · v{form.version} · {form.category}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-[12px] text-foreground-800">{form.respondentType}</p>
                      <p className="text-[11px] text-foreground-500">Subject: {form.subjectType}</p>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <p className="font-label text-[12.5px] font-semibold text-foreground-950">
                        {formatNumber(form.submissions)}
                      </p>
                      {form.completionRate !== null ? (
                        <p className="text-[11px] text-foreground-500">
                          {formatPct(form.completionRate * 100)}{form.scheduled > 0 ? ` of ${formatNumber(form.scheduled)}` : ' of saved records completed'}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-[11.5px] text-foreground-700">
                      {formatDate(form.latest)}
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : form.id)}
                        aria-expanded={isOpen}
                        aria-controls={`form-detail-${form.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-background-300 px-2 py-1 font-label text-[11.5px] font-medium text-foreground-700 transition-colors hover:bg-background-50"
                      >
                        {isOpen ? "Hide" : "Detail"}
                        <i
                          className={`text-[12px] ${isOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"}`}
                          aria-hidden="true"
                        />
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="border-b border-background-200 bg-background-100/60">
                      <td colSpan={5} id={`form-detail-${form.id}`} className="px-4 py-3 sm:px-5">
                        {(() => {
                          const outcome = outcomesFor(form, records);
                          return (
                            <div>
                              <p className="font-label text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
                                {outcome.title}
                              </p>
                              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                                {outcome.items.map((item) => (
                                  <div key={item.label} className={`rounded-lg border px-3 py-2 ${item.tone}`}>
                                    <p className="text-[11px] font-semibold">{item.label}</p>
                                    <p className="mt-0.5 text-lg font-semibold">{formatNumber(item.value)}</p>
                                  </div>
                                ))}
                              </div>
                              <p className="mt-1.5 text-[11px] text-foreground-600">{outcome.note}</p>
                            </div>
                          );
                        })()}
                        <div className="mt-3 rounded-lg bg-background-50 px-3 py-2">
                          <p className="font-label text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
                            Evaluation rule
                          </p>
                          <p className="mt-1 text-[12px] leading-relaxed text-foreground-800">{form.policySummary}</p>
                        </div>
                        <p className="mt-2 font-label text-[11px] text-foreground-500">
                          {form.questionCount} questions{form.answerTypes.length ? ` · ${form.answerTypes.join(", ")}` : ""} · Owner: {form.owner}
                          {form.category === "Quality Audit" ? ` · Follow-up actions recorded: ${form.requiresAction ? "Yes" : "No"}` : ""}
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.tableNote}>Expand a form to see its outcome breakdown and evaluation rule.</p>
    </Panel>
  );
}

export default memo(RegistryTable);
