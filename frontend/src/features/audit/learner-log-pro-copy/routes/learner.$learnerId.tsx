import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Award, BriefcaseBusiness, CalendarClock, ExternalLink, Eye, FileCheck2, Mail, UserRound, X } from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/features/audit/learner-log-pro-copy/components/ui/table";
import { getLearnerProfile } from "@/features/audit/learner-log-pro-copy/lib/api";

export const Route = createFileRoute("/learner/$learnerId")({
  component: LearnerProfilePage,
});

function dateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : "—";
}

function statusClass(status: string) {
  const value = status.trim().toLowerCase();
  if (["completed", "verified", "signed"].includes(value)) return "bg-success/10 text-success";
  if (["not started", "unknown"].includes(value)) return "bg-muted text-muted-foreground";
  return "bg-warning/15 text-foreground";
}

function learnerStatusClass(status: string) {
  const value = status.trim().toLowerCase();
  if (value === "active" || value === "completed") return "bg-success/10 text-success";
  if (value === "onbreak") return "bg-warning/20 text-foreground ring-1 ring-warning/40";
  if (value === "withdrawn" || value === "nonstarter") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-7 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

function LearnerProfilePage() {
  const { learnerId } = Route.useParams();
  const [showFirstEvidence, setShowFirstEvidence] = useState(false);
  const profile = useQuery({
    queryKey: ["learner-profile", learnerId],
    queryFn: () => getLearnerProfile(learnerId),
  });

  if (profile.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading learner profile…</div>;
  }

  if (profile.isError || !profile.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="rounded-lg border border-border bg-card p-8 text-center shadow-panel">
          <h1 className="font-serif text-xl text-foreground">Profile unavailable</h1>
          <p className="mt-2 text-sm text-destructive">{profile.error instanceof Error ? profile.error.message : "Could not load this learner."}</p>
          <Link to="/search" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold hover:underline"><ArrowLeft className="h-4 w-4" /> Back to learner search</Link>
        </div>
      </div>
    );
  }

  const learner = profile.data;
  const employment = learner.employment;
  const planPercent = learner.training_plan.total_modules
    ? Math.round((learner.training_plan.completed_modules / learner.training_plan.total_modules) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-base text-foreground">OTJ&nbsp;Ledger</span>
            <span className="label-caps">Learner profile</span>
          </div>
          <Link to="/search" className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Learner search
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1700px] space-y-6 px-6 py-8">
        <section className="rounded-lg border border-border bg-card px-7 py-6 shadow-panel">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-foreground"><UserRound className="h-7 w-7" /></span>
              <div>
                <p className="label-caps">Learner</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h1 className="font-serif text-2xl text-foreground">{learner.name}</h1>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${learnerStatusClass(learner.programme_status)}`}>{learner.programme_status}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{learner.programme}</p>
                {learner.email && <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3.5 w-3.5" />{learner.email}</p>}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm">
              <div><dt className="label-caps">Aptem ID</dt><dd className="mt-1 font-mono">{learner.aptem_id}</dd></div>
              <div><dt className="label-caps">ILR reference</dt><dd className="mt-1 font-mono">{learner.learning_delivery.learner_reference ?? "—"}</dd></div>
              <div>
                <dt className="label-caps">Coach</dt>
                <dd className="mt-1 font-medium">{learner.coach.name ?? "—"}</dd>
                {learner.coach.email && <dd className="mt-0.5 text-xs text-muted-foreground">{learner.coach.email}</dd>}
              </div>
              <div><dt className="label-caps">Start date</dt><dd className="mt-1 font-mono">{dateOnly(learner.learning_delivery.start_date)}</dd></div>
              <div>
                <dt className="label-caps">First evidence</dt>
                <dd className="mt-1">
                  {learner.learning_delivery.first_evidence_date ? (
                    <button
                      type="button"
                      onClick={() => setShowFirstEvidence(true)}
                      className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-foreground hover:underline"
                    >
                      {dateOnly(learner.learning_delivery.first_evidence_date)} <Eye className="h-3.5 w-3.5" />
                    </button>
                  ) : <span className="font-mono">—</span>}
                </dd>
              </div>
              <div><dt className="label-caps">Planned end</dt><dd className="mt-1 font-mono">{dateOnly(learner.learning_delivery.planned_end_date)}</dd></div>
            </dl>
          </div>
        </section>

        {(learner.break_in_learning.has_break_in_learning || learner.programme_status.toLowerCase() === "onbreak") && (
          <section className={`rounded-lg border px-7 py-6 shadow-panel ${learner.break_in_learning.has_return_to_learning ? "border-success/30 bg-success/5" : "border-warning/40 bg-warning/10"}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-full ${learner.break_in_learning.has_return_to_learning ? "bg-success/15 text-success" : "bg-warning/20 text-foreground"}`}><CalendarClock className="h-5 w-5" /></span>
                <div>
                  <h2 className="font-serif text-lg text-foreground">Break in learning</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Break and return dates from the learner's Aptem record.</p>
                </div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${learner.break_in_learning.has_return_to_learning ? "bg-success/15 text-success" : "bg-warning/20 text-foreground"}`}>
                {learner.break_in_learning.has_return_to_learning ? "Returned to learning" : "Currently on break"}
              </span>
            </div>
            <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="label-caps">Break date</dt><dd className="mt-1 font-mono text-sm">{dateOnly(learner.break_in_learning.last_learning_date)}</dd></div>
              <div><dt className="label-caps">Expected return</dt><dd className="mt-1 font-mono text-sm">{dateOnly(learner.break_in_learning.expected_return_date)}</dd></div>
              <div><dt className="label-caps">Actual return</dt><dd className="mt-1 font-mono text-sm">{learner.break_in_learning.has_return_to_learning ? dateOnly(learner.break_in_learning.return_to_learning_date) : "Not returned yet"}</dd></div>
              <div><dt className="label-caps">Revised planned end</dt><dd className="mt-1 font-mono text-sm">{dateOnly(learner.break_in_learning.revised_learning_planned_end_date)}</dd></div>
            </dl>
          </section>
        )}

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <p className="label-caps">ILR planned hours</p>
            <p className="mt-3 font-mono text-3xl font-semibold text-foreground">{learner.planned_hours == null ? "—" : `${learner.planned_hours.toFixed(2)} h`}</p>
            <p className="mt-2 text-xs text-muted-foreground">From Audit.ilr_learning_deliveries</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <p className="label-caps">Training plan progress</p>
            <p className="mt-3 font-mono text-3xl font-semibold text-foreground">{planPercent}%</p>
            <p className="mt-2 text-xs text-muted-foreground">{learner.training_plan.completed_modules} of {learner.training_plan.total_modules} modules completed</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <p className="label-caps">Contracts</p>
            <p className="mt-3 font-mono text-3xl font-semibold text-foreground">{learner.contracts.length}</p>
            <p className="mt-2 text-xs text-muted-foreground">Documents found for this learner</p>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card shadow-panel">
          <header className="border-b border-border px-7 py-5">
            <h2 className="font-serif text-lg text-foreground">Programme understanding</h2>
            <p className="mt-1 text-sm text-muted-foreground">The learner's onboarding responses from the programme application.</p>
          </header>
          {learner.programme_understanding.understanding_programme || learner.programme_understanding.career_development_progression ? (
            <div className="space-y-6 px-7 py-6">
              <div>
                <h3 className="text-sm font-medium text-foreground">What is your understanding of the programme you are applying for?</h3>
                <div className="mt-2 min-h-20 whitespace-pre-wrap rounded-md border border-input bg-background px-4 py-3 text-sm leading-6 text-foreground">
                  {learner.programme_understanding.understanding_programme || "No answer provided."}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">How will this programme help you in your career development / aspirations, and /or with your progression?</h3>
                <div className="mt-2 min-h-20 whitespace-pre-wrap rounded-md border border-input bg-background px-4 py-3 text-sm leading-6 text-foreground">
                  {learner.programme_understanding.career_development_progression || "No answer provided."}
                </div>
              </div>
            </div>
          ) : <EmptyState>No programme understanding responses were found for this learner.</EmptyState>}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-border bg-card shadow-panel">
            <header className="border-b border-border px-7 py-5">
              <h2 className="font-serif text-lg text-foreground">Skills radar</h2>
              <p className="mt-1 text-sm text-muted-foreground">Assessed competency scores, shown out of 8.</p>
            </header>
            {learner.skills_radar.length ? (
              <div className="h-[34rem] px-3 py-5">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={learner.skills_radar} outerRadius="67%">
                    <PolarGrid stroke="#d9d6cd" />
                    <PolarAngleAxis dataKey="skill" tick={{ fill: "#334155", fontSize: 10 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 8]} tickCount={9} tick={{ fill: "#64748b", fontSize: 10 }} />
                    <Tooltip formatter={(value, name) => [`${Number(value).toFixed(0)} / 8`, name]} />
                    <Legend />
                    <Radar name="Knowledge" dataKey="knowledge" stroke="#31505d" fill="#31505d" fillOpacity={0.16} strokeWidth={2} />
                    <Radar name="Skills" dataKey="skill_score" stroke="#16856b" fill="#16856b" fillOpacity={0.12} strokeWidth={2} />
                    <Radar name="Behaviours" dataKey="behaviour" stroke="#c47a16" fill="#c47a16" fillOpacity={0.1} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState>No assessed skills radar scores are available for this learner.</EmptyState>}
          </div>

          <div className="rounded-lg border border-border bg-card shadow-panel">
            <header className="border-b border-border px-7 py-5">
              <h2 className="font-serif text-lg text-foreground">Employer details</h2>
              <p className="mt-1 text-sm text-muted-foreground">Extracted from the learner's CV and training plan documents.</p>
            </header>
            {employment ? (
              <dl className="grid gap-5 px-7 py-6 sm:grid-cols-2 xl:grid-cols-1">
                <div><dt className="label-caps">Employer</dt><dd className="mt-1.5 flex items-center gap-2 text-sm font-semibold"><BriefcaseBusiness className="h-4 w-4" />{employment.employer_name ?? "—"}</dd></div>
                <div><dt className="label-caps">Job title</dt><dd className="mt-1.5 text-sm">{employment.job_title ?? "—"}</dd></div>
                <div><dt className="label-caps">Employment start date</dt><dd className="mt-1.5 text-sm">{employment.employment_start_date ?? "—"}</dd></div>
                <div><dt className="label-caps">Contracted hours per week</dt><dd className="mt-1.5 text-sm">{employment.contracted_hours_per_week == null ? "—" : `${employment.contracted_hours_per_week} h`}</dd></div>
                <div><dt className="label-caps">Line manager</dt><dd className="mt-1.5 text-sm">{employment.line_manager?.name ?? "—"}{employment.line_manager?.job_title ? ` — ${employment.line_manager.job_title}` : ""}</dd></div>
                <div><dt className="label-caps">Workplace address</dt><dd className="mt-1.5 whitespace-pre-line text-sm leading-6">{employment.workplace_address ?? "—"}</dd></div>
              </dl>
            ) : <EmptyState>No employer details were found in the CV evidence.</EmptyState>}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card shadow-panel">
          <header className="border-b border-border px-7 py-5">
            <h2 className="font-serif text-lg text-foreground">Contracts</h2>
            <p className="mt-1 text-sm text-muted-foreground">Contract documents from fetching_evidence.aptem_cv_contracts_probe.</p>
          </header>
          {learner.contracts.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="label-caps pl-7">Document</TableHead>
                  <TableHead className="label-caps">Status</TableHead>
                  <TableHead className="label-caps">Document date</TableHead>
                  <TableHead className="label-caps">Learner signed</TableHead>
                  <TableHead className="label-caps">Fully signed</TableHead>
                  <TableHead className="label-caps pr-7">File</TableHead>
                </TableRow></TableHeader>
                <TableBody>{learner.contracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="pl-7 text-sm font-semibold"><span className="inline-flex items-center gap-2"><FileCheck2 className="h-4 w-4" />{contract.document_name}</span></TableCell>
                    <TableCell><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(contract.status)}`}>{contract.status}</span></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{dateOnly(contract.date)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{dateOnly(contract.learner_signed_date)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{dateOnly(contract.fully_signed_date)}</TableCell>
                    <TableCell className="pr-7 text-xs">{contract.file && /^https?:\/\//i.test(contract.file) ? <a href={contract.file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline">Open <ExternalLink className="h-3.5 w-3.5" /></a> : "—"}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          ) : <EmptyState>No contracts were found for this learner.</EmptyState>}
        </section>

        <section className="rounded-lg border border-border bg-card shadow-panel">
          <header className="border-b border-border px-7 py-5">
            <h2 className="font-serif text-lg text-foreground">Certifications &amp; education from CV</h2>
            <p className="mt-1 text-sm text-muted-foreground">Qualifications extracted from fetching_evidence.aptem_cv_certifications.</p>
          </header>
          {learner.certifications.length ? (
            <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              {learner.certifications.map((certification, index) => (
                <article key={`${certification.name}-${index}`} className="rounded-md border border-border bg-background p-5">
                  <Award className="h-5 w-5 text-foreground" />
                  <h3 className="mt-3 text-sm font-semibold text-foreground">{certification.name}</h3>
                  <p className="mt-2 text-xs text-muted-foreground">{certification.issuer || "Issuer not recorded"}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="label-caps">Issued</dt><dd className="mt-1">{certification.issued_date || "—"}</dd></div>
                    <div><dt className="label-caps">Expires</dt><dd className="mt-1">{certification.expiry_date || "—"}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          ) : <EmptyState>No certifications or education records were found in the CV extraction.</EmptyState>}
        </section>

        <section className="rounded-lg border border-border bg-card shadow-panel">
          <header className="border-b border-border px-7 py-5">
            <h2 className="font-serif text-lg text-foreground">Training plan content</h2>
            <p className="mt-1 text-sm text-muted-foreground">Live content from Audit.learner_match.aptem_training_plan.</p>
          </header>
          {learner.training_plan.months.length ? (
            <div className="divide-y divide-border">
              {learner.training_plan.months.map((month, index) => (
                <details key={`${month.date}-${index}`} className="group px-7 py-4" open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                    <span><span className="text-sm font-semibold text-foreground">{month.month || "Programme month"}</span><span className="ml-3 font-mono text-xs text-muted-foreground">{month.date ?? ""}</span></span>
                    <span className="text-xs text-muted-foreground">{month.modules.length} modules</span>
                  </summary>
                  <div className="mt-4 overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="label-caps">Module</TableHead><TableHead className="label-caps">Type</TableHead><TableHead className="label-caps text-right">Status</TableHead></TableRow></TableHeader>
                      <TableBody>{month.modules.map((module, moduleIndex) => (
                        <TableRow key={`${module.name}-${moduleIndex}`}><TableCell className="text-sm font-medium">{module.name}</TableCell><TableCell className="text-xs text-muted-foreground">{module.type || "—"}</TableCell><TableCell className="text-right"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(module.status)}`}>{module.status}</span></TableCell></TableRow>
                      ))}</TableBody>
                    </Table>
                  </div>
                </details>
              ))}
            </div>
          ) : <EmptyState>No training plan content is available for this learner.</EmptyState>}
        </section>
      </main>

      {showFirstEvidence && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowFirstEvidence(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="first-evidence-title"
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card shadow-2xl"
          >
            <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-border bg-card px-6 py-5">
              <div>
                <p className="label-caps">First qualifying evidence</p>
                <h2 id="first-evidence-title" className="mt-1 font-serif text-xl text-foreground">{learner.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Uploaded on {dateOnly(learner.learning_delivery.first_evidence_date)} after excluding Welcome evidence.</p>
              </div>
              <button type="button" aria-label="Close evidence details" onClick={() => setShowFirstEvidence(false)} className="rounded-md border border-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
            </header>
            <div className="space-y-4 p-6">
              {(learner.learning_delivery.first_evidence_items ?? []).map((evidence) => (
                <article key={evidence.id} className="rounded-md border border-border bg-background p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{evidence.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{evidence.component_name || "Component not recorded"}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(evidence.status)}`}>{evidence.status || "Unknown"}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-4 text-xs">
                    <div><dt className="label-caps">Evidence ID</dt><dd className="mt-1 font-mono">{evidence.id}</dd></div>
                    <div><dt className="label-caps">Type</dt><dd className="mt-1">{evidence.kind || "—"}</dd></div>
                    <div><dt className="label-caps">Created date</dt><dd className="mt-1 font-mono">{dateOnly(evidence.date)}</dd></div>
                  </dl>
                  {evidence.content && <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5 text-foreground">{evidence.content}</p>}
                  {evidence.file && /^https?:\/\//i.test(evidence.file) && (
                    <a href={evidence.file} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground hover:underline">Open evidence <ExternalLink className="h-3.5 w-3.5" /></a>
                  )}
                </article>
              ))}
              {!learner.learning_delivery.first_evidence_items?.length && <EmptyState>The evidence details are unavailable.</EmptyState>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
