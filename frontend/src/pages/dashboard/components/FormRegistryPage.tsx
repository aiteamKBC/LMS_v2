import { useMemo, useState } from "react";
import { COACH_SESSIONS } from "@/mocks/sessions";
import { FORM_CATEGORIES, FORM_REGISTRY } from "@/mocks/formRegistry";
import { CATEGORY_STYLES, QUALITY_STATUSES, QUALITY_STATUS_STYLES } from "@/pages/dashboard/constants";
import { describePolicy, emptyStatusCount, getPolicy, hasApprovedPolicy, qualityForSession } from "@/pages/dashboard/rag";
import type { FormCategoryId } from "@/pages/dashboard/types";
import { fmtDate, pct } from "@/pages/dashboard/utils";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const categoryLabel = (id: FormCategoryId) => FORM_CATEGORIES.find((item) => item.id === id)?.label ?? id;

export default function FormRegistryPage() {
  const [category, setCategory] = useState<"all" | FormCategoryId>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      FORM_REGISTRY.map((form) => {
        const sessions = COACH_SESSIONS.filter((session) => session.formType === form.name);
        const counts = emptyStatusCount();
        sessions.forEach((session) => {
          counts[qualityForSession(session).status] += 1;
        });
        const latest = sessions.reduce((acc, session) => (session.date > acc ? session.date : acc), "");
        const awaiting = sessions.filter((session) => session.status === "Awaiting check" || session.status === "In review").length;
        return { form, policy: getPolicy(form.policyId), total: sessions.length, counts, latest, awaiting };
      }),
    [],
  );

  const summary = useMemo(() => {
    const submissions = rows.reduce((sum, row) => sum + row.total, 0);
    const unrated = rows.reduce((sum, row) => sum + row.counts["Not assessed"], 0);
    const rated = rows.reduce((sum, row) => sum + row.counts.Green + row.counts.Amber + row.counts.Red, 0);
    const approved = rows.filter((row) => hasApprovedPolicy(row.policy)).length;
    return { forms: rows.length, approved, submissions, unrated, rated };
  }, [rows]);

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchCategory = category === "all" || row.form.category === category;
      const matchQuery =
        search === "" ||
        row.form.name.toLowerCase().includes(search) ||
        row.form.subject.toLowerCase().includes(search) ||
        row.form.owner.toLowerCase().includes(search) ||
        row.form.respondent.toLowerCase().includes(search);
      return matchCategory && matchQuery;
    });
  }, [rows, category, query]);

  const cards = [
    { label: "Registered form types", value: String(summary.forms), hint: `${summary.approved} with an approved scoring policy`, icon: "ri-file-list-3-line", tile: "bg-primary-100 text-primary-800" },
    { label: "Quality categories", value: String(FORM_CATEGORIES.length), hint: "grouped by what the form evaluates", icon: "ri-stack-line", tile: "bg-secondary-100 text-secondary-900" },
    { label: "Submissions", value: String(summary.submissions), hint: `${summary.rated} carry a rating`, icon: "ri-inbox-archive-line", tile: "bg-accent-100 text-accent-900" },
    { label: "Not assessed", value: String(summary.unrated), hint: "no rating calculated — not assumed Green", icon: "ri-question-line", tile: "bg-background-200 text-foreground-700" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-[640px]">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground-400">Quality configuration</p>
          <h2 className="mt-1 font-heading text-[19px] font-semibold leading-tight text-foreground-950">Forms &amp; quality categories</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-foreground-600">
            Every form type used to judge quality, with the owner, the person who completes it, what it evaluates and the scoring policy applied.
            Adding a form here is all that is needed for it to appear in reporting.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-background-200 bg-background-50 px-2.5 py-1.5 text-[11px] text-foreground-600">
          <i className="ri-shield-check-line text-[14px] text-primary-600" aria-hidden />
          Policy version recorded on every rating
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="rounded-lg border border-background-200 bg-background-50 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-500">{card.label}</p>
              <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-md ${card.tile}`}>
                <i className={`${card.icon} text-[15px]`} aria-hidden />
              </span>
            </div>
            <p className="mt-1.5 font-heading text-[26px] font-semibold leading-none tabular-nums text-foreground-950">{card.value}</p>
            <p className="mt-2 text-[10.5px] leading-snug text-foreground-500">{card.hint}</p>
          </article>
        ))}
      </div>

      <section aria-labelledby="policy-rules" className="rounded-lg border border-background-200 bg-background-50 p-4">
        <h3 id="policy-rules" className="font-heading text-[13px] font-semibold text-foreground-950">
          How a rating is decided
        </h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="flex gap-2">
            <i className="ri-links-line mt-0.5 text-[15px] text-primary-600" aria-hidden />
            <p className="text-[11.5px] leading-relaxed text-foreground-600">
              Each form type has its own policy. A safeguarding form and a commitment session are never judged by the same thresholds.
            </p>
          </div>
          <div className="flex gap-2">
            <i className="ri-alarm-warning-line mt-0.5 text-[15px] text-primary-600" aria-hidden />
            <p className="text-[11.5px] leading-relaxed text-foreground-600">
              A critical criterion that fails is always Red. Satisfactory answers elsewhere never average it away.
            </p>
          </div>
          <div className="flex gap-2">
            <i className="ri-question-line mt-0.5 text-[15px] text-primary-600" aria-hidden />
            <p className="text-[11.5px] leading-relaxed text-foreground-600">
              If evidence is missing, a review is incomplete, or no policy is approved, the record stays <strong className="font-semibold text-foreground-800">Not assessed</strong>. It is never counted as Green.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-[280px]">
          <i className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-foreground-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search form, subject or owner"
            aria-label="Search form types"
            className="w-full rounded-md border border-background-200 bg-background-50 py-1.5 pl-8 pr-2.5 text-[12px] text-foreground-900 outline-none placeholder:text-foreground-400 focus:border-primary-400"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-full border border-background-200 bg-background-100 px-1 py-1">
          <button
            type="button"
            onClick={() => setCategory("all")}
            aria-pressed={category === "all"}
            className={cn(
              "cursor-pointer whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
              category === "all" ? "bg-background-50 text-foreground-950 ring-1 ring-background-200" : "text-foreground-500 hover:text-foreground-800",
            )}
          >
            All categories
          </button>
          {FORM_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              aria-pressed={category === item.id}
              className={cn(
                "cursor-pointer whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                category === item.id ? "bg-background-50 text-foreground-950 ring-1 ring-background-200" : "text-foreground-500 hover:text-foreground-800",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-foreground-500">
          {visible.length} of {rows.length} form types
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-background-200 bg-background-50 px-4 py-10 text-center">
            <i className="ri-file-search-line text-[24px] text-foreground-300" aria-hidden />
            <p className="mt-1 text-[12px] font-medium text-foreground-700">No form types match that search</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
              className="mt-2 cursor-pointer rounded-md border border-background-300 px-2.5 py-1 text-[11px] font-medium text-foreground-700 hover:bg-background-100"
            >
              Clear filters
            </button>
          </div>
        ) : (
          visible.map((row) => {
            const isOpen = openId === row.form.id;
            const total = row.total;
            const policyLines = describePolicy(row.policy);
            return (
              <article key={row.form.id} className="overflow-hidden rounded-lg border border-background-200 bg-background-50">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : row.form.id)}
                  aria-expanded={isOpen}
                  aria-controls={`${row.form.id}-detail`}
                  className="flex w-full cursor-pointer flex-col gap-3 p-3.5 text-left transition-colors hover:bg-background-100/70 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", CATEGORY_STYLES[row.form.category])}>{categoryLabel(row.form.category)}</span>
                      <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-medium text-foreground-600">{row.form.version}</span>
                      {!hasApprovedPolicy(row.policy) ? (
                        <span className="rounded-full bg-background-200 px-2 py-0.5 text-[10px] font-semibold text-foreground-700">No policy</span>
                      ) : null}
                    </div>
                    <h4 className="mt-1.5 font-heading text-[13.5px] font-semibold leading-snug text-foreground-950">{row.form.name}</h4>
                    <p className="mt-0.5 text-[11px] text-foreground-500">
                      {row.form.respondent} → {row.form.owner} · policy {row.policy.id} ({row.policy.version})
                    </p>
                  </div>

                  <div className="flex flex-none items-center gap-4">
                    <div className="text-right">
                      <p className="font-heading text-[16px] font-semibold leading-none tabular-nums text-foreground-900">{total}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-foreground-400">submissions</p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-[11.5px] font-medium text-foreground-700">{row.latest ? fmtDate(row.latest) : "—"}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-foreground-400">latest</p>
                    </div>
                    <div className="hidden w-[132px] text-right sm:block">
                      <p className="text-[11.5px] font-medium text-foreground-700">{row.awaiting > 0 ? `${row.awaiting} awaiting check` : "No open checks"}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-foreground-400">queue</p>
                    </div>
                    <span className="grid size-7 place-items-center rounded-md border border-background-200 text-foreground-500">
                      <i className={isOpen ? "ri-arrow-up-s-line text-[15px]" : "ri-arrow-down-s-line text-[15px]"} aria-hidden />
                    </span>
                  </div>
                </button>

                <div className="border-t border-background-100 px-3.5 py-2.5">
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-background-200">
                    {QUALITY_STATUSES.map((status) =>
                      row.counts[status] > 0 ? (
                        <span
                          key={status}
                          style={{ width: `${pct(row.counts[status], total)}%`, backgroundColor: QUALITY_STATUS_STYLES[status].bar }}
                          aria-hidden
                        />
                      ) : null,
                    )}
                  </div>
                  <ul className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {QUALITY_STATUSES.filter((status) => row.counts[status] > 0).map((status) => (
                      <li key={status} className="flex items-center gap-1.5 text-[10.5px] text-foreground-600">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: QUALITY_STATUS_STYLES[status].bar }} aria-hidden />
                        {QUALITY_STATUS_STYLES[status].label}: <strong className="font-semibold tabular-nums text-foreground-800">{row.counts[status]}</strong>
                      </li>
                    ))}
                    {total === 0 ? <li className="text-[10.5px] text-foreground-500">No submissions recorded for this form type yet.</li> : null}
                  </ul>
                </div>

                {isOpen ? (
                  <div id={`${row.form.id}-detail`} className="qa-rise grid gap-4 border-t border-background-100 bg-background-100/40 p-4 md:grid-cols-2">
                    <section>
                      <h5 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-400">Registry record</h5>
                      <dl className="mt-2 grid gap-2 text-[11.5px]">
                        <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
                          <dt className="text-foreground-500">Subject</dt>
                          <dd className="text-foreground-800">{row.form.subject}</dd>
                        </div>
                        <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
                          <dt className="text-foreground-500">Source</dt>
                          <dd className="font-mono text-[11px] text-foreground-700">{row.form.source}</dd>
                        </div>
                        <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
                          <dt className="text-foreground-500">Answer types</dt>
                          <dd className="text-foreground-800">{row.form.answerTypes.join(", ")}</dd>
                        </div>
                        <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
                          <dt className="text-foreground-500">Metrics</dt>
                          <dd className="text-foreground-800">{row.form.metrics.join(", ")}</dd>
                        </div>
                        <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
                          <dt className="text-foreground-500">Actions</dt>
                          <dd className="text-foreground-800">{row.form.actionsAllowed ? "Improvement action may be raised from this form" : "No action permitted from this form"}</dd>
                        </div>
                        <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
                          <dt className="text-foreground-500">Access</dt>
                          <dd className="text-foreground-800">{row.form.access.join(", ")}</dd>
                        </div>
                      </dl>
                    </section>

                    <section>
                      <h5 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-400">
                        Evaluation policy · {row.policy.id} {row.policy.version}
                      </h5>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-foreground-700">{row.policy.summary}</p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {policyLines.map((line) => (
                          <li key={line} className="flex gap-1.5 text-[11.5px] leading-relaxed text-foreground-600">
                            <i className="ri-checkbox-blank-circle-line mt-1 text-[8px] text-foreground-400" aria-hidden />
                            {line}
                          </li>
                        ))}
                      </ul>
                      {!hasApprovedPolicy(row.policy) ? (
                        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
                          This form type is shown for historical reference only. Any rating would be invented, so it is reported as Not assessed until a policy is approved.
                        </p>
                      ) : null}
                    </section>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      <p className="text-[10.5px] leading-relaxed text-foreground-500">
        Ratings shown are calculated from the policies above and from recorded quality decisions. Records that are scheduled, incomplete or hold no approved policy are counted separately, never folded into a Green total.
      </p>
    </div>
  );
}
