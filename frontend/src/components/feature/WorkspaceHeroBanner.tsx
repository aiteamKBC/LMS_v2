import { useEffect, useRef } from 'react';

interface WorkspaceHeroBannerProps {
  title: string;
  description: string;
  icon: string;
  imageUrl?: string;
  imageAlt?: string;
  stats?: { label: string; value: string; variant?: 'default' | 'danger' | 'success' }[];
  accentColor?: string;
}

export function WorkspaceHeroBanner({
  title,
  description,
  stats,
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
      className="workspace-hero-banner relative overflow-hidden rounded-[1.25rem] border border-foreground-200/60 bg-background-50 shadow-lg shadow-foreground-950/10"
    >
      {/* Subtle top line */}
      <div className="absolute inset-x-0 top-0 h-px bg-primary-200/70" />
      {/* Subtle bottom line */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-foreground-200/60" />
      {/* Liquid blob decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute opacity-20" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div className="absolute opacity-10" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
        <div className="absolute opacity-8" style={{ width: '50%', height: '25%', left: '20%', bottom: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.2) 0%, transparent 70%)', filter: 'blur(50px)' }} />
      </div>

      <div className="relative flex flex-col lg:flex-row items-stretch min-h-[200px]">
        {/* Left: Title + Description */}
        <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
          <h2 className="text-lg md:text-xl font-heading font-bold text-foreground-950 tracking-tight mb-1.5">{title}</h2>
          <p className="text-sm text-foreground-500 max-w-2xl leading-relaxed">{description}</p>
        </div>

        {/* Right: Stats */}
        {stats && stats.length > 0 && (
          <div className="lg:w-[440px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-foreground-200/60 flex items-center">
            <div className="flex items-center gap-3 w-full flex-wrap">
              {stats.map((stat, i) => (
                <div key={i} className="bg-primary-50 border border-primary-100/70 rounded-xl px-4 py-3 text-center flex-1 min-w-[80px]">
                  <p className="text-xl font-bold text-foreground-900">{stat.value}</p>
                  <p className="text-[10px] text-foreground-500 uppercase tracking-wide">{stat.label}</p>
                </div>
              ))}
            </div>
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
