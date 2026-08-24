// ============================================================================
// Learner identity.
//
// Twenty-three separate renderings of "who is this learner" existed across the
// coach workspace — seven avatar sizes, three shapes, and colour coming from a
// shared helper on four pages, an inline ternary on four more and a hard-coded
// class on five. A coach moving between Attendance and OTJH was reading two
// different visual languages for the same person.
//
// One rule, carried over from the caseload page that got it right: the avatar
// carries identity, the ring carries state. Filling the avatar with the risk
// colour makes a page of at-risk learners look like a warning label rather than
// a list of people, and it leaves nowhere to show that the same learner is also
// on a break.
// ============================================================================
import { memo, type ReactNode } from 'react';
// Imported explicitly rather than relying on the auto-import plugin, which only
// runs in the app build — this is rendered by page tests too.
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import { EMPTY_VALUE, displayValue, initialsFor } from '@/lib/format';
import { toneStyle, type StatusTone } from '@/lib/statusTone';

const AVATAR_SIZE = {
  sm: 'h-7 w-7 text-[12px]',
  md: 'h-10 w-10 text-[13px]',
  lg: 'h-12 w-12 text-[14px]',
} as const;

export const LearnerAvatar = memo(function LearnerAvatar({
  name,
  initials,
  tone = 'neutral',
  size = 'md',
  onClick,
  title,
  className,
}: {
  /** Initials are derived from this when `initials` is not given. */
  name?: string | null;
  initials?: string;
  /** State ring. `neutral` gives the quiet brand ring, not a grey one. */
  tone?: StatusTone;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const text = initials ?? initialsFor(name);
  // A ring, not a fill: the avatar carries identity, the ring carries state.
  const ring = tone === 'neutral' ? 'ring-primary-100' : toneStyle(tone).ring;

  const base = cn(
    'flex shrink-0 items-center justify-center rounded-full bg-primary-50 font-semibold text-primary-800 ring-2',
    AVATAR_SIZE[size],
    ring,
    className,
  );

  if (!onClick) {
    return <span className={base} aria-hidden="true">{text}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(base, 'transition hover:bg-primary-100 focus:outline-none focus-visible:ring-primary-400')}
    >
      {text}
    </button>
  );
});

/**
 * The full identity block: avatar, name, programme or cohort, and status.
 *
 * `meta` is where a page adds its own context — an email on Attendance, an
 * employer on OTJH — so the shared part stays shared without forcing every page
 * to show the same second line.
 */
export const LearnerIdentity = memo(function LearnerIdentity({
  name,
  programme,
  tone = 'neutral',
  status,
  meta,
  size = 'md',
  onClick,
  className,
}: {
  name?: string | null;
  /** Programme, or cohort when there is no programme. */
  programme?: string | null;
  tone?: StatusTone;
  /** A StatusBadge, shown beside the name. */
  status?: ReactNode;
  /** Page-specific second line. */
  meta?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Makes the name a button — usually opens the quick view. */
  onClick?: () => void;
  className?: string;
}) {
  const displayName = displayValue(name);
  const programmeText = displayValue(programme);

  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <LearnerAvatar name={name} tone={tone} size={size} />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {onClick ? (
            <button
              type="button"
              onClick={onClick}
              className="min-w-0 truncate text-left text-[13px] font-semibold text-foreground-900 transition hover:text-primary-700"
            >
              {displayName}
            </button>
          ) : (
            <span className="min-w-0 truncate text-[13px] font-semibold text-foreground-900">
              {displayName}
            </span>
          )}
          {status}
        </div>

        {programmeText !== EMPTY_VALUE ? (
          <p className="truncate text-[12px] text-foreground-500">{programmeText}</p>
        ) : null}
        {meta ? <p className="truncate text-[12px] text-foreground-400">{meta}</p> : null}
      </div>
    </div>
  );
});

/**
 * A date and what it means right now. The offset is the part a coach acts on, so
 * it takes the colour and the date itself stays neutral.
 */
export const DateStatus = memo(function DateStatus({
  label,
  date,
  daysAway,
  tone = 'neutral',
  offsetText,
}: {
  label?: string;
  date: string;
  daysAway: number | null;
  tone?: StatusTone;
  /** Human phrasing of the offset, from `formatDayOffset`. */
  offsetText?: string;
}) {
  return (
    <span className="inline-flex min-w-0 flex-col">
      {label ? (
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-foreground-400">
          {label}
        </span>
      ) : null}
      <span className="text-[13px] font-semibold tabular-nums text-foreground-800">
        {displayValue(date)}
      </span>
      {daysAway !== null && offsetText ? (
        <span className={cn('text-[12px]', tone === 'neutral' ? 'text-foreground-400' : toneStyle(tone).text)}>
          {offsetText}
        </span>
      ) : null}
    </span>
  );
});

/**
 * A reason line — an icon, the finding, and optionally the detail behind it.
 * "At risk" with no reason just moves the question somewhere else.
 */
export const ReasonLine = memo(function ReasonLine({
  icon,
  label,
  detail,
  tone = 'neutral',
  onClick,
}: {
  icon: string;
  label: string;
  detail?: string | null;
  tone?: StatusTone;
  onClick?: () => void;
}) {
  const body = (
    <>
      <AppIcon
        className={cn(
          icon,
          'mt-[3px] shrink-0 text-[13px]',
          tone === 'neutral' ? 'text-foreground-400' : toneStyle(tone).text,
        )}
      ></AppIcon>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium leading-tight text-foreground-800">{label}</span>
        {detail ? (
          <span className="mt-0.5 block text-[12px] leading-tight text-foreground-400">{detail}</span>
        ) : null}
      </span>
    </>
  );

  if (!onClick) {
    return <span className="flex items-start gap-1.5">{body}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-background-100"
    >
      {body}
    </button>
  );
});
