import './LoadingSkeleton.css';
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { SkeletonBlock } from './Skeletons';

const LEGACY_WAIT_LABELS = new Set([
  'Loading', 'Loading cohort', 'Loading group', 'Loading module', 'Loading modules',
  'Loading definitions', 'Loading editor options', 'Loading review dates', 'Loading learner OTJ status',
]);

/** Keep string props usable for accessible names while rendering legacy wait labels as placeholders. */
export function LoadingLabel({ children }: { children: ReactNode }) {
  return typeof children === 'string' && (LEGACY_WAIT_LABELS.has(children) || /^Loading(?:[.\u2026]+|\s.+[.\u2026])$/i.test(children))
    ? <LoadingSkeleton label={children} variant="text" />
    : <>{children}</>;
}

/** Keep controls mounted so selections and keyboard focus survive an options refresh. */
export function LoadingControl({ loading, children }: { loading: boolean; children: ReactNode }) {
  if (isValidElement(children) && children.type === 'select') {
    const control = children as ReactElement<{ className?: string; 'aria-busy'?: boolean }>;
    return cloneElement(control, {
      className: `${control.props.className || ''} ${loading ? 'kbc-loading-native-control' : ''}`,
      'aria-busy': loading || control.props['aria-busy'],
    });
  }
  return <span className={`kbc-loading-control ${loading ? 'kbc-loading-control--pending' : ''}`} aria-busy={loading || undefined}>
    {children}
    {loading && <span className="kbc-loading-control__placeholder" aria-hidden="true"><LoadingSkeleton variant="text" /></span>}
  </span>;
}

/** Content placeholders use spans so they also fit in table cells and text containers. */
export function LoadingSkeleton({
  label = 'Loading content',
  variant = 'rows',
  className = '',
}: {
  label?: string;
  variant?: 'text' | 'rows' | 'cards' | 'form';
  className?: string;
}) {
  return (
    <span aria-live="polite" aria-label={label} aria-busy="true" className={`kbc-loading-skeleton kbc-loading-skeleton--${variant} ${className}`}>
      <span className="sr-only">{label}</span>
      <span className="kbc-loading-skeleton__content" aria-hidden="true">
        {Array.from({ length: variant === 'text' ? 1 : 3 }, (_, index) => (
          <span className="kbc-loading-skeleton__item" key={index}>
            {variant === 'cards' && <SkeletonBlock className="kbc-loading-skeleton__avatar" />}
            <span className="kbc-loading-skeleton__lines">
              <SkeletonBlock className="kbc-loading-skeleton__line" />
              {variant !== 'text' && <SkeletonBlock className="kbc-loading-skeleton__line kbc-loading-skeleton__line--short" />}
            </span>
            {variant === 'rows' && <SkeletonBlock className="kbc-loading-skeleton__badge" />}
          </span>
        ))}
      </span>
    </span>
  );
}
