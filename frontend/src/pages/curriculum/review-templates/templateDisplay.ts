import { formatSystemTimestamp } from '@/lib/format';
import type { MigratedDefinition, MigratedField, MigratedTemplate } from '@/api/migratedReviewTemplates';

export const templateKind = (template: MigratedTemplate) => template.scope === 'GLOBAL' ? 'Standard' : 'Custom';
export const updatedLabel = (template: MigratedTemplate) => formatSystemTimestamp(template.updated_at, { day: '2-digit', month: 'short', year: 'numeric' });

function questionCount(fields: MigratedField[]): number {
  return fields.reduce((total, field) => total + (field.aptemType === 11 ? 0 : 1)
    + questionCount(field.ifTrue || []) + questionCount(field.ifFalse || []), 0);
}

export function definitionCounts(definition: MigratedDefinition) {
  return { sections: definition.sections.length, questions: definition.sections.reduce((total, section) => total + questionCount(section.fields), 0) };
}
