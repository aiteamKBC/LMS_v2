import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Award, BriefcaseBusiness, CalendarClock, Download, ExternalLink, Eye, FileCheck2, LoaderCircle, Mail, Pencil, Save, Trash2, Upload, UserRound, X } from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/features/audit/learner-log-pro-manual/components/ui/table";
import { deleteArchivedContract, deleteArchivedEvidence, getLearnerProfile, renameContract, setContractArchived, setEvidenceArchived, updateEvidenceDate, uploadContract, uploadEvidence, type LearnerProfile } from "@/features/audit/learner-log-pro-manual/lib/api";

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

type SkillDimension = "knowledge" | "skill_score" | "behaviour";

type SkillRadarEntry = {
  skill: string;
  knowledge: number | null;
  skill_score: number | null;
  behaviour: number | null;
  maximum: 8;
};

type SkillChartPoint = {
  code: string;
  description: string;
  score: number;
};

const SKILL_DIMENSIONS: Array<{
  key: SkillDimension;
  label: string;
  prefix: string;
  colour: string;
  softColour: string;
}> = [
  { key: "knowledge", label: "Knowledge", prefix: "K", colour: "#31505d", softColour: "#e8eef0" },
  { key: "skill_score", label: "Skills", prefix: "S", colour: "#16856b", softColour: "#e5f3ef" },
  { key: "behaviour", label: "Behaviours", prefix: "B", colour: "#c47a16", softColour: "#fbf0df" },
];

function skillCode(value: string, prefix: string, index: number) {
  return value.match(/(?:^|\s)([KSB]\d+)\s*[:.\-]/i)?.[1]?.toUpperCase() ?? `${prefix}${index + 1}`;
}

function skillDescription(value: string) {
  return value.replace(/^\s*[KSB]\d+\s*[:.\-]\s*/i, "").trim() || value;
}

function skillChartPoints(entries: SkillRadarEntry[], dimension: SkillDimension, prefix: string) {
  return entries.flatMap((entry, index) => {
    const score = entry[dimension];
    if (score == null) return [];
    return [{
      code: skillCode(entry.skill, prefix, index),
      description: skillDescription(entry.skill),
      score,
    }];
  });
}

function SkillRadarTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload?: SkillChartPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="max-w-xs rounded-md border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs font-bold text-foreground">{point.code} · {point.score.toFixed(0)} / 8</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{point.description}</p>
    </div>
  );
}

function downloadFilename(disposition: string | null, fallback: string) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the ordinary filename or document title.
    }
  }
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

type EvidenceItem = NonNullable<LearnerProfile["learning_delivery"]["first_evidence_items"]>[number];

