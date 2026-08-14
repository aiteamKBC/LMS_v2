import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Award, BriefcaseBusiness, CalendarClock, Download, ExternalLink, Eye, FileCheck2, FileText, LoaderCircle, Mail, Pencil, Save, Trash2, Upload, UserRound, X } from "lucide-react";
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
} from "@/features/audit/learner-log-pro-copy/components/ui/table";
import { deleteArchivedContract, deleteArchivedEvidence, getLearnerProfile, renameContract, selectActivityEvidence, setContractArchived, setEvidenceArchived, updateEvidenceDate, updateLearnerProfileFields, uploadContract, type LearnerProfile, type LearnerProfileOverrideFields } from "@/features/audit/learner-log-pro-copy/lib/api";
import { getManualRows, type ManualCategory, type ManualRow } from "@/features/audit/learner-log-pro-copy/lib/manualApi";

export const Route = createFileRoute("/learner/$learnerId")({
  component: LearnerProfilePage,
});

function dateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : "—";
}

function dateInputValue(value?: string | null) {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
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
  domain?: string;
  ksb_codes?: string[];
  knowledge: number | null;
  skill_score: number | null;
  behaviour: number | null;
  maximum: number;
};

type SkillChartPoint = {
  code: string;
  domain: string;
  description: string;
  score: number;
  maximum: number;
  percentage: number;
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

function skillDetails(value: string, domain: string) {
  const legacyDetails = value.match(/\)\s*-\s*(.+)$/)?.[1]?.trim();
  const details = legacyDetails ?? skillDescription(value);
  return details.toLocaleLowerCase() === domain.toLocaleLowerCase() ? "" : details;
}

function skillChartPoints(entries: SkillRadarEntry[], dimension: SkillDimension, prefix: string) {
  return entries.flatMap((entry, index) => {
    const score = entry[dimension];
    if (score == null) return [];
    const codes = (entry.ksb_codes ?? []).filter((code) =>
      new RegExp(`^${prefix}\\d+$`, "i").test(code),
    );
    const displayCodes = codes.length ? codes : [skillCode(entry.skill, prefix, index)];
    const domain = entry.domain?.trim() || skillDescription(entry.skill);
    const maximum = Number.isFinite(entry.maximum) && entry.maximum > 0 ? entry.maximum : 8;
    return [{
      code: displayCodes.join(", "),
      domain,
      description: skillDetails(entry.skill, domain),
      score,
      maximum,
      percentage: Math.min(100, Math.max(0, score / maximum * 100)),
    }];
  });
}

