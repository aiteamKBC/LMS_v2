/* This file intentionally exports the animation hook beside the banner so the
   existing page imports stay stable. */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, type ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';

interface WorkspaceHeroBannerProps {
  title: string;
  description: string;
  icon: string;
  imageUrl?: string;
  imageAlt?: string;
  stats?: { label: string; value: string; icon?: string; variant?: 'default' | 'danger' | 'success' | 'warning' }[];
  statIconPosition?: 'inline' | 'leading';
  accentColor?: string;
  actions?: ReactNode;
  eyebrow?: string;
  className?: string;
  decorative?: boolean;
}

export function WorkspaceHeroBanner({
  title,
  description,
  stats,
  icon,
  statIconPosition = 'inline',
  actions,
  eyebrow,
  className = '',
  decorative = false,
}: WorkspaceHeroBannerProps) {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
  }, []);

  return (
    <div
      ref={bannerRef}
      className={`ui-hero-banner workspace-hero-banner relative overflow-hidden rounded-2xl shadow-sm ${className}`}
      style={{ background: 'var(--kbc-hero-gradient)' }}
    >
      {decorative && (
        <>
          <span aria-hidden="true" className="workspace-hero-decoration workspace-hero-decoration--ring" />
          <span aria-hidden="true" className="workspace-hero-decoration workspace-hero-decoration--dots" />
        </>
      )}

      <div className="workspace-hero-banner__content relative z-10 flex flex-col items-start gap-5 p-5 sm:flex-row sm:items-center sm:p-7">
        <div className="workspace-hero-banner__identity flex min-w-0 flex-1 items-center gap-4">
          <span className="workspace-hero-banner__icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <AppIcon className={`${icon || 'ri-dashboard-line'} text-2xl text-white`}></AppIcon>
          </span>

          <div className="min-w-0 flex-1">
            {eyebrow && <p className="workspace-hero-eyebrow mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">{eyebrow}</p>}
            <h2 className="workspace-hero-title mb-1 font-heading text-lg font-bold text-white">{title}</h2>
            <p className="workspace-hero-description text-[13px] leading-relaxed text-white/80">{description}</p>
          </div>
        </div>

        {stats && stats.length > 0 && (
          <div className="workspace-hero-banner__stats flex shrink-0 flex-wrap items-center gap-3">
            {stats.map((stat, i) => (
              <div key={i} className={`coach-metric-card workspace-hero-metric workspace-hero-metric--${stat.variant || 'default'} min-w-[80px] ${statIconPosition === 'leading' ? 'workspace-hero-metric--leading-icon' : ''}`}>
                {statIconPosition === 'leading' ? (
                  <>
                    {stat.icon && (
                      <span aria-hidden="true" className="workspace-hero-metric__icon flex shrink-0 items-center justify-center rounded-full">
                        <AppIcon className="text-current" name={stat.icon} size={20} />
                      </span>
                    )}
                    <span className="workspace-hero-metric__body flex min-w-0 flex-col">
                      <span className="workspace-hero-metric__value tabular-nums">{stat.value}</span>
                      <span className="workspace-hero-metric__label truncate">{stat.label}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <p className="workspace-hero-metric__status flex items-center justify-between gap-1.5 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-foreground-500">
                      <span>{stat.label}</span>
                      {stat.icon && <span className="workspace-hero-metric__status-icon flex shrink-0 items-center justify-center rounded-full"><AppIcon className="text-current" name={stat.icon} size={14} /></span>}
                    </p>
                    <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums text-foreground-900">{stat.value}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {actions ? <div className="workspace-hero-banner__actions flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/* Animation helper for staggered children */
export function useStaggerAnimation(delay = 0) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const children = el.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      child.style.opacity = '0';
      child.style.transform = 'translateY(8px)';
      setTimeout(() => {
        child.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
        child.style.opacity = '1';
        child.style.transform = 'translateY(0)';
      }, delay + i * 80);
    }
  }, [delay]);

  return ref;
}
