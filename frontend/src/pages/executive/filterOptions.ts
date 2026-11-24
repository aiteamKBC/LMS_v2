import type { DashboardFilters, FormDefinition, QualityRecord } from "@/types/qms";
import type { LiveQmsData } from "./qualityData";

const ALL = {
  category: "All form categories",
  formType: "All form types",
  feedbackType: "All feedback types",
  respondentType: "All feedback types",
} as const;

/**
 * Options for the dependent filters (form type, feedback type, respondent) narrowed
 * by the filters above them, so every option on offer can return results.
 */
export function filterOptions(data: LiveQmsData, filters: DashboardFilters) {
  const inCategory = (item: { category: string }) => filters.category === ALL.category || item.category === filters.category;
  const byFeedback = (item: { feedbackType?: string | null }) => filters.feedbackType === ALL.feedbackType || item.feedbackType === filters.feedbackType;
  const byRespondent = (item: { respondentType: string }) => filters.respondentType === ALL.respondentType || item.respondentType === filters.respondentType;
  const feedbackTypeIds = new Set(
    data.forms.filter(form => inCategory(form) && byRespondent(form)).map(form => form.feedbackType).filter(Boolean),
  );
  return {
    formTypes: data.forms
      .filter((form: FormDefinition) => inCategory(form) && byFeedback(form) && byRespondent(form))
      .map(form => ({ id: form.id, name: form.shortName })),
    feedbackTypes: data.feedbackTypes.filter(type => feedbackTypeIds.has(type.id)),
    respondentTypes: Array.from(new Set(
      data.records.filter((record: QualityRecord) => inCategory(record) && byFeedback(record)).map(record => record.respondentType),
    )),
  };
}

/** Clears a dependent filter whose value the other filters have ruled out. */
export function keepConsistent(data: LiveQmsData | null, filters: DashboardFilters): DashboardFilters {
  if (!data) return filters;
  let next = filters;
  for (let pass = 0; pass < 3; pass += 1) {
    const options = filterOptions(data, next);
    const patch: Partial<DashboardFilters> = {};
    if (next.feedbackType !== ALL.feedbackType && !options.feedbackTypes.some(type => type.id === next.feedbackType)) patch.feedbackType = ALL.feedbackType;
    if (next.respondentType !== ALL.respondentType && !options.respondentTypes.some(type => type === next.respondentType)) patch.respondentType = ALL.respondentType;
    if (next.formType !== ALL.formType && !options.formTypes.some(form => form.id === next.formType)) patch.formType = ALL.formType;
    if (!Object.keys(patch).length) break;
    next = { ...next, ...patch };
  }
  return next;
}
