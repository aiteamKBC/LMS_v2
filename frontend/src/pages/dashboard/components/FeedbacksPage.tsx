import { useMemo, useState } from "react";
import { FEEDBACKS } from "@/mocks/feedbacks";
import { StatusBadge, StatusDot } from "@/components/ui/StatusBadge";
import RagDonut from "@/pages/dashboard/components/RagDonut";
import type { Feedback, FeedbackSource, RagSlice } from "@/pages/dashboard/types";
import { fmtDate, pct } from "@/pages/dashboard/utils";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const STATUS_STYLE: Record<Feedback["status"], string> = {
  New: "bg-accent-100 text-accent-800 ring-accent-200",
  Acknowledged: "bg-secondary-100 text-secondary-900 ring-secondary-200",
  Escalated: "bg-red-50 text-red-700 ring-red-200",
};

const emptySlice = (): RagSlice => ({ red: 0, amber: 0, green: 0 });

const sliceFor = (list: Feedback[]): RagSlice => {
  const base = emptySlice();
  list.forEach((item) => {
    if (item.rag === "Green") base.green += 1;
    if (item.rag === "Amber") base.amber += 1;
    if (item.rag === "Red") base.red += 1;
  });
  return base;
};

const stars = (rating: number) => `${rating}.0`;

export default function FeedbacksPage({ onToast }: { onToast: (text: string) => void }) {
  const [source, setSource] = useState<"all" | FeedbackSource>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});

  const list = useMemo(
    () =>
      FEEDBACKS.filter((item) => {
        const matchSource = source === "all" || item.source === source;
        const q = query.trim().toLowerCase();
        const matchQuery =
          q === "" ||
          item.author.toLowerCase().includes(q) ||
          item.organisation.toLowerCase().includes(q) ||
          item.comment.toLowerCase().includes(q);
        return matchSource && matchQuery;
      }),
    [source, query],
  );

  const learnerSlice = useMemo(() => sliceFor(FEEDBACKS.filter((item) => item.source === "Learner")), []);
  const employerSlice = useMemo(() => sliceFor(FEEDBACKS.filter((item) => item.source === "Employer")), []);

  const average = useMemo(() => {
    if (FEEDBACKS.length === 0) return "0.0";
    const total = FEEDBACKS.reduce((sum, item) => sum + item.rating, 0);
    return (total / FEEDBACKS.length).toFixed(1);
  }, []);

  const positive = useMemo(() => pct(FEEDBACKS.filter((item) => item.rag === "Green").length, FEEDBACKS.length), []);
  const escalated = FEEDBACKS.filter((item) => item.status === "Escalated").length;

  const cards = [
    { label: "Responses", value: String(FEEDBACKS.length), hint: "learners and employers this quarter", icon: "ri-chat-smile-2-line", tile: "bg-primary-100 text-primary-700" },
    { label: "Average rating", value: `${average}/5`, hint: "weighted across both audiences", icon: "ri-star-line", tile: "bg-amber-100 text-amber-700" },
    { label: "Positive", value: `${positive}%`, hint: "rated green on sentiment", icon: "ri-emotion-happy-line", tile: "bg-emerald-100 text-emerald-700" },
    { label: "Escalated", value: String(escalated), hint: "awaiting quality lead response", icon: "ri-alert-line", tile: "bg-red-100 text-red-700" },
  ];

  const saveReply = (item: Feedback) => {
    const text = draft.trim();
    if (text.length < 4) {
      onToast("Write a short response before saving.");
      return;
    }
    setReplies((prev) => ({ ...prev, [item.id]: text }));
    setDraft("");
    setOpenId(null);
    onToast(`Response saved for ${item.id}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground-400">Voice of the customer</p>
          <h2 className="mt-1 font-heading text-[19px] font-semibold leading-tight text-foreground-950">Feedbacks</h2>
          <p className="mt-1 text-[12px] text-foreground-500">Feedback submitted by learners and employers about coaching and quality.</p>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-background-200 bg-background-100 px-1 py-1">
          {([
            { key: "all", label: "All feedback" },
            { key: "Learner", label: "Learners" },
            { key: "Employer", label: "Employers" },
          ] as { key: "all" | FeedbackSource; label: string }[]).map((tab) => {
            const isActive = source === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSource(tab.key)}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors",
                  isActive ? "bg-background-50 text-foreground-950 ring-1 ring-background-200" : "text-foreground-500 hover:text-foreground-800",
                )}
                aria-pressed={isActive}
              >
                {tab.label}
              </button>
            );
          })}
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
            <p className="mt-2 truncate text-[10.5px] text-foreground-500">{card.hint}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <RagDonut title="Learner sentiment" caption="How learners rate their coaching experience" slices={learnerSlice} centerLabel="feedback" />
        <RagDonut title="Employer sentiment" caption="How employers rate progress and communication" slices={employerSlice} centerLabel="feedback" />
      </div>

      <section className="rounded-lg border border-background-200 bg-background-50">
        <div className="flex flex-wrap items-center gap-2 border-b border-background-200 p-3">
          <div className="relative min-w-0 flex-1 sm:max-w-[320px]">
            <i className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-foreground-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search learner, employer or comment"
              className="w-full rounded-md border border-background-200 bg-background-50 py-1.5 pl-8 pr-2.5 text-[12px] text-foreground-900 outline-none placeholder:text-foreground-400 focus:border-primary-400"
            />
          </div>
          <span className="ml-auto text-[11px] text-foreground-500">
            {list.length} of {FEEDBACKS.length} responses
          </span>
        </div>

        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 px-4 py-14 text-center">
            <i className="ri-chat-off-line text-[26px] text-foreground-300" aria-hidden />
            <p className="text-[12px] font-medium text-foreground-600">No feedback matches that search</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSource("all");
              }}
              className="mt-2 cursor-pointer rounded-md border border-background-300 px-2.5 py-1 text-[11px] font-medium text-foreground-700 hover:bg-background-100"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-background-100">
            {list.map((item) => {
              const isOpen = openId === item.id;
              const reply = replies[item.id];
              return (
                <li key={item.id} className="p-3.5 md:p-4">
                  <div className="flex flex-wrap items-start gap-2.5">
                    <span
                      className={cn(
                        "flex h-9 w-9 flex-none items-center justify-center rounded-lg",
                        item.source === "Learner" ? "bg-secondary-100 text-secondary-900" : "bg-accent-100 text-accent-800",
                      )}
                    >
                      <i className={item.source === "Learner" ? "ri-graduation-cap-line text-[17px]" : "ri-building-2-line text-[17px]"} aria-hidden />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-[12.5px] font-semibold text-foreground-950">{item.author}</p>
                        <span className="rounded bg-background-100 px-1.5 py-0.5 text-[10px] font-medium text-foreground-600">{item.source}</span>
                        <StatusBadge status={item.rag} size="sm" />
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1", STATUS_STYLE[item.status])}>{item.status}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-foreground-500">
                        {item.organisation} · with {item.coach}
                      </p>
                    </div>

                    <div className="flex flex-none items-center gap-2">
                      <span className="flex items-center gap-0.5 text-amber-500" aria-label={`${item.rating} out of 5`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <i key={n} className={n <= item.rating ? "ri-star-fill text-[12px]" : "ri-star-line text-[12px] text-foreground-300"} aria-hidden />
                        ))}
                        <span className="ml-1 text-[11px] font-semibold tabular-nums text-foreground-700">{stars(item.rating)}</span>
                      </span>
                      <span className="hidden text-[10.5px] text-foreground-400 sm:inline">{fmtDate(item.date)}</span>
                    </div>
                  </div>

                  <div className="mt-2 rounded-lg bg-background-100/70 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{item.topic}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-foreground-800">{item.comment}</p>
                  </div>

                  {reply ? (
                    <div className="mt-2 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                      <i className="ri-reply-line mt-0.5 text-[14px] text-emerald-700" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Quality team response</p>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-emerald-900">{reply}</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(isOpen ? null : item.id);
                        setDraft("");
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-background-300 px-2.5 py-1 text-[11px] font-medium text-foreground-700 hover:bg-background-100"
                    >
                      <i className={isOpen ? "ri-close-line text-[13px]" : "ri-reply-line text-[13px]"} aria-hidden />
                      {isOpen ? "Cancel" : reply ? "Edit response" : "Respond"}
                    </button>
                    <span className="text-[10.5px] text-foreground-400">{item.id}</span>
                    <span className="ml-auto flex items-center gap-1 text-[10.5px] text-foreground-500">
                      <StatusDot status={item.rag} className="h-1.5 w-1.5" />
                      sentiment
                    </span>
                  </div>

                  {isOpen ? (
                    <div className="qa-rise mt-2">
                      <label htmlFor={`reply-${item.id}`} className="sr-only">
                        Response
                      </label>
                      <textarea
                        id={`reply-${item.id}`}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value.slice(0, 500))}
                        rows={3}
                        placeholder="Write the quality team response…"
                        className="w-full resize-y rounded-md border border-background-300 bg-background-50 px-2.5 py-2 text-[12px] text-foreground-900 outline-none placeholder:text-foreground-400 focus:border-primary-400"
                      />
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => saveReply(item)}
                          className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md bg-primary-500 px-2.5 py-1.5 text-[11.5px] font-semibold text-background-50 hover:bg-primary-600"
                        >
                          <i className="ri-send-plane-line text-[13px]" aria-hidden />
                          Save response
                        </button>
                        <span className="text-[10.5px] text-foreground-400">{draft.length}/500</span>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
