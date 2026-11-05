export type TeachingActivity = { startDate: string; lastLiveDate: string };
export type TeachingActivities = Record<string, TeachingActivity>;

/** Same inclusive teaching window as the Curriculum module catalogue. */
export function moduleTeachingActive(activity: TeachingActivity | undefined, today: string) {
  return Boolean(activity?.startDate && activity.lastLiveDate
    && activity.startDate <= today && today <= activity.lastLiveDate);
}
