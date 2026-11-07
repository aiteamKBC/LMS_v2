import type { CurriculumTeamsMeetingSummary } from '@/lib/curriculumApi';
import type { ModuleComponent, TeamsMeetingArtifactsResult } from '../module-builder/moduleAuthoringData';
import { liveSessionMeetingScope } from '../shared/entities/liveSessionMeetingScope';

export const EXTERNAL_CALENDAR_MESSAGE = 'This module uses an existing Teams meeting link. Creating a new module meeting is blocked to protect that link. Manage dates and invitations on the original Teams calendar.';

export interface ExternalCalendar {
  source: 'imported' | 'replacement' | 'untracked';
  joinUrls: string[];
  /** Identifies the saved original, independently of any component overrides. */
  originalSeriesId?: string;
  conflictingComponentIds?: string[];
  /** The saved calendar must describe the links learners actually use. */
  canReattach: boolean;
}

const text = (value: unknown) => String(value ?? '').trim();

type CalendarSeriesIdentity = Pick<TeamsMeetingArtifactsResult['series'], 'id' | 'meeting_type'>;

/** Older summary responses omit ownership, but the full saved series has it. */
export function calendarOwnershipKnown(
  summary: CurriculumTeamsMeetingSummary | undefined,
  series?: CalendarSeriesIdentity | null,
): boolean {
  return !summary || Boolean(summary.calendarManagement || text(summary.meetingType)
    || (series?.id === summary.liveSessionId && text(series.meeting_type)));
}

/** A pasted link is not permission to create or replace a Microsoft meeting. */
export function externalCalendarFor(
  summary: CurriculumTeamsMeetingSummary | undefined,
  components: ModuleComponent[] = [],
  series?: CalendarSeriesIdentity | null,
): ExternalCalendar | null {
  const main = components.filter(component => liveSessionMeetingScope(component.settings, Boolean(summary)) !== 'additional');
  const links = [...new Set(main.map(component => text(component.settings?.liveSessionLinkOverride)
    || text(component.settings?.liveSessionUrl) || text(component.settings?.teamsMeetingUrl)).filter(Boolean))];
  const savedLink = text(summary?.joinUrl);
  const ownershipKnown = Boolean(summary?.calendarManagement || summary?.meetingType
    || (series?.id === summary?.liveSessionId && series?.meeting_type));
  const imported = summary?.calendarManagement === 'external' || summary?.meetingType === 'linked-external'
    || (Boolean(summary?.liveSessionId) && series?.id === summary?.liveSessionId && series?.meeting_type === 'linked-external')
    || (!ownershipKnown && main.some(component => component.settings?.teamsMeetingType === 'linked-external'));
  const replacement = main.some(component => {
    const override = text(component.settings?.liveSessionLinkOverride);
    return override && override !== savedLink;
  });
  const originalSeriesId = imported && savedLink ? text(summary?.liveSessionId) : '';
  const conflictingComponentIds = originalSeriesId ? main.filter(component => {
    const link = text(component.settings?.liveSessionLinkOverride)
      || text(component.settings?.liveSessionUrl) || text(component.settings?.teamsMeetingUrl);
    return link && link !== savedLink;
  }).map(component => component.id) : [];
  if (!imported && !replacement && (summary || !links.length)) return null;
  return {
    source: replacement ? 'replacement' : imported ? 'imported' : 'untracked',
    joinUrls: links.length ? links : savedLink ? [savedLink] : [],
    ...(originalSeriesId ? { originalSeriesId } : {}),
    ...(conflictingComponentIds.length ? { conflictingComponentIds } : {}),
    canReattach: Boolean(summary && imported && savedLink && (!links.length || links.every(link => link === savedLink))),
  };
}