function formatSkillScore(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function skillAverage(points: SkillChartPoint[], key: "score" | "maximum") {
  return points.length
    ? points.reduce((total, point) => total + point[key], 0) / points.length
    : null;
}

function skillRadarTicks(maximum: number) {
  const roundedMaximum = Math.max(1, Math.ceil(maximum));
  const step = roundedMaximum <= 5 ? 1 : Math.ceil(roundedMaximum / 4);
  const ticks = Array.from(
    { length: Math.floor(roundedMaximum / step) + 1 },
    (_, index) => index * step,
  );
  if (ticks.at(-1) !== roundedMaximum) ticks.push(roundedMaximum);
  return ticks;
}

function wrapRadarLabel(value: string, maximumLineLength = 22) {
  return value.split(/\s+/).reduce<string[]>((lines, word) => {
    const last = lines.at(-1);
    if (!last || `${last} ${word}`.length > maximumLineLength) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
    return lines;
  }, []);
}

function SkillRadarAxisTick({ x = 0, y = 0, cx = 0, cy = 0, textAnchor = "middle", payload }: {
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
  textAnchor?: "start" | "middle" | "end" | "inherit";
  payload?: { value?: string };
}) {
  const lines = wrapRadarLabel(String(payload?.value ?? ""));
  const deltaX = x - cx;
  const deltaY = y - cy;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const labelX = x + (deltaX / distance) * 22;
  const labelY = y + (deltaY / distance) * 22;
  return (
    <text x={labelX} y={labelY} textAnchor={textAnchor} fill="#243b4a" fontSize={12} fontWeight={700}>
      {lines.map((line, index) => (
        <tspan
          key={`${line}-${index}`}
          x={labelX}
          dy={index === 0 ? `${-(lines.length - 1) * 0.58}em` : "1.16em"}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

function SkillRadarTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload?: SkillChartPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="max-w-xs rounded-md border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs font-bold text-foreground">{point.code} · {formatSkillScore(point.score)} / {formatSkillScore(point.maximum)}</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-foreground">{point.domain}</p>
      {point.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{point.description}</p>}
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

type EvidenceSelectionTarget = {
  kind: "first" | "last-learning" | "return-to-learning" | "withdrawal";
  title: string;
  evidenceDate: string;
  componentName: string;
};

const ACTIVITY_EVIDENCE_GROUPS: Array<{
  label: string;
  categories: ManualCategory[];
}> = [
  { label: "Attendance", categories: ["attendance"] },
  { label: "LMS activities", categories: ["video", "audio", "reading+quiz"] },
  { label: "Assignments", categories: ["assignment"] },
];

function activityEvidenceOptionLabel(activity: ManualRow) {
  const activityDate = activity.activity_date ?? "No date";
  return `${activityDate} · ${activity.title} · ${activity.month_label}`;
}

type EmployerEditForm = {
  employer_name: string;
  job_title: string;
  employment_start_date: string;
  contracted_hours_per_week: string;
  line_manager_name: string;
  workplace_address: string;
  employer_postcode: string;
  levy_status: string;
};

type BreakEditForm = {
  last_learning_date: string;
  expected_return_date: string;
  return_to_learning_date: string;
  revised_learning_planned_end_date: string;
};

const EMPTY_EMPLOYER_FORM: EmployerEditForm = {
  employer_name: "",
  job_title: "",
  employment_start_date: "",
  contracted_hours_per_week: "",
  line_manager_name: "",
  workplace_address: "",
  employer_postcode: "",
  levy_status: "",
};

function LearnerProfilePage() {
  const { learnerId } = Route.useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showFirstEvidence, setShowFirstEvidence] = useState(false);
  const [previewEvidence, setPreviewEvidence] = useState<EvidenceItem | null>(null);
  const [evidencePreviewUrl, setEvidencePreviewUrl] = useState<string | null>(null);
  const [evidencePreviewError, setEvidencePreviewError] = useState<string | null>(null);
  const [evidenceUploadDate, setEvidenceUploadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [evidenceSelectionTarget, setEvidenceSelectionTarget] = useState<EvidenceSelectionTarget | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState("");
  const [savingSelectedActivity, setSavingSelectedActivity] = useState(false);
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
  const [editingEmployer, setEditingEmployer] = useState(false);
  const [employerForm, setEmployerForm] = useState<EmployerEditForm>(EMPTY_EMPLOYER_FORM);
  const [savingEmployer, setSavingEmployer] = useState(false);
  const [employerActionError, setEmployerActionError] = useState<string | null>(null);
  const [employerActionMessage, setEmployerActionMessage] = useState<string | null>(null);
  const [editingPlannedEnd, setEditingPlannedEnd] = useState(false);
  const [plannedEndValue, setPlannedEndValue] = useState("");
  const [savingPlannedEnd, setSavingPlannedEnd] = useState(false);
  const [plannedEndError, setPlannedEndError] = useState<string | null>(null);
  const [editingStartDate, setEditingStartDate] = useState(false);
  const [startDateValue, setStartDateValue] = useState("");
  const [savingStartDate, setSavingStartDate] = useState(false);
  const [startDateError, setStartDateError] = useState<string | null>(null);
  const [lastLearningEvidenceError, setLastLearningEvidenceError] = useState<string | null>(null);
  const [lastLearningEvidenceMessage, setLastLearningEvidenceMessage] = useState<string | null>(null);
  const [editingWithdrawalEvidenceDate, setEditingWithdrawalEvidenceDate] = useState(false);
  const [withdrawalEvidenceDateValue, setWithdrawalEvidenceDateValue] = useState("");
  const [savingWithdrawalEvidenceDate, setSavingWithdrawalEvidenceDate] = useState(false);
  const [withdrawalEvidenceDateError, setWithdrawalEvidenceDateError] = useState<string | null>(null);
  const [breakEvidenceError, setBreakEvidenceError] = useState<string | null>(null);
  const [breakEvidenceMessage, setBreakEvidenceMessage] = useState<string | null>(null);
  const [editingBreak, setEditingBreak] = useState(false);
  const [breakForm, setBreakForm] = useState<BreakEditForm>({
    last_learning_date: "",
    expected_return_date: "",
    return_to_learning_date: "",
    revised_learning_planned_end_date: "",
  });
  const [savingBreak, setSavingBreak] = useState(false);
  const [breakEditError, setBreakEditError] = useState<string | null>(null);
  const [breakEditMessage, setBreakEditMessage] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ["learner-profile", learnerId],
    queryFn: () => getLearnerProfile(learnerId),
  });
  const monthlyReportActivities = useQuery({
    queryKey: ["monthly-report-evidence-activities", profile.data?.aptem_id],
    queryFn: () => getManualRows(Number(profile.data?.aptem_id)),
    enabled: Boolean(evidenceSelectionTarget && profile.data?.aptem_id),
  });
  const groupedEvidenceActivities = useMemo(() => {
    const activities = [...(monthlyReportActivities.data?.rows ?? [])].sort((left, right) => {
      const leftDate = left.activity_date ?? "9999-12-31";
      const rightDate = right.activity_date ?? "9999-12-31";
      return leftDate.localeCompare(rightDate) || left.title.localeCompare(right.title);
    });
    return ACTIVITY_EVIDENCE_GROUPS.map((group) => ({
      ...group,
      activities: activities.filter((activity) => group.categories.includes(activity.category)),
    })).filter((group) => group.activities.length);
  }, [monthlyReportActivities.data?.rows]);

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

  function openActivityEvidencePicker(target: EvidenceSelectionTarget) {
    if (!target.evidenceDate) return;
    setSelectedActivityId("");
    setEvidenceSelectionTarget(target);
  }

  async function handleActivityEvidenceSelection() {
    if (!profile.data || !evidenceSelectionTarget || !selectedActivityId || savingSelectedActivity) return;
    const selectedActivity = monthlyReportActivities.data?.rows.find(
      (activity) => activity.id === Number(selectedActivityId),
    );
    if (!selectedActivity) return;
    setSavingSelectedActivity(true);
    setEvidenceActionError(null);
    setBreakEvidenceError(null);
    setLastLearningEvidenceError(null);
    try {
      const result = await selectActivityEvidence({
        learnerId: Number(profile.data.aptem_id),
        manualActivityId: selectedActivity.id,
        evidenceDate: evidenceSelectionTarget.evidenceDate,
        componentName: evidenceSelectionTarget.componentName,
      });
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      const message = result.already_selected
        ? `${selectedActivity.title} is already selected as evidence.`
        : `${selectedActivity.title} was selected as evidence.`;
      if (evidenceSelectionTarget.kind === "first") setEvidenceActionMessage(message);
      else if (evidenceSelectionTarget.kind === "return-to-learning") setBreakEvidenceMessage(message);
      else setLastLearningEvidenceMessage(message);
      setEvidenceSelectionTarget(null);
      setSelectedActivityId("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The activity could not be selected as evidence.";
      if (evidenceSelectionTarget.kind === "first") setEvidenceActionError(message);
      else if (evidenceSelectionTarget.kind === "return-to-learning") setBreakEvidenceError(message);
      else setLastLearningEvidenceError(message);
    } finally {
      setSavingSelectedActivity(false);
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

  function beginEmployerEdit() {
    const current = profile.data;
    if (!current) return;
    setEmployerForm({
      employer_name: current.employment?.employer_name ?? "",
      job_title: current.employment?.job_title ?? "",
      employment_start_date: current.employment?.employment_start_date ?? "",
      contracted_hours_per_week: current.employment?.contracted_hours_per_week?.toString() ?? "",
      line_manager_name: current.employment?.line_manager?.name ?? "",
      workplace_address: current.employment?.workplace_address ?? "",
      employer_postcode: current.learning_delivery.employer_postcode ?? "",
      levy_status: current.employment?.levy_status ?? "",
    });
    setEmployerActionError(null);
    setEmployerActionMessage(null);
    setEditingEmployer(true);
  }

  async function handleEmployerSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile.data || savingEmployer) return;
    const currentValues: EmployerEditForm = {
      employer_name: profile.data.employment?.employer_name ?? "",
      job_title: profile.data.employment?.job_title ?? "",
      employment_start_date: profile.data.employment?.employment_start_date ?? "",
      contracted_hours_per_week: profile.data.employment?.contracted_hours_per_week?.toString() ?? "",
      line_manager_name: profile.data.employment?.line_manager?.name ?? "",
      workplace_address: profile.data.employment?.workplace_address ?? "",
      employer_postcode: profile.data.learning_delivery.employer_postcode ?? "",
      levy_status: profile.data.employment?.levy_status ?? "",
    };
    const changedFields = Object.fromEntries(
      Object.entries(employerForm).filter(([field, value]) => value !== currentValues[field as keyof EmployerEditForm]),
    ) as LearnerProfileOverrideFields;
    if (!Object.keys(changedFields).length) {
      setEditingEmployer(false);
      return;
    }
    setSavingEmployer(true);
    setEmployerActionError(null);
    setEmployerActionMessage(null);
    try {
      await updateLearnerProfileFields(Number(profile.data.aptem_id), changedFields);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEditingEmployer(false);
      setEmployerActionMessage("Employer details were updated.");
    } catch (error) {
      setEmployerActionError(error instanceof Error ? error.message : "Employer details could not be updated.");
    } finally {
      setSavingEmployer(false);
    }
  }

  async function handlePlannedEndSave() {
    if (!profile.data || !plannedEndValue || savingPlannedEnd) return;
    setSavingPlannedEnd(true);
    setPlannedEndError(null);
    try {
      await updateLearnerProfileFields(Number(profile.data.aptem_id), { planned_end_date: plannedEndValue });
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEditingPlannedEnd(false);
    } catch (error) {
      setPlannedEndError(error instanceof Error ? error.message : "Planned end date could not be updated.");
    } finally {
      setSavingPlannedEnd(false);
    }
  }

  async function handleStartDateSave() {
    if (!profile.data || !startDateValue || savingStartDate) return;
    setSavingStartDate(true);
    setStartDateError(null);
    try {
      await updateLearnerProfileFields(Number(profile.data.aptem_id), { start_date: startDateValue });
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEditingStartDate(false);
    } catch (error) {
      setStartDateError(error instanceof Error ? error.message : "Start date could not be updated.");
    } finally {
      setSavingStartDate(false);
    }
  }

  async function handleWithdrawalEvidenceDateSave() {
    if (!profile.data || !withdrawalEvidenceDateValue || savingWithdrawalEvidenceDate) return;
    setSavingWithdrawalEvidenceDate(true);
    setWithdrawalEvidenceDateError(null);
    setLastLearningEvidenceMessage(null);
    try {
      await updateLearnerProfileFields(Number(profile.data.aptem_id), {
        last_learning_date: withdrawalEvidenceDateValue,
      });
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEditingWithdrawalEvidenceDate(false);
      setLastLearningEvidenceMessage(`The last date of learning was updated to ${withdrawalEvidenceDateValue}.`);
    } catch (error) {
      setWithdrawalEvidenceDateError(error instanceof Error ? error.message : "The last date of learning could not be updated.");
    } finally {
      setSavingWithdrawalEvidenceDate(false);
    }
  }

  async function handleWithdrawalEvidenceDelete(evidence: EvidenceItem) {
    if (!profile.data || deletingEvidenceId) return;
    if (!window.confirm(`Delete "${evidence.name}" from the withdrawal evidence?`)) return;
    setDeletingEvidenceId(evidence.id);
    setLastLearningEvidenceError(null);
    setLastLearningEvidenceMessage(null);
    try {
      if (!evidence.archived) {
        await setEvidenceArchived(evidence.id, Number(profile.data.aptem_id), true);
      }
      await deleteArchivedEvidence(evidence.id, Number(profile.data.aptem_id));
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setLastLearningEvidenceMessage(`${evidence.name} was removed. You can upload replacement evidence now.`);
    } catch (error) {
      setLastLearningEvidenceError(error instanceof Error ? error.message : "The withdrawal evidence could not be deleted.");
    } finally {
      setDeletingEvidenceId(null);
    }
  }

  function beginBreakEdit() {
    const current = profile.data?.break_in_learning;
    if (!current) return;
    setBreakForm({
      last_learning_date: dateInputValue(current.last_learning_date),
      expected_return_date: dateInputValue(current.expected_return_date),
      return_to_learning_date: dateInputValue(current.return_to_learning_date),
      revised_learning_planned_end_date: dateInputValue(current.revised_learning_planned_end_date),
    });
    setBreakEditError(null);
    setBreakEditMessage(null);
    setEditingBreak(true);
  }

  async function handleBreakSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = profile.data?.break_in_learning;
    if (!profile.data || !current || savingBreak) return;
    const currentValues: BreakEditForm = {
      last_learning_date: dateInputValue(current.last_learning_date),
      expected_return_date: dateInputValue(current.expected_return_date),
      return_to_learning_date: dateInputValue(current.return_to_learning_date),
      revised_learning_planned_end_date: dateInputValue(current.revised_learning_planned_end_date),
    };
    const changedFields = Object.fromEntries(
      Object.entries(breakForm).filter(([field, value]) => value !== currentValues[field as keyof BreakEditForm]),
    ) as LearnerProfileOverrideFields;
    if (!Object.keys(changedFields).length) {
      setEditingBreak(false);
      return;
    }
    setSavingBreak(true);
    setBreakEditError(null);
    setBreakEditMessage(null);
    try {
      await updateLearnerProfileFields(Number(profile.data.aptem_id), changedFields);
      await queryClient.invalidateQueries({ queryKey: ["learner-profile", learnerId] });
      setEditingBreak(false);
      setBreakEditMessage("Break in learning dates were updated.");
    } catch (error) {
      setBreakEditError(error instanceof Error ? error.message : "Break in learning dates could not be updated.");
    } finally {
      setSavingBreak(false);
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
  const activeContractCount = learner.contracts.length - archivedContractCount;
  const employment = learner.employment;
  const isWithdrawn = learner.programme_status.trim().toLowerCase() === "withdrawn";
  const hasBreakInLearning = learner.break_in_learning.has_break_in_learning
    || learner.programme_status.toLowerCase() === "onbreak";
  const lastLearningEvidenceDate = learner.learning_delivery.last_learning_evidence_date
    ?? learner.break_in_learning.last_learning_date;
  const lastLearningEvidenceItems = learner.learning_delivery.last_learning_evidence_items ?? [];
  const breakEvidenceItems = learner.learning_delivery.break_evidence_items ?? [];
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
  const activeSkillAverageScore = skillAverage(activeSkillGroup.points, "score") ?? 0;
  const activeSkillAverageMaximum = skillAverage(activeSkillGroup.points, "maximum") ?? 0;
  const activeSkillChartMaximum = Math.max(
    1,
    ...activeSkillGroup.points.map((point) => point.maximum),
  );
  const activeSkillRadarTicks = skillRadarTicks(activeSkillChartMaximum);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-base text-foreground">OTJ&nbsp;Ledger</span>
            <span className="label-caps">Learner profile</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/journal"
              search={{ learner: String(learner.aptem_id), period: "" }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <FileText className="h-3.5 w-3.5" /> Monthly report
            </Link>
            <button
              type="button"
              onClick={() => {
                // Deep links have no in-tab history to return to.
                if (window.history.length > 1) router.history.back();
                else void router.navigate({ to: "/search" });
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            <Link to="/search" className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground hover:underline">
              Learner search
            </Link>
          </div>
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
              <div>
                <dt className="label-caps">Start date</dt>
                {editingStartDate ? (
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <input type="date" value={startDateValue} onChange={(event) => setStartDateValue(event.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground" />
                    <button type="button" onClick={handleStartDateSave} disabled={!startDateValue || savingStartDate} className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background disabled:opacity-50">
                      {savingStartDate ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                    </button>
                    <button type="button" onClick={() => setEditingStartDate(false)} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold">Cancel</button>
                    {startDateError && <span className="w-full text-xs text-destructive">{startDateError}</span>}
                  </dd>
                ) : (
                  <dd className="mt-1 flex items-center gap-2 font-mono">
                    {dateOnly(learner.learning_delivery.start_date)}
                    {hasBreakInLearning && (
                      <button
                        type="button"
                        aria-label="Edit start date"
                        onClick={() => {
                          setStartDateValue(dateInputValue(learner.learning_delivery.start_date));
                          setStartDateError(null);
                          setEditingStartDate(true);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </dd>
                )}
              </div>
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
              <div>
                <dt className="label-caps">Planned end</dt>
                {editingPlannedEnd ? (
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={plannedEndValue}
                      onChange={(event) => setPlannedEndValue(event.target.value)}
                      className="rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground"
                    />
                    <button type="button" onClick={handlePlannedEndSave} disabled={!plannedEndValue || savingPlannedEnd} className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background disabled:opacity-50">
                      {savingPlannedEnd ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                    </button>
                    <button type="button" onClick={() => setEditingPlannedEnd(false)} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold">Cancel</button>
                    {plannedEndError && <span className="w-full text-xs text-destructive">{plannedEndError}</span>}
                  </dd>
                ) : (
                  <dd className="mt-1 flex items-center gap-2 font-mono">
                    {dateOnly(learner.learning_delivery.planned_end_date)}
                    <button
                      type="button"
                      aria-label="Edit planned end date"
                      onClick={() => {
                        setPlannedEndValue(dateInputValue(learner.learning_delivery.planned_end_date));
                        setPlannedEndError(null);
                        setEditingPlannedEnd(true);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </dd>
                )}
              </div>
              {learner.programme_status.trim().toLowerCase() !== "active" && learner.learning_delivery.actual_end_date && (
                <div>
                  <dt className="label-caps">Actual end</dt>
                  <dd className="mt-1 font-mono">{dateOnly(learner.learning_delivery.actual_end_date)}</dd>
                </div>
              )}
            </dl>
          </div>
        </section>

        {hasBreakInLearning && (
          <section className={`rounded-lg border px-7 py-6 shadow-panel ${learner.break_in_learning.has_return_to_learning ? "border-success/30 bg-success/5" : "border-warning/40 bg-warning/10"}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-full ${learner.break_in_learning.has_return_to_learning ? "bg-success/15 text-success" : "bg-warning/20 text-foreground"}`}><CalendarClock className="h-5 w-5" /></span>
                <div>
                  <h2 className="font-serif text-lg text-foreground">Break in learning</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Break and return dates from the learner's Aptem record.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${learner.break_in_learning.has_return_to_learning ? "bg-success/15 text-success" : "bg-warning/20 text-foreground"}`}>
                  {learner.break_in_learning.has_return_to_learning ? "Returned to learning" : "Currently on break"}
                </span>
                {!editingBreak && (
                  <button type="button" onClick={beginBreakEdit} className="inline-flex items-center gap-1.5 rounded-md border border-current/20 bg-background/70 px-3 py-2 text-xs font-semibold text-foreground hover:bg-background">
                    <Pencil className="h-3.5 w-3.5" /> Edit dates
                  </button>
                )}
              </div>
            </div>
            {breakEditError && <p className="mt-4 text-sm font-medium text-destructive">{breakEditError}</p>}
            {breakEditMessage && <p className="mt-4 text-sm font-medium text-success">{breakEditMessage}</p>}
            {editingBreak ? (
              <form onSubmit={handleBreakSave} className="mt-6 grid gap-4 rounded-md border border-current/15 bg-background/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1.5">
                  <span className="label-caps">Break date</span>
                  <input type="date" value={breakForm.last_learning_date} onChange={(event) => setBreakForm((value) => ({ ...value, last_learning_date: event.target.value }))} className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground" />
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Expected return</span>
                  <input type="date" value={breakForm.expected_return_date} onChange={(event) => setBreakForm((value) => ({ ...value, expected_return_date: event.target.value }))} className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground" />
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Actual return</span>
                  <input type="date" value={breakForm.return_to_learning_date} onChange={(event) => setBreakForm((value) => ({ ...value, return_to_learning_date: event.target.value }))} className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground" />
                  <span className="block text-[11px] text-muted-foreground">Leave blank if the learner has not returned.</span>
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Revised planned end</span>
                  <input type="date" value={breakForm.revised_learning_planned_end_date} onChange={(event) => setBreakForm((value) => ({ ...value, revised_learning_planned_end_date: event.target.value }))} className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground" />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
                  <button type="submit" disabled={savingBreak} className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:opacity-50">
                    {savingBreak ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {savingBreak ? "Saving…" : "Save dates"}
                  </button>
                  <button type="button" disabled={savingBreak} onClick={() => setEditingBreak(false)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-50">
                    <X className="h-4 w-4" /> Cancel
                  </button>
                </div>
              </form>
            ) : (
              <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="label-caps">Break date</dt><dd className="mt-1 font-mono text-sm">{dateOnly(learner.break_in_learning.last_learning_date)}</dd></div>
                <div><dt className="label-caps">Expected return</dt><dd className="mt-1 font-mono text-sm">{dateOnly(learner.break_in_learning.expected_return_date)}</dd></div>
                <div><dt className="label-caps">Actual return</dt><dd className="mt-1 font-mono text-sm">{learner.break_in_learning.has_return_to_learning ? dateOnly(learner.break_in_learning.return_to_learning_date) : "Not returned yet"}</dd></div>
                <div><dt className="label-caps">Revised planned end</dt><dd className="mt-1 font-mono text-sm">{dateOnly(learner.break_in_learning.revised_learning_planned_end_date)}</dd></div>
              </dl>
            )}
            <div className="mt-6 rounded-md border border-current/15 bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Evidence of last date of learning</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Evidence from the last learning day: {dateOnly(lastLearningEvidenceDate)}.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!lastLearningEvidenceDate}
                  onClick={() => openActivityEvidencePicker({
                    kind: "last-learning",
                    title: "Evidence of last date of learning",
                    evidenceDate: dateInputValue(lastLearningEvidenceDate),
                    componentName: "Last date of learning evidence",
                  })}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ListChecks className="h-4 w-4" /> Select evidence
                </button>
              </div>
              {lastLearningEvidenceError && <p className="mt-3 text-xs font-medium text-destructive">{lastLearningEvidenceError}</p>}
              {lastLearningEvidenceMessage && <p className="mt-3 text-xs font-medium text-success">{lastLearningEvidenceMessage}</p>}
              {lastLearningEvidenceItems.length > 0 && (
                <div className="mt-4 space-y-2">
                  {lastLearningEvidenceItems.map((evidence) => (
                    <div key={evidence.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{evidence.name}</p>
                        {editingEvidenceId === evidence.id ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input type="date" value={editingEvidenceDate} onChange={(event) => setEditingEvidenceDate(event.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground" />
                            <button type="button" onClick={() => void handleEvidenceDateSave(evidence)} disabled={!editingEvidenceDate || savingEvidenceDate} className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background disabled:opacity-50">
                              {savingEvidenceDate ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                            </button>
                            <button type="button" onClick={() => setEditingEvidenceId(null)} disabled={savingEvidenceDate} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50">Cancel</button>
                          </div>
                        ) : (
                          <p className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            {dateOnly(evidence.date)}
                            <button type="button" aria-label={`Edit date for ${evidence.name}`} onClick={() => { setEditingEvidenceId(evidence.id); setEditingEvidenceDate(dateInputValue(evidence.date)); setEvidenceActionError(null); }} className="hover:text-foreground">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </p>
                        )}
                      </div>
                      {evidence.file && (
                        <button type="button" onClick={() => setPreviewEvidence(evidence)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                          <Eye className="h-3.5 w-3.5" /> Preview
                        </button>
                      )}
                      {evidence.source_activity_month && (
                        <Link to="/journal" search={{ learner: String(learner.aptem_id), period: evidence.source_activity_month }} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                          <ExternalLink className="h-3.5 w-3.5" /> Monthly report
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {evidenceActionError && <p className="mt-3 text-xs font-medium text-destructive">{evidenceActionError}</p>}
              {evidenceActionMessage && <p className="mt-3 text-xs font-medium text-success">{evidenceActionMessage}</p>}
            </div>
            <div className="mt-4 rounded-md border border-current/15 bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Return to learning evidence</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Evidence from the first return day: {dateOnly(learner.break_in_learning.return_to_learning_date)}.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!learner.break_in_learning.return_to_learning_date}
                  onClick={() => openActivityEvidencePicker({
                    kind: "return-to-learning",
                    title: "Return to learning evidence",
                    evidenceDate: dateInputValue(learner.break_in_learning.return_to_learning_date),
                    componentName: "Return to learning evidence",
                  })}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ListChecks className="h-4 w-4" /> Select evidence
                </button>
              </div>
              {breakEvidenceError && <p className="mt-3 text-xs font-medium text-destructive">{breakEvidenceError}</p>}
              {breakEvidenceMessage && <p className="mt-3 text-xs font-medium text-success">{breakEvidenceMessage}</p>}
              {breakEvidenceItems.length > 0 && (
                <div className="mt-4 space-y-2">
                  {breakEvidenceItems.map((evidence) => (
                    <div key={evidence.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{evidence.name}</p>
                        {editingEvidenceId === evidence.id ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input type="date" value={editingEvidenceDate} onChange={(event) => setEditingEvidenceDate(event.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground" />
                            <button type="button" onClick={() => void handleEvidenceDateSave(evidence)} disabled={!editingEvidenceDate || savingEvidenceDate} className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background disabled:opacity-50">
                              {savingEvidenceDate ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                            </button>
                            <button type="button" onClick={() => setEditingEvidenceId(null)} disabled={savingEvidenceDate} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50">Cancel</button>
                          </div>
                        ) : (
                          <p className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            {dateOnly(evidence.date)}
                            <button type="button" aria-label={`Edit date for ${evidence.name}`} onClick={() => { setEditingEvidenceId(evidence.id); setEditingEvidenceDate(dateInputValue(evidence.date)); setEvidenceActionError(null); }} className="hover:text-foreground">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </p>
                        )}
                      </div>
                      {evidence.file && (
                        <button type="button" onClick={() => setPreviewEvidence(evidence)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                          <Eye className="h-3.5 w-3.5" /> Preview
                        </button>
                      )}
                      {evidence.source_activity_month && (
                        <Link to="/journal" search={{ learner: String(learner.aptem_id), period: evidence.source_activity_month }} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                          <ExternalLink className="h-3.5 w-3.5" /> Monthly report
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {evidenceActionError && <p className="mt-3 text-xs font-medium text-destructive">{evidenceActionError}</p>}
              {evidenceActionMessage && <p className="mt-3 text-xs font-medium text-success">{evidenceActionMessage}</p>}
            </div>
          </section>
        )}

        {isWithdrawn && (
          <section className="rounded-lg border border-destructive/25 bg-destructive/[0.03] p-6 shadow-panel">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <CalendarClock className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-serif text-lg text-foreground">Withdrawal evidence</h2>
                  <p className="mt-1 text-sm text-muted-foreground">The selected last date of learning defaults to the ILR actual end date and can be corrected here.</p>
                </div>
              </div>
              <span className="rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">Withdrawn</span>
            </div>

            <div className="mt-6 rounded-md border border-current/15 bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Evidence of last date of learning</p>
                  {editingWithdrawalEvidenceDate ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={withdrawalEvidenceDateValue}
                        onChange={(event) => setWithdrawalEvidenceDateValue(event.target.value)}
                        className="rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground"
                      />
                      <button type="button" onClick={() => void handleWithdrawalEvidenceDateSave()} disabled={!withdrawalEvidenceDateValue || savingWithdrawalEvidenceDate} className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background disabled:opacity-50">
                        {savingWithdrawalEvidenceDate ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                      </button>
                      <button type="button" onClick={() => setEditingWithdrawalEvidenceDate(false)} disabled={savingWithdrawalEvidenceDate} className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50">Cancel</button>
                    </div>
                  ) : (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      Last date of learning: <span className="font-mono">{dateOnly(lastLearningEvidenceDate)}</span>
                      <button
                        type="button"
                        aria-label="Edit withdrawal last date of learning"
                        onClick={() => {
                          setWithdrawalEvidenceDateValue(dateInputValue(lastLearningEvidenceDate));
                          setWithdrawalEvidenceDateError(null);
                          setEditingWithdrawalEvidenceDate(true);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </p>
                  )}
                  {withdrawalEvidenceDateError && <p className="mt-2 text-xs font-medium text-destructive">{withdrawalEvidenceDateError}</p>}
                </div>
                <button
                  type="button"
                  disabled={!lastLearningEvidenceDate}
                  onClick={() => openActivityEvidencePicker({
                    kind: "withdrawal",
                    title: "Withdrawal evidence",
                    evidenceDate: dateInputValue(lastLearningEvidenceDate),
                    componentName: "Last date of learning evidence",
                  })}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ListChecks className="h-4 w-4" /> Select evidence
                </button>
              </div>
              {lastLearningEvidenceError && <p className="mt-3 text-xs font-medium text-destructive">{lastLearningEvidenceError}</p>}
              {lastLearningEvidenceMessage && <p className="mt-3 text-xs font-medium text-success">{lastLearningEvidenceMessage}</p>}
              {lastLearningEvidenceItems.length > 0 && (
                <div className="mt-4 space-y-2">
                  {lastLearningEvidenceItems.map((evidence) => (
                    <div key={evidence.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{evidence.name}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{dateOnly(evidence.date)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {evidence.file && (
                          <button type="button" onClick={() => setPreviewEvidence(evidence)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                            <Eye className="h-3.5 w-3.5" /> Preview
                          </button>
                        )}
                        {evidence.source_activity_month && (
                          <Link to="/journal" search={{ learner: String(learner.aptem_id), period: evidence.source_activity_month }} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                            <ExternalLink className="h-3.5 w-3.5" /> Monthly report
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleWithdrawalEvidenceDelete(evidence)}
                          disabled={deletingEvidenceId !== null}
                          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
                        >
                          {deletingEvidenceId === evidence.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
            <p className="mt-3 font-mono text-3xl font-semibold text-foreground">{activeContractCount}</p>
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

        <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(24rem,0.55fr)]">
          <div className="rounded-lg border border-border bg-card shadow-panel">
            <header className="border-b border-border px-7 py-5">
              <h2 className="font-serif text-lg text-foreground">Skills radar</h2>
              <p className="mt-1 text-sm text-muted-foreground">Each competency uses the maximum score supplied by Aptem. Select a group to explore its competencies.</p>
            </header>
            {learner.skills_radar.length ? (
              <div className="p-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  {skillGroups.map((group) => {
                    const averageScore = skillAverage(group.points, "score");
                    const averageMaximum = skillAverage(group.points, "maximum");
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
                            {averageScore == null || averageMaximum == null
                              ? "—"
                              : `${formatSkillScore(averageScore)} / ${formatSkillScore(averageMaximum)}`}
                          </span>
                        </span>
                        <span className="mt-1.5 block text-xs text-muted-foreground">{group.points.length} assessed competenc{group.points.length === 1 ? "y" : "ies"}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 grid items-start gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
                  <div className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-3 px-2 pt-1">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{activeSkillGroup.label} profile</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Hover an axis to see the full competency.</p>
                      </div>
                      <span className="rounded-full px-3 py-1 font-mono text-xs font-bold" style={{ color: activeSkillGroup.colour, backgroundColor: activeSkillGroup.softColour }}>
                        Average {formatSkillScore(activeSkillAverageScore)} / {formatSkillScore(activeSkillAverageMaximum)}
                      </span>
                    </div>
                    <div className="h-[34rem] min-h-[30rem] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={activeSkillGroup.points} outerRadius="84%" margin={{ top: 72, right: 96, bottom: 72, left: 96 }}>
                          <PolarGrid stroke="#d9d6cd" />
                          <PolarAngleAxis dataKey="domain" tick={<SkillRadarAxisTick />} />
                          <PolarRadiusAxis angle={90} domain={[0, activeSkillChartMaximum]} ticks={activeSkillRadarTicks} tick={{ fill: "#64748b", fontSize: 10 }} />
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
                    <div className="max-h-[34rem] divide-y divide-border overflow-y-auto">
                      {activeSkillGroup.points.map((point, index) => (
                        <article key={`${point.code}-${index}`} className="px-4 py-3.5 transition-colors hover:bg-secondary/30">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-xs font-semibold leading-5 text-foreground">{point.domain}</p>
                            <span className="shrink-0 font-mono text-sm font-bold" style={{ color: activeSkillGroup.colour }}>{formatSkillScore(point.score)}<span className="text-xs font-normal text-muted-foreground">/{formatSkillScore(point.maximum)}</span></span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                              {point.code.split(", ").map((code) => (
                                <span
                                  key={code}
                                  className="inline-flex min-w-10 items-center justify-center rounded px-2 py-1 text-center font-mono text-[11px] font-bold"
                                  style={{ color: activeSkillGroup.colour, backgroundColor: activeSkillGroup.softColour }}
                                >
                                  {code}
                                </span>
                              ))}
                          </div>
                          {point.description && <p className="mt-2 text-xs leading-5 text-muted-foreground">{point.description}</p>}
                          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full" style={{ width: `${point.percentage}%`, backgroundColor: activeSkillGroup.colour }} />
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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-serif text-lg text-foreground">Employer details</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Source details with saved auditor corrections.</p>
                </div>
                {!editingEmployer && (
                  <button type="button" onClick={beginEmployerEdit} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                )}
              </div>
              {employerActionError && <p className="mt-3 text-sm font-medium text-destructive">{employerActionError}</p>}
              {employerActionMessage && <p className="mt-3 text-sm font-medium text-success">{employerActionMessage}</p>}
            </header>
            {editingEmployer ? (
              <form onSubmit={handleEmployerSave} className="grid gap-4 px-7 py-6 sm:grid-cols-2 xl:grid-cols-1">
                <label className="space-y-1.5">
                  <span className="label-caps">Employer</span>
                  <input value={employerForm.employer_name} onChange={(event) => setEmployerForm((value) => ({ ...value, employer_name: event.target.value }))} maxLength={250} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Job title</span>
                  <input value={employerForm.job_title} onChange={(event) => setEmployerForm((value) => ({ ...value, job_title: event.target.value }))} maxLength={250} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Employment start date</span>
                  <input value={employerForm.employment_start_date} onChange={(event) => setEmployerForm((value) => ({ ...value, employment_start_date: event.target.value }))} maxLength={50} placeholder="DD/MM/YYYY" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Contracted hours per week</span>
                  <input type="number" min="0" max="168" step="0.25" value={employerForm.contracted_hours_per_week} onChange={(event) => setEmployerForm((value) => ({ ...value, contracted_hours_per_week: event.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Line manager</span>
                  <input value={employerForm.line_manager_name} onChange={(event) => setEmployerForm((value) => ({ ...value, line_manager_name: event.target.value }))} maxLength={250} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Employer postcode</span>
                  <input value={employerForm.employer_postcode} onChange={(event) => setEmployerForm((value) => ({ ...value, employer_postcode: event.target.value }))} maxLength={30} className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground" />
                </label>
                <label className="space-y-1.5">
                  <span className="label-caps">Levy status</span>
                  <select value={employerForm.levy_status} onChange={(event) => setEmployerForm((value) => ({ ...value, levy_status: event.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                    <option value="">Not available</option>
                    <option value="Levy">Levy</option>
                    <option value="Non-Levy">Non-Levy</option>
                  </select>
                </label>
                <label className="space-y-1.5 sm:col-span-2 xl:col-span-1">
                  <span className="label-caps">Workplace address</span>
                  <textarea value={employerForm.workplace_address} onChange={(event) => setEmployerForm((value) => ({ ...value, workplace_address: event.target.value }))} maxLength={1000} rows={4} className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground" />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1">
                  <button type="submit" disabled={savingEmployer} className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background disabled:opacity-50">
                    {savingEmployer ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {savingEmployer ? "Saving…" : "Save changes"}
                  </button>
                  <button type="button" disabled={savingEmployer} onClick={() => setEditingEmployer(false)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-50">
                    <X className="h-4 w-4" /> Cancel
                  </button>
                </div>
              </form>
            ) : employment ? (
              <dl className="grid gap-5 px-7 py-6 sm:grid-cols-2 xl:grid-cols-1">
                <div><dt className="label-caps">Employer</dt><dd className="mt-1.5 flex items-center gap-2 text-sm font-semibold"><BriefcaseBusiness className="h-4 w-4" />{employment.employer_name ?? "—"}</dd></div>
                <div><dt className="label-caps">Job title</dt><dd className="mt-1.5 text-sm">{employment.job_title ?? "—"}</dd></div>
                <div><dt className="label-caps">Employment start date</dt><dd className="mt-1.5 text-sm">{employment.employment_start_date ?? "—"}</dd></div>
                <div><dt className="label-caps">Contracted hours per week</dt><dd className="mt-1.5 text-sm">{employment.contracted_hours_per_week == null ? "—" : `${employment.contracted_hours_per_week} h`}</dd></div>
                <div><dt className="label-caps">Line manager</dt><dd className="mt-1.5 text-sm">{employment.line_manager?.name ?? "—"}{employment.line_manager?.job_title ? ` — ${employment.line_manager.job_title}` : ""}</dd></div>
                <div><dt className="label-caps">Workplace address</dt><dd className="mt-1.5 whitespace-pre-line text-sm leading-6">{employment.workplace_address ?? "—"}</dd></div>
                <div><dt className="label-caps">Employer postcode</dt><dd className="mt-1.5 font-mono text-sm">{learner.learning_delivery.employer_postcode ?? "—"}</dd></div>
                <div><dt className="label-caps">Funding type</dt><dd className="mt-1.5 text-sm font-semibold">{employment.levy_status ?? "—"}</dd></div>
              </dl>
            ) : <EmptyState>No employer details were found. Select Edit to add them.</EmptyState>}
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
                    <button
                      type="button"
                      disabled={!evidenceUploadDate}
                      onClick={() => openActivityEvidencePicker({
                        kind: "first",
                        title: "First qualifying evidence",
                        evidenceDate: evidenceUploadDate,
                        componentName: "Selected monthly report activity",
                      })}
                      className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ListChecks className="h-4 w-4" /> Select evidence
                    </button>
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
                    {evidence.source_activity_month && (
                      <Link
                        to="/journal"
                        search={{ learner: String(learner.aptem_id), period: evidence.source_activity_month }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Monthly report
                      </Link>
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

      {evidenceSelectionTarget && (
        <div
          className="fixed inset-0 z-[1350] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingSelectedActivity) {
              setEvidenceSelectionTarget(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-evidence-picker-title"
            className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <p className="label-caps">Select from monthly report</p>
                <h2 id="activity-evidence-picker-title" className="mt-1 font-serif text-xl text-foreground">
                  {evidenceSelectionTarget.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose an existing activity for {evidenceSelectionTarget.evidenceDate}.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close activity evidence selector"
                disabled={savingSelectedActivity}
                onClick={() => setEvidenceSelectionTarget(null)}
                className="rounded-md border border-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="space-y-4 p-6">
              {monthlyReportActivities.isLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-10 text-sm text-muted-foreground">
                  <LoaderCircle className="h-5 w-5 animate-spin" /> Loading monthly report activities…
                </div>
              ) : monthlyReportActivities.error ? (
                <p className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {monthlyReportActivities.error instanceof Error
                    ? monthlyReportActivities.error.message
                    : "The monthly report activities could not be loaded."}
                </p>
              ) : groupedEvidenceActivities.length ? (
                <label className="block text-sm font-semibold text-foreground">
                  Activity
                  <select
                    value={selectedActivityId}
                    onChange={(event) => setSelectedActivityId(event.target.value)}
                    className="mt-2 w-full rounded-md border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="">Select an activity…</option>
                    {groupedEvidenceActivities.map((group) => (
                      <optgroup key={group.label} label={`${group.label} (${group.activities.length})`}>
                        {group.activities.map((activity) => (
                          <option key={activity.id} value={activity.id}>
                            {activityEvidenceOptionLabel(activity)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="rounded-md border border-border bg-background px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-foreground">No saved monthly report activities</p>
                  <p className="mt-1 text-xs text-muted-foreground">Add and save an activity on the monthly report first.</p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <Link
                  to="/journal"
                  search={{ learner: String(profile.data?.aptem_id ?? ""), period: evidenceSelectionTarget.evidenceDate.slice(0, 7) }}
                  className="text-xs font-semibold text-foreground hover:underline"
                >
                  Open monthly report
                </Link>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={savingSelectedActivity}
                    onClick={() => setEvidenceSelectionTarget(null)}
                    className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!selectedActivityId || savingSelectedActivity}
                    onClick={() => void handleActivityEvidenceSelection()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingSelectedActivity
                      ? <LoaderCircle className="h-4 w-4 animate-spin" />
                      : <ListChecks className="h-4 w-4" />}
                    {savingSelectedActivity ? "Saving…" : "Use as evidence"}
                  </button>
                </div>
              </div>
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
