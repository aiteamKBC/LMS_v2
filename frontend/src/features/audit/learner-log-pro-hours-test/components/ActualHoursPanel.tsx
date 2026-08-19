// "Validate and Calculate Actual Hours" — scoped to the learner whose journal is
// open and the report month selected above it. There is deliberately no bulk or
// all-learners variant: the server rejects a request without both values, and
// this panel never runs on render, only when an auditor asks for it.
//
// Active vs pending values are visually distinct: a pending proposal never
// replaces the active hours until a DIFFERENT auditor approves it.
//
// Identity: this workspace has no login, so the auditor names themselves and the
// server records that name (X-Audit-Actor -> proposed_by / decided_by) on every
// proposal and decision. A proposal must be decided by a DIFFERENT name, which
// the service and a database CHECK both enforce — that is a workflow control and
// an audit trail, not authentication. Setting ACTUAL_HOURS_IDENTITY_MODE=django
// later switches the same endpoints to real accounts with no UI change.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/features/audit/learner-log-pro-hours-test/components/ui/button";
import {
  decideActualHours,
  formatRate,
  formatSeconds,
  getActualHoursSummary,
  proposeActualHours,
  runActualHoursValidation,
  type ActualHoursRow,
  type AnalyticsBlock,
} from "@/features/audit/learner-log-pro-hours-test/lib/actualHoursApi";