function LearnerProfilePage() {
  const { learnerId } = Route.useParams();
  const queryClient = useQueryClient();
  const [showFirstEvidence, setShowFirstEvidence] = useState(false);
  const [previewEvidence, setPreviewEvidence] = useState<EvidenceItem | null>(null);
  const [evidencePreviewUrl, setEvidencePreviewUrl] = useState<string | null>(null);
  const [evidencePreviewError, setEvidencePreviewError] = useState<string | null>(null);
  const [evidenceUploadDate, setEvidenceUploadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [editingEvidenceDate, setEditingEvidenceDate] = useState("");
  const [savingEvidenceDate, setSavingEvidenceDate] = useState(false);
  const [showArchivedEvidence, setShowArchivedEvidence] = useState(false);
  const [archivingEvidenceId, setArchivingEvidenceId] = useState<string | null>(null);
  const [deletingEvidenceId, setDeletingEvidenceId] = useState<string | null>(null);
  const [evidenceActionError, setEvidenceActionError] = useState<string | null>(null);
  const [evidenceActionMessage, setEvidenceActionMessage] = useState<string | null>(null);
  const [skillDimension, setSkillDimension] = useState<SkillDimension>("knowledge");
  const [previewContract, setPreviewContract] = useState<LearnerProfile["contracts"][number] | null>(null);
  const [contractPreviewUrl, setContractPreviewUrl] = useState<string | null>(null);
  const [contractPreviewError, setContractPreviewError] = useState<string | null>(null);
  const [downloadingContractId, setDownloadingContractId] = useState<string | null>(null);
  const [showArchivedContracts, setShowArchivedContracts] = useState(false);
  const [uploadingContract, setUploadingContract] = useState(false);
  const [archivingContractId, setArchivingContractId] = useState<string | null>(null);
  const [deletingContractId, setDeletingContractId] = useState<string | null>(null);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [editingContractName, setEditingContractName] = useState("");
  const [savingContractName, setSavingContractName] = useState(false);
  const [contractActionError, setContractActionError] = useState<string | null>(null);
  const [contractActionMessage, setContractActionMessage] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ["learner-profile", learnerId],
    queryFn: () => getLearnerProfile(learnerId),
  });

  useEffect(() => {
    const source = previewContract?.file;
    if (!source) {
      setContractPreviewUrl(null);
      setContractPreviewError(null);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setContractPreviewUrl(null);
    setContractPreviewError(null);

    fetch(source, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The document preview could not be loaded.");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setContractPreviewUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setContractPreviewError(error instanceof Error ? error.message : "The document preview could not be loaded.");
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewContract?.file]);

  useEffect(() => {
    const source = previewEvidence?.file;
    if (!source) {
      setEvidencePreviewUrl(null);
      setEvidencePreviewError(null);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setEvidencePreviewUrl(null);
    setEvidencePreviewError(null);

    fetch(source, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "The evidence preview could not be loaded.");
        }
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setEvidencePreviewUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setEvidencePreviewError(error instanceof Error ? error.message : "The evidence preview could not be loaded.");
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewEvidence?.file]);

  async function downloadContract(contract: LearnerProfile["contracts"][number]) {
    if (!contract.file || downloadingContractId) return;
    setDownloadingContractId(contract.id);
    try {
      const separator = contract.file.includes("?") ? "&" : "?";
      const response = await fetch(`${contract.file}${separator}download=1`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("The document could not be downloaded.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadFilename(response.headers.get("Content-Disposition"), contract.document_name);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } finally {
      setDownloadingContractId(null);
    }
  }

  async function handleContractUpload(file: File | undefined) {
    if (!file || !profile.data || uploadingContract) return;
    setUploadingContract(true);
    setContractActionError(null);
    setContractActionMessage(null);
    try {
      await uploadContract(Number(profile.data.aptem_id), file);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setContractActionMessage(`${file.name} was uploaded successfully.`);
    } catch (error) {
      setContractActionError(error instanceof Error ? error.message : "The document could not be uploaded.");
    } finally {
      setUploadingContract(false);
    }
  }

  async function handleContractArchive(contract: LearnerProfile["contracts"][number]) {
    if (archivingContractId) return;
    setArchivingContractId(contract.id);
    setContractActionError(null);
    setContractActionMessage(null);
    try {
      await setContractArchived(contract.id, !contract.archived);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setContractActionMessage(
        contract.archived
          ? `${contract.document_name} was restored.`
          : `${contract.document_name} was archived.`,
      );
    } catch (error) {
      setContractActionError(error instanceof Error ? error.message : "The document could not be updated.");
    } finally {
      setArchivingContractId(null);
    }
  }

  async function handleContractDelete(contract: LearnerProfile["contracts"][number]) {
    if (!contract.archived || deletingContractId) return;
    const confirmed = window.confirm(
      `Delete "${contract.document_name}" from this learner's contract list? This action is restricted to archived documents.`,
    );
    if (!confirmed) return;
    setDeletingContractId(contract.id);
    setContractActionError(null);
    setContractActionMessage(null);
    try {
      await deleteArchivedContract(contract.id);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setContractActionMessage(`${contract.document_name} was deleted.`);
    } catch (error) {
      setContractActionError(error instanceof Error ? error.message : "The document could not be deleted.");
    } finally {
      setDeletingContractId(null);
    }
  }

  async function handleContractRename(contract: LearnerProfile["contracts"][number]) {
    const nextName = editingContractName.trim();
    if (!nextName || savingContractName) return;
    setSavingContractName(true);
    setContractActionError(null);
    setContractActionMessage(null);
    try {
      await renameContract(contract.id, nextName);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEditingContractId(null);
      setContractActionMessage(`The document was renamed to ${nextName}.`);
    } catch (error) {
      setContractActionError(error instanceof Error ? error.message : "The document could not be renamed.");
    } finally {
      setSavingContractName(false);
    }
  }

  async function handleEvidenceUpload(file: File | undefined) {
    if (!file || !profile.data || uploadingEvidence || !evidenceUploadDate) return;
    setUploadingEvidence(true);
    setEvidenceActionError(null);
    setEvidenceActionMessage(null);
    try {
      await uploadEvidence(Number(profile.data.aptem_id), file, evidenceUploadDate);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEvidenceActionMessage(`${file.name} was uploaded to Azure.`);
    } catch (error) {
      setEvidenceActionError(error instanceof Error ? error.message : "The evidence could not be uploaded.");
    } finally {
      setUploadingEvidence(false);
    }
  }

  async function handleEvidenceDateSave(evidence: EvidenceItem) {
    if (!editingEvidenceDate || savingEvidenceDate) return;
    setSavingEvidenceDate(true);
    setEvidenceActionError(null);
    setEvidenceActionMessage(null);
    try {
      await updateEvidenceDate(evidence.id, Number(profile.data?.aptem_id), editingEvidenceDate);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEditingEvidenceId(null);
      setEvidenceActionMessage(`The date for ${evidence.name} was updated.`);
    } catch (error) {
      setEvidenceActionError(error instanceof Error ? error.message : "The evidence date could not be updated.");
    } finally {
      setSavingEvidenceDate(false);
    }
  }

  async function handleEvidenceArchive(evidence: EvidenceItem) {
    if (archivingEvidenceId) return;
    setArchivingEvidenceId(evidence.id);
    setEvidenceActionError(null);
    setEvidenceActionMessage(null);
    try {
      await setEvidenceArchived(evidence.id, Number(profile.data?.aptem_id), !evidence.archived);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEvidenceActionMessage(evidence.archived ? `${evidence.name} was restored.` : `${evidence.name} was archived.`);
    } catch (error) {
      setEvidenceActionError(error instanceof Error ? error.message : "The evidence archive state could not be updated.");
    } finally {
      setArchivingEvidenceId(null);
    }
  }

  async function handleEvidenceDelete(evidence: EvidenceItem) {
    if (!evidence.archived || deletingEvidenceId) return;
    if (!window.confirm(`Delete "${evidence.name}" from the evidence archive?`)) return;
    setDeletingEvidenceId(evidence.id);
    setEvidenceActionError(null);
    setEvidenceActionMessage(null);
    try {
      await deleteArchivedEvidence(evidence.id, Number(profile.data?.aptem_id));
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEvidenceActionMessage(`${evidence.name} was deleted.`);
    } catch (error) {
      setEvidenceActionError(error instanceof Error ? error.message : "The evidence could not be deleted.");
    } finally {
      setDeletingEvidenceId(null);
    }
  }

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
  const archivedEvidenceItems = learner.learning_delivery.archived_evidence_items ?? [];
  const evidenceItems = showArchivedEvidence
    ? archivedEvidenceItems
    : learner.learning_delivery.first_evidence_items ?? [];
  const visibleContracts = showArchivedContracts
    ? learner.contracts
    : learner.contracts.filter((contract) => !contract.archived);
  const archivedContractCount = learner.contracts.filter((contract) => contract.archived).length;
  const employment = learner.employment;
  const planPercent = learner.training_plan.total_modules
    ? Math.round((learner.training_plan.completed_modules / learner.training_plan.total_modules) * 100)
    : 0;
  const skillGroups = SKILL_DIMENSIONS.map((dimension) => ({
    ...dimension,
    points: skillChartPoints(learner.skills_radar, dimension.key, dimension.prefix),
  }));
  const activeSkillGroup = skillGroups.find((group) => group.key === skillDimension && group.points.length)
    ?? skillGroups.find((group) => group.points.length)
    ?? skillGroups[0];
  const activeSkillAverage = activeSkillGroup.points.length
    ? activeSkillGroup.points.reduce((total, point) => total + point.score, 0) / activeSkillGroup.points.length
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
              <div>
                <dt className="label-caps">Learner address</dt>
                <dd className="mt-1 max-w-64 text-sm">{learner.learning_delivery.learner_address ?? "—"}</dd>
              </div>
              <div>
                <dt className="label-caps">Learner postcode</dt>
                <dd className="mt-1 font-mono">{learner.learning_delivery.learner_postcode ?? "—"}</dd>
              </div>
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
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowFirstEvidence(true)}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:underline"
                    >
                      Add evidence <Upload className="h-3.5 w-3.5" />
                    </button>
                  )}
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
              <p className="mt-1 text-sm text-muted-foreground">Assessed competency scores out of 8. Select a group to explore its competencies.</p>
            </header>
            {learner.skills_radar.length ? (
              <div className="p-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  {skillGroups.map((group) => {
                    const average = group.points.length
                      ? group.points.reduce((total, point) => total + point.score, 0) / group.points.length
                      : null;
                    const selected = activeSkillGroup.key === group.key;
                    return (
                      <button
                        key={group.key}
                        type="button"
                        disabled={!group.points.length}
                        onClick={() => setSkillDimension(group.key)}
                        className={`rounded-md border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "border-foreground/20 shadow-sm" : "border-border bg-background hover:bg-secondary"}`}
                        style={selected ? { backgroundColor: group.softColour } : undefined}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.colour }} />
                            {group.label}
                          </span>
                          <span className="font-mono text-sm font-bold" style={{ color: group.colour }}>
                            {average == null ? "—" : average.toFixed(1)}
                          </span>
                        </span>
                        <span className="mt-1.5 block text-xs text-muted-foreground">{group.points.length} assessed competenc{group.points.length === 1 ? "y" : "ies"}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
                  <div className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-3 px-2 pt-1">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{activeSkillGroup.label} profile</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Hover an axis to see the full competency.</p>
                      </div>
                      <span className="rounded-full px-3 py-1 font-mono text-xs font-bold" style={{ color: activeSkillGroup.colour, backgroundColor: activeSkillGroup.softColour }}>
                        Average {activeSkillAverage.toFixed(1)} / 8
                      </span>
                    </div>
                    <div className="h-[29rem] min-h-[24rem] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={activeSkillGroup.points} outerRadius="72%" margin={{ top: 24, right: 30, bottom: 24, left: 30 }}>
                          <PolarGrid stroke="#d9d6cd" />
                          <PolarAngleAxis dataKey="code" tick={{ fill: "#334155", fontSize: 11, fontWeight: 700 }} />
                          <PolarRadiusAxis angle={90} domain={[0, 8]} tickCount={5} tick={{ fill: "#64748b", fontSize: 10 }} />
                          <Tooltip content={<SkillRadarTooltip />} />
                          <Radar name={activeSkillGroup.label} dataKey="score" stroke={activeSkillGroup.colour} fill={activeSkillGroup.colour} fillOpacity={0.18} strokeWidth={2.5} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-md border border-border bg-background">
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">Competency scores</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Full descriptions for the selected group.</p>
                    </div>
                    <div className="max-h-[32.5rem] divide-y divide-border overflow-y-auto">
                      {activeSkillGroup.points.map((point, index) => (
                        <article key={`${point.code}-${index}`} className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 min-w-10 rounded px-2 py-1 text-center font-mono text-xs font-bold" style={{ color: activeSkillGroup.colour, backgroundColor: activeSkillGroup.softColour }}>{point.code}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-xs leading-5 text-foreground">{point.description}</p>
                                <span className="shrink-0 font-mono text-sm font-bold" style={{ color: activeSkillGroup.colour }}>{point.score.toFixed(0)}<span className="text-xs font-normal text-muted-foreground">/8</span></span>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, point.score / 8 * 100))}%`, backgroundColor: activeSkillGroup.colour }} />
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
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
                <div><dt className="label-caps">Employer postcode</dt><dd className="mt-1.5 font-mono text-sm">{learner.learning_delivery.employer_postcode ?? "—"}</dd></div>
              </dl>
            ) : <EmptyState>No employer details were found in the CV evidence.</EmptyState>}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card shadow-panel">
          <header className="border-b border-border px-7 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-lg text-foreground">Contracts</h2>
                <p className="mt-1 text-sm text-muted-foreground">Contract documents from fetching_evidence.aptem_cv_contracts_probe.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowArchivedContracts((value) => !value)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary"
                >
                  {showArchivedContracts
                    ? <ArchiveRestore className="h-4 w-4" />
                    : <Archive className="h-4 w-4" />}
                  {showArchivedContracts ? "Hide archived" : `Show archived (${archivedContractCount})`}
                </button>
                <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90 ${uploadingContract ? "pointer-events-none opacity-60" : ""}`}>
                  {uploadingContract
                    ? <LoaderCircle className="h-4 w-4 animate-spin" />
                    : <Upload className="h-4 w-4" />}
                  {uploadingContract ? "Uploading…" : "Upload document"}
                  <input
                    type="file"
                    className="sr-only"
                    disabled={uploadingContract}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void handleContractUpload(file);
                    }}
                  />
                </label>
              </div>
            </div>
            {contractActionError && <p className="mt-3 text-sm font-medium text-destructive">{contractActionError}</p>}
            {contractActionMessage && <p className="mt-3 text-sm font-medium text-success">{contractActionMessage}</p>}
          </header>
          {visibleContracts.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="label-caps pl-7">Document</TableHead>
                  <TableHead className="label-caps pr-7">
                    <div className="flex items-center justify-end gap-2">
                      <span aria-hidden="true" className="w-[92px]" />
                      <span className="w-[104px] text-center">Actions</span>
                      <span aria-hidden="true" className="w-[90px]" />
                    </div>
                  </TableHead>
                </TableRow></TableHeader>
                <TableBody>{visibleContracts.map((contract) => (
                  <TableRow key={contract.id} className={contract.archived ? "opacity-65" : undefined}>
                    <TableCell className="pl-7 text-sm font-semibold">
                      {editingContractId === contract.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <FileCheck2 className="h-4 w-4 shrink-0" />
                          <input
                            type="text"
                            value={editingContractName}
                            maxLength={180}
                            autoFocus
                            onChange={(event) => setEditingContractName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void handleContractRename(contract);
                              if (event.key === "Escape") setEditingContractId(null);
                            }}
                            className="min-w-64 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground"
                          />
                          <button
                            type="button"
                            onClick={() => void handleContractRename(contract)}
                            disabled={savingContractName || !editingContractName.trim()}
                            className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-2 text-xs font-semibold text-background disabled:opacity-60"
                          >
                            {savingContractName ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                          </button>
                          <button type="button" onClick={() => setEditingContractId(null)} className="px-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <FileCheck2 className="h-4 w-4" />{contract.document_name}
                          <button
                            type="button"
                            aria-label={`Rename ${contract.document_name}`}
                            onClick={() => {
                              setEditingContractId(contract.id);
                              setEditingContractName(contract.document_name);
                              setContractActionError(null);
                              setContractActionMessage(null);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {contract.archived && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Archived</span>}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-7 text-xs">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {contract.file && (
                          <>
                          <button
                            type="button"
                            onClick={() => setPreviewContract(contract)}
                            className="inline-flex w-[92px] items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 font-semibold text-foreground hover:bg-secondary"
                          >
                            <Eye className="h-3.5 w-3.5" /> Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => void downloadContract(contract)}
                            disabled={downloadingContractId !== null}
                            className="inline-flex w-[104px] items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 font-semibold text-background hover:opacity-90"
                          >
                            {downloadingContractId === contract.id
                              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                              : <Download className="h-3.5 w-3.5" />}
                            Download
                          </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleContractArchive(contract)}
                          disabled={archivingContractId !== null}
                          className="inline-flex w-[90px] items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
                        >
                          {archivingContractId === contract.id
                            ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            : contract.archived
                              ? <ArchiveRestore className="h-3.5 w-3.5" />
                              : <Archive className="h-3.5 w-3.5" />}
                          {contract.archived ? "Restore" : "Archive"}
                        </button>
                        {contract.archived && (
                          <button
                            type="button"
                            onClick={() => void handleContractDelete(contract)}
                            disabled={deletingContractId !== null}
                            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
                          >
                            {deletingContractId === contract.id
                              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                            Delete
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          ) : <EmptyState>{archivedContractCount && !showArchivedContracts ? "All contract documents are archived." : "No contracts were found for this learner."}</EmptyState>}
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
                        <TableRow key={`${module.name}-${moduleIndex}`}>
                          <TableCell className="text-sm font-medium">
                            <p>{module.name}</p>
                            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs font-normal text-muted-foreground sm:grid-cols-2">
                              {Object.entries({
                                ...Object.fromEntries(Object.entries(module.raw ?? {}).filter(([key]) => !["module", "components"].includes(key))),
                                ...Object.fromEntries(Object.entries(module.components ?? {}).filter(([key]) => !["type", "status"].includes(key))),
                              }).filter(([, value]) => value != null && value !== "").map(([key, value]) => (
                                <div key={key} className="flex gap-1.5">
                                  <dt className="font-semibold text-foreground/70">{key.replace(/_/g, " ")}:</dt>
                                  <dd className="break-all">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
                                </div>
                              ))}
                            </dl>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{module.type || "—"}</TableCell>
                          <TableCell className="text-right"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(module.status)}`}>{module.status}</span></TableCell>
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                  </div>
                </details>
              ))}
            </div>
          ) : <EmptyState>No training plan content is available for this learner.</EmptyState>}
        </section>
      </main>

      {previewContract?.file && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewContract(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="contract-preview-title"
            className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
          >
            <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-4">
              <div className="min-w-0">
                <p className="label-caps">Document preview</p>
                <h2 id="contract-preview-title" className="mt-1 truncate font-serif text-lg text-foreground">{previewContract.document_name}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void downloadContract(previewContract)}
                  disabled={downloadingContractId !== null}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90"
                >
                  {downloadingContractId === previewContract.id
                    ? <LoaderCircle className="h-4 w-4 animate-spin" />
                    : <Download className="h-4 w-4" />}
                  Download
                </button>
                <button
                  type="button"
                  aria-label="Close document preview"
                  onClick={() => setPreviewContract(null)}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="relative min-h-0 flex-1 bg-slate-800 p-2">
              {!contractPreviewUrl && !contractPreviewError && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold text-white">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> Loading preview…
                </div>
              )}
              {contractPreviewError && (
                <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm font-semibold text-white">
                  {contractPreviewError}
                </div>
              )}
              {contractPreviewUrl && (
                <iframe
                  src={contractPreviewUrl}
                  title={`${previewContract.document_name} preview`}
                  className="h-full w-full rounded bg-white"
                />
              )}
            </div>
          </section>
        </div>
      )}

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
                <p className="label-caps">{showArchivedEvidence ? "Evidence archive" : "First qualifying evidence"}</p>
                <h2 id="first-evidence-title" className="mt-1 font-serif text-xl text-foreground">{learner.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {showArchivedEvidence
                    ? `${archivedEvidenceItems.length} archived evidence document${archivedEvidenceItems.length === 1 ? "" : "s"}.`
                    : `Uploaded on ${dateOnly(learner.learning_delivery.first_evidence_date)} after excluding Welcome evidence.`}
                </p>
              </div>
              <button type="button" aria-label="Close evidence details" onClick={() => setShowFirstEvidence(false)} className="rounded-md border border-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
            </header>
            <div className="space-y-4 p-6">
              <div className="rounded-md border border-border bg-secondary/30 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="text-xs font-semibold text-foreground">
                    <span className="label-caps mb-1 block">Evidence date</span>
                    <input
                      type="date"
                      value={evidenceUploadDate}
                      onChange={(event) => setEvidenceUploadDate(event.target.value)}
                      className="rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowArchivedEvidence((value) => !value)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary"
                    >
                      {showArchivedEvidence ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      {showArchivedEvidence ? "Back to current" : `Show archived (${archivedEvidenceItems.length})`}
                    </button>
                    <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90 ${uploadingEvidence ? "pointer-events-none opacity-60" : ""}`}>
                      {uploadingEvidence
                        ? <LoaderCircle className="h-4 w-4 animate-spin" />
                        : <Upload className="h-4 w-4" />}
                      {uploadingEvidence ? "Uploading…" : "Upload evidence"}
                      <input
                        type="file"
                        className="sr-only"
                        disabled={uploadingEvidence || !evidenceUploadDate}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          void handleEvidenceUpload(file);
                        }}
                      />
                    </label>
                  </div>
                </div>
                {evidenceActionError && <p className="mt-3 text-xs font-medium text-destructive">{evidenceActionError}</p>}
                {evidenceActionMessage && <p className="mt-3 text-xs font-medium text-success">{evidenceActionMessage}</p>}
              </div>
              {evidenceItems.map((evidence) => (
                <article key={evidence.id} className="rounded-md border border-border bg-background p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{evidence.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{evidence.component_name || "Component not recorded"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {evidence.archived && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">Archived</span>}
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(evidence.status)}`}>{evidence.status || "Unknown"}</span>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-4 text-xs">
                    <div><dt className="label-caps">Evidence ID</dt><dd className="mt-1 font-mono">{evidence.id}</dd></div>
                    <div><dt className="label-caps">Type</dt><dd className="mt-1">{evidence.kind || "—"}</dd></div>
                    <div>
                      <dt className="label-caps">Created date</dt>
                      {editingEvidenceId === evidence.id ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <input
                            type="date"
                            value={editingEvidenceDate}
                            onChange={(event) => setEditingEvidenceDate(event.target.value)}
                            className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground"
                          />
                          <button
                            type="button"
                            onClick={() => void handleEvidenceDateSave(evidence)}
                            disabled={savingEvidenceDate || !editingEvidenceDate}
                            className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 font-semibold text-background disabled:opacity-60"
                          >
                            {savingEvidenceDate ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                          </button>
                          <button type="button" onClick={() => setEditingEvidenceId(null)} className="px-2 py-1.5 font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center gap-2">
                          <dd className="font-mono">{dateOnly(evidence.date)}</dd>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEvidenceId(evidence.id);
                              setEditingEvidenceDate(dateOnly(evidence.date));
                              setEvidenceActionError(null);
                              setEvidenceActionMessage(null);
                            }}
                            className="inline-flex items-center gap-1 font-semibold text-foreground hover:underline"
                          >
                            <Pencil className="h-3 w-3" /> Edit date
                          </button>
                        </div>
                      )}
                    </div>
                  </dl>
                  {evidence.content && <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5 text-foreground">{evidence.content}</p>}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {evidence.file && (
                      <button
                        type="button"
                        onClick={() => setPreviewEvidence(evidence)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary"
                      >
                        <Eye className="h-3.5 w-3.5" /> Preview evidence
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleEvidenceArchive(evidence)}
                      disabled={archivingEvidenceId !== null}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
                    >
                      {archivingEvidenceId === evidence.id
                        ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        : evidence.archived
                          ? <ArchiveRestore className="h-3.5 w-3.5" />
                          : <Archive className="h-3.5 w-3.5" />}
                      {evidence.archived ? "Restore" : "Archive"}
                    </button>
                    {evidence.archived && (
                      <button
                        type="button"
                        onClick={() => void handleEvidenceDelete(evidence)}
                        disabled={deletingEvidenceId !== null}
                        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
                      >
                        {deletingEvidenceId === evidence.id
                          ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                        Delete
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!evidenceItems.length && <EmptyState>{showArchivedEvidence ? "No archived evidence documents." : "No qualifying evidence document is available yet."}</EmptyState>}
            </div>
          </section>
        </div>
      )}

      {previewEvidence?.file && (
        <div
          className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewEvidence(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-preview-title"
            className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
          >
            <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-4">
              <div className="min-w-0">
                <p className="label-caps">Evidence preview</p>
                <h2 id="evidence-preview-title" className="mt-1 truncate font-serif text-lg text-foreground">{previewEvidence.name}</h2>
                <p className="mt-1 font-mono text-xs text-muted-foreground">Evidence ID {previewEvidence.id}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={previewEvidence.file}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary"
                >
                  <ExternalLink className="h-4 w-4" /> Open in new tab
                </a>
                <button
                  type="button"
                  aria-label="Close evidence preview"
                  onClick={() => setPreviewEvidence(null)}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="relative min-h-0 flex-1 bg-slate-800 p-2">
              {!evidencePreviewUrl && !evidencePreviewError && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold text-white">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> Loading preview…
                </div>
              )}
              {evidencePreviewError && (
                <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm font-semibold text-white">
                  {evidencePreviewError}
                </div>
              )}
              {evidencePreviewUrl && (
                <iframe
                  src={evidencePreviewUrl}
                  title={`${previewEvidence.name} preview`}
                  className="h-full w-full rounded bg-white"
                />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
