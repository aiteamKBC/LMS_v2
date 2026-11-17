import { Fragment, useMemo, useState } from "react";
import Panel from "@/components/base/Panel";
import RagStackBar from "@/components/qms/RagStackBar";
import { formatDate, formatNumber, formatPct } from "@/lib/qms";
import type { FormDefinition } from "@/types/qms";
import styles from "../ExecutiveOverview.module.css";

interface RegistryTableProps {
  forms: FormDefinition[];
}

type SortKey = "submissions" | "latest" | "name";

export default function RegistryTable({ forms }: RegistryTableProps) {
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
      description="Every registered form type with its evaluation policy coverage. Expand a row for scoring detail."
      headingId="registry-heading"
      className={styles.registry}
      bodyClassName="px-0 pb-1 pt-0"
      action={<span className={styles.countBadge}>{formatNumber(forms.length)} form types</span>}
    >
      <div className={`kbc-scroll ${styles.registryScroll}`} tabIndex={0} role="region" aria-label="Registered quality forms">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <caption className="sr-only">
            Registered quality forms, their respondent and subject, evaluation policy and status mix
          </caption>
          <thead className={styles.tableHead}>
            <tr className="border-b border-background-200">
              <th scope="col" className="px-4 py-2.5 sm:px-5">{headerButton("name", "Form")}</th>
              <th scope="col" className="px-3 py-2.5 font-label text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground-600">
                Respondent → subject
              </th>
              <th scope="col" className="px-3 py-2.5 font-label text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground-600">
                Evaluation policy
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">{headerButton("submissions", "Records")}</th>
              <th scope="col" className="px-3 py-2.5">{headerButton("latest", "Latest")}</th>
              <th scope="col" className="w-[190px] px-3 py-2.5 font-label text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground-600">
                Status mix
              </th>
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
                    <td className="px-3 py-3">
                      {form.policyId ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded bg-primary-50 px-1.5 py-0.5 font-label text-[10.5px] font-semibold text-primary-700">
                            <i className="ri-shield-check-line text-[11px]" aria-hidden="true" />
                            {form.policyId}
                          </span>
                          <p className="mt-1 text-[11px] text-foreground-500">Policy v{form.policyVersion}</p>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-[var(--rag-grey-bg)] px-1.5 py-0.5 font-label text-[10.5px] font-semibold text-[var(--rag-grey-fg)]">
                          <i className="ri-question-line text-[11px]" aria-hidden="true" />
                          No approved policy
                        </span>
                      )}
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
                    <td className="px-3 py-3">
                      {form.ragSupported ? (
                        <RagStackBar
                          counts={form.rag}
                          showLegend={false}
                          compact
                          label={`${form.shortName} status mix`}
                        />
                      ) : (
                        <p className="text-[11px] text-foreground-500">Not banded</p>
                      )}
                      <p className="mt-1 font-label text-[10.5px] text-foreground-500">
                        {form.rag.green}G · {form.rag.amber}A · {form.rag.red}R
                        {form.rag.unrated ? ` · ${form.rag.unrated} unrated` : ""}
                      </p>
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
                      <td colSpan={7} id={`form-detail-${form.id}`} className="px-4 py-3 sm:px-5">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <p className="font-label text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
                              Scoring method
                            </p>
                            <p className="mt-1 text-[12px] text-foreground-800">{form.scoringMethod}</p>
                          </div>
                          <div>
                            <p className="font-label text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
                              Questions / answer types
                            </p>
                            <p className="mt-1 text-[12px] text-foreground-800">
                              {form.questionCount} questions · {form.answerTypes.join(", ")}
                            </p>
                          </div>
                          <div>
                            <p className="font-label text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
                              Owner
                            </p>
                            <p className="mt-1 text-[12px] text-foreground-800">{form.owner}</p>
                          </div>
                          <div>
                            <p className="font-label text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
                              Access
                            </p>
                            <p className="mt-1 text-[12px] text-foreground-800">{form.access}</p>
                          </div>
                        </div>
                        <div className="mt-3 rounded-lg bg-background-50 px-3 py-2">
                          <p className="font-label text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground-600">
                            Approved RAG rule
                          </p>
                          <p className="mt-1 text-[12px] leading-relaxed text-foreground-800">
                            {form.policySummary}
                          </p>
                        </div>
                        <p className="mt-2 font-label text-[11px] text-foreground-500">
                          Source: {form.sourceTable} · Action may be required:{" "}
                          {form.requiresAction ? "Yes" : "No"}
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
      <p className={styles.tableNote}>Expand a form to explore its scoring method, policy and access details.</p>
    </Panel>
  );
}

