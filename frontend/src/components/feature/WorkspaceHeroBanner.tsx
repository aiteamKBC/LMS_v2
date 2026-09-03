/* This file intentionally exports the animation hook beside the banner so the
   existing page imports stay stable. */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';

interface WorkspaceHeroBannerProps {
  title: string;
  description: string;
  icon: string;
  imageUrl?: string;
  imageAlt?: string;
  stats?: { label: string; value: string; variant?: 'default' | 'danger' | 'success' | 'warning' }[];
  accentColor?: string;
}

export function WorkspaceHeroBanner({
  title,
  description,
  stats,
  icon,
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
      className="workspace-hero-banner relative overflow-hidden rounded-2xl shadow-sm"
      style={{ background: 'linear-gradient(108deg, oklch(var(--primary-700)) 0%, oklch(var(--primary-500)) 30%, oklch(var(--primary-100)) 66%, oklch(var(--background-50)) 100%)' }}
    >
      <div className="relative flex flex-col items-start gap-5 p-5 sm:flex-row sm:items-center sm:p-7">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
          <AppIcon className={`${icon || 'ri-dashboard-line'} text-2xl text-white`}></AppIcon>
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="mb-1 font-heading text-lg font-bold text-white">{title}</h2>
          <p className="text-[13px] leading-relaxed text-white/80">{description}</p>
        </div>

        {stats && stats.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {stats.map((stat, i) => (
              <div key={i} className="coach-metric-card workspace-hero-metric min-w-[80px]">
                <p className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-foreground-500">{stat.label}</p>
                <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums text-foreground-900">{stat.value}</p>
              </div>
            ))}
          </div>
        )}
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
