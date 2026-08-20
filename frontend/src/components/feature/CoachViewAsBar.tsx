import { useNavigate } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { clearCoachViewAs } from '@/lib/coachViewAs';

/**
 * "You are looking at somebody else's caseload."
 *
 * Rendered by `WorkspaceShell` on every coach page rather than by the dashboard
 * that sets the selection: an administrator can open the caseload, timetable or
 * marking queue straight from the sidebar, and each of those shows another
 * person's learners with nothing on screen to say so.
 */
export function CoachViewAsBar() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();

  if (!coach.isViewingAsCoach) return null;

  const switchCoach = () => {
    clearCoachViewAs();
    navigate('/workspace/coach');
  };

  return (
    <div className="px-3 pt-3 md:px-6 md:pt-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-primary-200/70 bg-primary-50/60 p-3 md:flex-row md:items-center md:justify-between md:p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100">
            <AppIcon className="ri-eye-line text-base text-primary-600"></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary-900">Viewing {coach.name}'s workspace</p>
            <p className="mt-0.5 truncate text-[12px] text-primary-700/80">
              {coach.email} &middot; read-only, so changes are still made from the admin area
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={switchCoach}
          className="inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-primary-200 bg-background-50 px-3.5 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
        >
          <AppIcon className="ri-group-line"></AppIcon>
          Switch coach
        </button>
      </div>
    </div>
  );
}
