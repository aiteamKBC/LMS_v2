import {
  getCalendarTimeZone, moduleWeekLiveSessionDates, parseUtcInstant, zonedNaiveToUtcIso,
  type ModuleCatalogueItem, type ModuleComponent, type ModuleWeekSessionPlan,
} from './moduleAuthoringData';
import { linkedGroupOf, moveComponentToWeek as moveLinkedComponentsToWeek } from '../shared/entities/liveSessionRecordingLink';

const text = (value: unknown) => String(value ?? '').trim();

export function liveSessionCalendarMovePending(component: ModuleComponent): boolean {
  if (component.type !== 'live-session') return false;
  const settings = component.settings;
  const booked = Boolean(settings.extraTeamsMeetingUrl || (settings.teamsLiveSessionId && Number(settings.teamsSessionNumber) > 0));
  if (!booked) return false;
  const planned = parseUtcInstant(text(settings.sessionDateTimeUtc)).getTime();
  const actual = parseUtcInstant(text(settings.extraTeamsStartDateTimeUtc || settings.teamsStartDateTimeUtc)).getTime();
  return Number.isFinite(planned) && (!Number.isFinite(actual) || planned !== actual);
}

/** Reparent the same component; no clone, delivery booking or historical record is created. */
export function moveComponentToWeek(
  module: ModuleCatalogueItem, componentId: string, targetWeekId: string,
  plan?: Pick<ModuleWeekSessionPlan, 'sessions'> | null,
): { module: ModuleCatalogueItem; sourceWeekId: string; sessionDate: string; calendarPending: boolean } {
  const source = module.weekStructure.find(week => week.components.some(component => component.id === componentId));
  const targetIndex = module.weekStructure.findIndex(week => week.id === targetWeekId);
  const target = module.weekStructure[targetIndex];
  if (!source || !target) throw new Error('The component or destination week is no longer in this module.');
  const component = source.components.find(item => item.id === componentId)!;
  if (source.id === target.id) throw new Error('Choose a different week.');
  if (target.components.some(item => item.id === componentId)) throw new Error('This component is already in the destination week.');
  const linked = linkedGroupOf(module.weekStructure.flatMap(week => week.components), component, module.catalogueId || module.id);
  const session = linked.find(item => item.type === 'live-session');
  // A recording moves with its same-module session. Only a session arriving
  // from another week needs the destination plan applied to its settings.
  const planningComponent = session && session.weekId !== target.id ? session : component;
  let moved = { ...planningComponent, weekId: target.id };
  let sessionDate = '';
  if (planningComponent.type === 'live-session' && planningComponent.weekId !== target.id) {
    const dates = moduleWeekLiveSessionDates(module, plan?.sessions)[targetIndex] || [];
    const offset = target.components.filter(item => item.type === 'live-session').length;
    sessionDate = dates[offset] || dates.at(-1) || text(target.sessionDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || !Number.isFinite(Date.parse(`${sessionDate}T12:00:00Z`))) {
      throw new Error('The destination week has no delivery date. Set its delivery dates before moving a live session here.');
    }
    const settings = planningComponent.settings;
    const savedZone = text(settings.sessionTimeZone);
    const timeZone = savedZone === 'GMT Standard Time' ? 'Europe/London' : savedZone || getCalendarTimeZone();
    const oldInstant = text(settings.extraTeamsStartDateTimeUtc || settings.teamsStartDateTimeUtc || settings.sessionDateTimeUtc);
    const actualTime = parseUtcInstant(oldInstant);
    const sessionTime = text(settings.sessionTime) || text(target.sessionStartTime) || (
      Number.isFinite(actualTime.getTime())
        ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(actualTime) : ''
    );
    const instant = sessionTime ? zonedNaiveToUtcIso(`${sessionDate}T${sessionTime}`, timeZone) : '';
    const booked = Boolean(settings.extraTeamsMeetingUrl || (settings.teamsLiveSessionId && Number(settings.teamsSessionNumber) > 0));
    moved = {
      ...moved,
      settings: {
        ...settings, sessionDate,
        sessionDay: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${sessionDate}T12:00:00Z`)),
        ...(sessionTime ? { sessionTime } : {}),
        // Keep confirmed Microsoft data separate from the newly planned instant.
        sessionDateTimeUtc: instant,
        ...(!booked ? { teamsStartDateTimeUtc: ['missing', 'ambiguous'].includes(text(settings.teamsCalendarBinding)) ? '' : instant }
          : !settings.teamsStartDateTimeUtc && oldInstant ? { teamsStartDateTimeUtc: oldInstant } : {}),
      },
    };
  }
  return {
    sourceWeekId: source.id, sessionDate, calendarPending: liveSessionCalendarMovePending(moved),
    module: {
      ...module,
      weekStructure: moveLinkedComponentsToWeek(module.weekStructure, componentId, targetWeekId, module.catalogueId || module.id)
        .map(week => week.id === target.id ? {
          ...week, components: week.components.map(item => item.id === moved.id ? moved : item),
        } : week),
    },
  };
}