const BAND_LABEL: Record<string, { text: string; tone: string }> = {
  normal: { text: "Normal", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  below_normal: { text: "Below normal", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  long_tail: { text: "Long tail", tone: "bg-orange-50 text-orange-700 border-orange-200" },
  below_minimum: { text: "Under 1 minute", tone: "bg-red-50 text-red-700 border-red-200" },
  excessive: { text: "Excessive", tone: "bg-red-50 text-red-700 border-red-200" },
  unclassifiable: { text: "No media duration", tone: "bg-slate-100 text-slate-600 border-slate-200" },
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`rounded-lg px-4 py-3 ${tone ?? "bg-[#f6f8fb]"}`}>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function AnalyticsCard({ title, block, caption }: { title: string; block: AnalyticsBlock; caption: string }) {
  const sourceAlert = block.source.status === "alert";
  const tailAlert = block.long_tail.status === "above expected level";
  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mb-3 text-[11px] text-muted-foreground">{caption}</p>
      <dl className="space-y-1 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Time Stamped / Input</dt>
          <dd className="font-medium">
            {block.source.timestamped} / {block.source.input}
            <span className="text-muted-foreground"> (expected {block.source.expected_timestamped} / {block.source.expected_input})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Other sources</dt>
          <dd className="font-medium">{block.source.other}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Source exceptions</dt>
          <dd className={`font-semibold ${sourceAlert ? "text-red-600" : "text-emerald-700"}`}>
            {block.source.exception_count} — {formatRate(block.source.exception_rate)} vs {formatRate(block.source.threshold)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Long tail</dt>
          <dd className={`font-semibold ${tailAlert ? "text-orange-600" : "text-emerald-700"}`}>
            {block.long_tail.long_tail}/{block.long_tail.classifiable} — {formatRate(block.long_tail.rate)} vs {formatRate(block.long_tail.threshold)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Unclassifiable</dt>
          <dd className="font-medium">{block.long_tail.unclassifiable}</dd>
        </div>
      </dl>
    </div>
  );
}

function RowCard({
  row, month, aptemId, actor, disabled, onDone,
}: {
  row: ActualHoursRow; month: string; aptemId: number; actor: string;
  disabled: boolean; onDone: () => void;
}) {
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState("");
  const band = BAND_LABEL[row.band] ?? { text: row.band, tone: "bg-slate-100 text-slate-600 border-slate-200" };
  const isInput = row.source_category === "input";
  const mediaMinutes = row.media_duration_seconds ? Math.round(row.media_duration_seconds / 60) : null;

  const propose = useMutation({
    mutationFn: (seconds: number) => proposeActualHours({
      aptemId, month, learnerId: row.learner_id, kind: row.kind, ref: row.ref, seconds, actor,
    }),
    onSuccess: () => { setMinutes(""); setError(""); onDone(); },
    onError: (requestError: unknown) => setError(requestError instanceof Error ? requestError.message : "Proposal failed."),
  });
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      decideActualHours(decision, { revisionId: row.pending_revision!.revision_id, actor }),
    onSuccess: () => { setError(""); onDone(); },
    onError: (requestError: unknown) => setError(requestError instanceof Error ? requestError.message : "Decision failed."),
  });

  // Hint only — the server (and a database CHECK) is what actually stops a
  // proposer approving their own proposal. Named identities are "named:<name>".
  const ownProposal = row.pending_revision?.proposed_by === `named:${actor.trim().toLowerCase()}`;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{row.title || `${row.kind} ${row.ref}`}</p>
          <p className="text-[11px] text-muted-foreground">
            {row.activity_date ?? "no date"}
            {row.start_time && row.end_time ? ` · ${row.start_time}–${row.end_time}` : ""}
            {` · ${row.reporting_method ?? "unknown source"}`}
            {mediaMinutes ? ` · media ${mediaMinutes}m` : ""}
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${band.tone}`}>{band.text}</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-[#f6f8fb] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active actual hours</p>
          <p className="text-sm font-semibold text-foreground">
            {row.active_actual_hours ?? "—"}
            <span className="ml-1 text-[11px] font-normal text-muted-foreground">({formatSeconds(row.observed_seconds)})</span>
          </p>
        </div>
        <div className={`rounded-md px-3 py-2 ${row.pending_revision ? "border border-dashed border-sky-300 bg-sky-50" : "bg-[#f6f8fb]"}`}>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pending proposal</p>
          {row.pending_revision ? (
            <p className="text-sm font-semibold text-sky-800">
              {row.pending_revision.proposed_actual_hours}
              <span className="ml-1 text-[11px] font-normal">({formatSeconds(row.pending_revision.proposed_seconds)})</span>
              <span className="block text-[10px] font-normal text-sky-700">by {row.pending_revision.proposed_by}</span>
            </p>
          ) : <p className="text-sm text-muted-foreground">None</p>}
        </div>
        <div className="rounded-md bg-[#f6f8fb] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected range</p>
          <p className="text-sm text-foreground">
            {row.normal_min_seconds !== null && row.normal_max_seconds !== null
              ? `${formatSeconds(row.normal_min_seconds)} – ${formatSeconds(row.normal_max_seconds)}`
              : "Unavailable"}
          </p>
        </div>
      </div>

      {row.findings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {row.findings.map((finding) => (
            <li key={`${finding.code}-${finding.related_ref ?? ""}`}
                className={`flex items-start gap-2 text-[11px] ${finding.severity === "blocking" ? "text-red-700" : "text-amber-700"}`}>
              {finding.severity === "blocking" ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> : <Info className="mt-0.5 h-3 w-3 shrink-0" />}
              <span><span className="font-mono">{finding.code}</span> — {finding.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isInput && !row.pending_revision && (
          <>
            <input
              type="number"
              min={1}
              step={1}
              value={minutes}
              disabled={disabled}
              onChange={(event) => setMinutes(event.target.value)}
              placeholder={row.permitted_offsets_minutes.length && mediaMinutes
                ? `${row.permitted_offsets_minutes.map((offset) => mediaMinutes + offset).join(" / ")} min`
                : "whole minutes"}
              className="h-8 w-44 rounded-md border border-border bg-card px-2 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || propose.isPending || !minutes}
              onClick={() => {
                const parsed = Number(minutes);
                if (!Number.isFinite(parsed)) { setError("Enter a number of minutes."); return; }
                propose.mutate(Math.round(parsed) * 60);
              }}
            >
              {propose.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Propose value"}
            </Button>
          </>
        )}
        {row.pending_revision && (
          <>
            <Button size="sm" disabled={disabled || decide.isPending || ownProposal}
                    onClick={() => decide.mutate("approve")}
                    title={ownProposal ? "A proposal must be approved by a different auditor" : undefined}>
              {decide.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Approve"}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled || decide.isPending || ownProposal}
                    onClick={() => decide.mutate("reject")}>Reject</Button>
            {ownProposal && <span className="text-[11px] text-muted-foreground">You proposed this — another auditor must review it.</span>}
          </>
        )}
        {row.history.length > 0 && (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">History ({row.history.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {row.history.map((item) => (
                <li key={item.revision_id}>
                  #{item.revision_id} {item.status} — {item.previous_actual_hours ?? "—"} → {item.proposed_actual_hours}
                  {" "}({item.calculation_type}, by {item.proposed_by}
                  {item.decided_by ? `, decided by ${item.decided_by}` : ""})
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

export function ActualHoursPanel({ aptemId, month, learnerName }: {
  aptemId: number | null; month: string; learnerName: string;
}) {
  const queryClient = useQueryClient();
  const [actor, setActor] = useState("");
  const [opened, setOpened] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const scoped = Boolean(aptemId && month);

  // Never auto-runs: the query only fetches once the auditor opens the panel.
  const summary = useQuery({
    queryKey: ["actual-hours-summary", aptemId, month],
    queryFn: () => getActualHoursSummary(aptemId!, month),
    enabled: opened && scoped,
    retry: false,
  });

  const validate = useMutation({
    mutationFn: () => runActualHoursValidation(aptemId!, month, actor),
    onSuccess: (result) => {
      setError("");
      setMessage(`Scanned ${result.summary.records_scanned} records — `
        + `${result.summary.proposals_created} proposal(s) created, `
        + `${result.summary.blocking} blocking, ${result.summary.warnings} warning(s), `
        + `${result.summary.duplicates + result.summary.overlaps} duplicate/overlap, `
        + `${result.summary.findings_resolved} finding(s) resolved.`);
      void queryClient.invalidateQueries({ queryKey: ["actual-hours-summary", aptemId, month] });
    },
    onError: (requestError: unknown) => {
      setMessage("");
      setError(requestError instanceof Error ? requestError.message : "The validation run failed.");
    },
  });

  const rows = useMemo(() => summary.data?.rows ?? [], [summary.data]);
  const needsAttention = useMemo(
    () => rows.filter((row) => row.blocking || row.pending_revision || row.band !== "normal"),
    [rows],
  );

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-sky-600" /> Validate and Calculate Actual Hours
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {scoped
              ? <>Scoped to <span className="font-semibold text-foreground">{learnerName || `learner ${aptemId}`}</span> (Aptem {aptemId}) · <span className="font-semibold text-foreground">{month}</span> only.</>
              : "Choose a learner and a report month first."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            placeholder="Your auditor name"
            className="h-9 w-44 rounded-md border border-border bg-card px-3 text-sm"
          />
          <Button variant="outline" size="sm" disabled={!scoped} onClick={() => setOpened(true)}>
            {opened ? "Refresh review" : "Open review"}
          </Button>
          <Button size="sm" disabled={!scoped || !actor || validate.isPending}
                  onClick={() => { setOpened(true); validate.mutate(); }}>
            {validate.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Validate and calculate"}
          </Button>
        </div>
      </header>

      {!opened ? (
        <p className="px-6 py-5 text-xs text-muted-foreground">
          Nothing runs until you ask for it. Opening the review reads this learner's month;
          “Validate and calculate” records findings and creates pending proposals — it never
          changes an active value.
        </p>
      ) : summary.isLoading ? (
        <p className="px-6 py-5 text-xs text-muted-foreground">Loading the review…</p>
      ) : summary.error ? (
        <p className="px-6 py-5 text-xs text-red-600">
          {summary.error instanceof Error ? summary.error.message : "Could not load the review."}
        </p>
      ) : summary.data ? (
        <div className="space-y-5 px-6 py-5">
          {!summary.data.timestamp_semantics_confirmed && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The stored start/end columns are wall-clock only and their timezone convention is
              unconfirmed, so timestamp-derived proposals are held back and flagged instead.
              Auditor-entered values are unaffected.
            </p>
          )}
          {message && (
            <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />{message}
            </p>
          )}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</p>}

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Records scanned" value={summary.data.counts.records_scanned} />
            <Stat label="Time Stamped" value={summary.data.counts.timestamped} />
            <Stat label="Input needing entry" value={summary.data.counts.input_needing_entry} />
            <Stat label="Pending proposals" value={summary.data.counts.pending_proposals} />
            <Stat label="Blocking" value={summary.data.counts.blocking} tone="bg-red-50" />
            <Stat label="Warnings" value={summary.data.counts.warnings} tone="bg-amber-50" />
            <Stat label="Duplicates / overlaps" value={summary.data.counts.duplicates_and_overlaps} />
            <Stat label="Long tail" value={summary.data.counts.long_tail} />
            <Stat label="Unclassifiable" value={summary.data.counts.unclassifiable} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <AnalyticsCard title="This learner / month" block={summary.data.analytics.scope}
                           caption="Scoped analytics for the report above." />
            <AnalyticsCard title="Whole database (read-only context)" block={summary.data.analytics.global}
                           caption={`Global context only — nothing here is written. ${summary.data.analytics.global_rows_without_learner_scope} eligible row(s) carry no Aptem id and cannot be reached from any learner page.`} />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-foreground">
              Rows needing attention ({needsAttention.length} of {rows.length})
            </p>
            {needsAttention.length === 0 ? (
              <p className="text-xs text-muted-foreground">Every row in this month is within its expected range.</p>
            ) : needsAttention.map((row) => (
              <RowCard
                key={`${row.kind}:${row.ref}`}
                row={row}
                month={month}
                aptemId={aptemId!}
                actor={actor}
                disabled={!actor}
                onDone={() => queryClient.invalidateQueries({ queryKey: ["actual-hours-summary", aptemId, month] })}
              />
            ))}
            <p className="text-[11px] text-muted-foreground">
              Your name is recorded on every proposal and every decision, and a proposal has to be
              decided by a different name — enforced server-side and by a database constraint. Since
              there is no login here, that is a workflow control and an audit trail, not proof of identity.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default ActualHoursPanel;
