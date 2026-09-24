import { useState, type FocusEvent, type KeyboardEvent, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import styles from './seasonal-hover-cards.module.css';

export interface SeasonCardProps {
  title: string;
  subtitle: string;
  description: string;
  imageSrc?: string;
  imageAlt?: string;
  href?: string;
  cta?: string;
  status?: string;
  meta?: string;
  icon?: LucideIcon;
  variant?: 'action' | 'session' | 'due';
  className?: string;
}

interface SeasonalHoverCardsProps {
  cards: SeasonCardProps[];
  className?: string;
}

function SeasonCard({
  title, subtitle, description, href, status, meta, icon: Icon,
  variant = 'action', className, active, onActivate,
}: SeasonCardProps & { active: boolean; onActivate: () => void }) {
  const classes = cn(styles.card, styles[variant], active && styles.active, className);
  const content = <>
    <div className={styles.cardPrimary}>
      <div className={styles.topLine}>
        <span className={styles.icon} aria-hidden="true">
          {Icon ? <Icon /> : <span className={styles.iconFallback} />}
        </span>
        <span className={styles.headingCopy}>
          <span className={styles.eyebrow}>{title}</span>
          <strong className={styles.subtitle}>{subtitle}</strong>
        </span>
        <ArrowRight aria-hidden="true" className={styles.chevron} />
      </div>
      {status && <span className={styles.status}><span aria-hidden="true" />{status}</span>}
    </div>
    <div className={styles.cardReveal}>
      <div className={styles.details}>
        <p className={styles.description}>{description}</p>
        {meta && <p className={styles.meta}>{meta}</p>}
      </div>
    </div>
  </>;

  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === ' ' && !event.defaultPrevented) onActivate();
  };
  // Keep the compact flex interaction: the active card gets room while the
  // whole set remains on one row and the CTA stays in the lower panel.
  const cardStyle = { '--card-flex': active ? 1.35 : 1 } as CSSProperties;

  return href
    ? <Link to={href} className={classes} style={cardStyle} aria-expanded={active}
      onMouseEnter={onActivate} onFocus={onActivate} onKeyDown={onKeyDown}>{content}</Link>
    : <div className={classes} style={cardStyle} onMouseEnter={onActivate} onFocus={onActivate}
      tabIndex={0} role="group" aria-expanded={active}>{content}</div>;
}

export function SeasonalHoverCards({ cards, className }: SeasonalHoverCardsProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const clearIfFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveIndex(null);
  };

  return <div role="region" className={cn(styles.cards, className)} onMouseLeave={() => setActiveIndex(null)}
    onBlur={clearIfFocusLeaves} aria-label="Learner actions">
    {cards.map((card, index) => <SeasonCard key={`${card.title}-${index}`} {...card}
      active={activeIndex === index} onActivate={() => setActiveIndex(index)} />)}
  </div>;
}
