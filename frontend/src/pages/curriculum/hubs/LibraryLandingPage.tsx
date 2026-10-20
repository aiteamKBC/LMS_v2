import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FAMILY_LABELS } from '@/api/migratedReviewTemplates';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { formatSystemTimestamp } from '@/lib/format';
import { curriculumNavItems } from '@/mocks/navigation';
import { templateKind, updatedLabel } from '../review-templates/templateDisplay';
import { useLibraryPreviews, type LibraryRead } from './useLibraryPreviews';
import styles from './LibraryLandingPage.module.css';

const paths = {
  weeks: '/curriculum/week-builder', reviews: '/curriculum/library/review-templates',
  standards: '/curriculum/standards', books: '/curriculum/knowledge-base',
};
const description = 'Create and reuse modules, KSB standards, and assessments without mixing authoring work with delivery setup.';
const missingAssignment = (value: unknown) => ['', 'unassigned', 'not assigned', 'tbc'].includes(String(value ?? '').trim().toLowerCase());
const dateLabel = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? formatSystemTimestamp(value, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
const statusLabel = (value: string) => value === 'review' ? 'In review' : value.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const bookStatuses: Record<string, string> = {
  queued: 'Queued', extracting: 'Extracting', chunking: 'Chunking', embedding: 'Embedding',
  verifying: 'Verifying', processing: 'Processing', retrying: 'Retrying', ready: 'Ready',
  needs_review: 'Needs review', failed: 'Failed',
};

function Badge({ children, positive = false }: { children: ReactNode; positive?: boolean }) {
  const warning = children === 'In review' || children === 'Needs review';
  return <span className={`${styles.badge} ${positive ? styles.positive : warning ? styles.warning : ''}`}>{children}</span>;
}

function PreviewRow({ title, href, metadata, source, status, positive }: {
  title: string; href?: string; metadata: string; source?: string | null; status: string; positive?: boolean;
}) {
  return <li className={styles.row}>
    <div className={styles.rowCopy}>
      <h3>{href ? <Link to={href}>{title}</Link> : title}</h3>
      {metadata && <p>{metadata}</p>}
      {source && <p className={styles.source}>{source}</p>}
    </div>
    <Badge positive={positive}>{status}</Badge>
  </li>;
}

function DirectoryCard<T>({ title, description: copy, icon, tone, href, unit, query, count, children, unavailable }: {
  title: string; description: string; icon: string; tone: 'amber' | 'teal' | 'pink'; href: string; unit: string;
  query?: LibraryRead<T>; count?: number; children?: ReactNode; unavailable?: string;
}) {
  const label = query?.loading ? 'Loading' : query?.failed || unavailable ? 'Unavailable' : String(count ?? 0);
  return <section aria-label={title} className={`${styles.card} ${styles[tone]}`}>
    <header className={styles.cardHeader}>
      <span className={styles.cardIcon}><AppIcon className={icon} /></span>
      <div className={styles.cardHeading}><h2>{title}</h2><p>{copy}</p></div>
      <div className={styles.total} aria-label={`${title} total: ${label}`}><strong>{/^\d+$/.test(label) ? label : '—'}</strong><span>{unit}</span></div>
    </header>
    <div className={styles.cardBody} aria-busy={query?.loading || false}>
      {unavailable ? <p className={styles.message}>{unavailable}</p>
        : query?.loading ? <p role="status" className={styles.message}>Loading {title.toLowerCase()}…</p>
          : query?.failed ? <div role="alert" className={styles.message}>Unable to load {title.toLowerCase()}. <button type="button" onClick={query.retry}>Try again</button></div>
            : count === 0 ? <p className={styles.message}>No {title.toLowerCase()} available yet.</p>
              : <><ul className={styles.rows}>{children}</ul>{count !== undefined && count > 6 && <p className={styles.previewNote}>Showing 6 of {count}. Open the workspace to see all.</p>}</>}
    </div>
    <footer className={styles.cardFooter}><Link to={href} aria-label={`Open ${title} workspace`}>Open workspace <AppIcon className="ri-arrow-right-line" /></Link></footer>
  </section>;
}

function CreationMenu({ canManageReviews }: { canManageReviews: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const choices = [
    ['Week template', paths.weeks],
    ...(canManageReviews ? [['Review template', paths.reviews]] : []),
    ['Book upload', paths.books], ['Free course', '/curriculum/free-courses'], ['Quiz', '/curriculum/quiz-xml/manual'],
  ];
  return <details className={styles.creation} ref={ref} onKeyDown={event => {
    if (event.key === 'Escape') { ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); }
  }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) ref.current?.removeAttribute('open'); }}>
    <summary><AppIcon className="ri-add-line" /> New reusable content</summary>
    <div className={styles.creationOptions}><p>Choose a workspace to create content</p>{choices.map(([label, href]) => <Link key={href} to={href}>{label}<AppIcon className="ri-arrow-right-line" /></Link>)}</div>
  </details>;
}

export function LibraryLandingPage() {
  const overview = useCurriculumData({ compact: true });
  const programmes = useCurriculumProgrammes();
  const { weeks, reviews, books } = useLibraryPreviews();
  const modules = overview.data?.modules ?? [];
  const groups = overview.data?.groups ?? [];
  // Preserve the Library hub's existing definitions; these are authoring gaps,
  // not counts of authoring records or all kinds of reusable content.
  const authoringIssues = programmes.programmes.filter(programme => Number(programme.ksbTotal || 0) === 0 && !String(programme.ksbProfileSourceId ?? '').trim()).length
    + modules.filter(module => Number(module.ksbCount || 0) === 0).length
    + modules.filter(module => missingAssignment(module.tutor)).length
    + groups.filter(group => missingAssignment(group.coach)).length;
  const programmeCount = programmes.loading ? 'Loading' : programmes.error ? 'Unavailable' : programmes.programmes.length;
  const moduleCount = overview.loading ? 'Loading' : overview.error || !overview.data ? 'Unavailable' : modules.length;
  const issuesCount = programmes.loading || overview.loading ? 'Loading'
    : programmes.error || overview.error || !overview.data ? 'Unavailable' : authoringIssues;

  return <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems}
    workspaceLabel="Curriculum Studio" pageTitle="Library" pageSubtitle={description}
    userName="Rachel Myers" userRole="Curriculum Designer">
    <main id="curriculum-library-landing" className={styles.page}>
      <section className={styles.intro} aria-labelledby="library-heading">
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link to="/workspace/curriculum">Curriculum</Link><AppIcon className="ri-arrow-right-s-line" /><span>Library</span></nav>
        <div className={styles.introLine}><div><h1 id="library-heading">Library</h1><p>{description}</p></div><CreationMenu canManageReviews={!reviews.loading && !reviews.failed && reviews.value?.can_manage === true} /></div>
        <Badge positive={typeof programmeCount === 'number'}>{typeof programmeCount === 'number' ? `${programmeCount} ${programmeCount === 1 ? 'programme' : 'programmes'} in this workspace` : `Programmes: ${programmeCount}`}</Badge>
      </section>

      <section className={styles.summary} aria-label="Library summary">
        <span className={styles.folder}><AppIcon className="ri-folder-open-line" /></span>
        <div className={styles.summaryCopy}><span className={styles.eyebrow}>Learning resources</span><h2>Library</h2><p>Find templates, standards and reference books in one place. Manage each resource in its own workspace before using it in programmes.</p></div>
        <dl className={styles.counters}>
          <div><dt>Programmes</dt><dd>{programmeCount}</dd></div>
          <div><dt>Reusable modules</dt><dd>{moduleCount}</dd></div>
          <div><dt>Authoring issues</dt><dd>{issuesCount}</dd></div>
        </dl>
      </section>
      {(overview.error || programmes.error) && <div role="alert" className={styles.overviewError}>Some Library summary counts are unavailable. <button type="button" onClick={() => { void overview.reload(); void programmes.reload(); }}>Retry summary</button></div>}

      <section aria-labelledby="directory-heading">
        <div className={styles.directoryHeading}><div><h2 id="directory-heading">Choose what you want to do</h2><p>Each destination owns its data, so you always know where a change will be saved.</p></div><span>4 workspaces</span></div>
        <div className={styles.grid}>
          <DirectoryCard title="Week Templates" description="Prepare reusable week structures for faster authoring." icon="ri-calendar-2-line" tone="amber" href={paths.weeks} unit="Templates" query={weeks} count={weeks.value?.length}>
            {weeks.value?.slice(0, 6).map(template => <PreviewRow key={template.id} title={template.title || 'Untitled template'} href={`${paths.weeks}?template=${encodeURIComponent(template.id)}`}
              metadata={[`${template.componentCount} components`, template.courseType === 'free' ? 'Free course' : 'Paid programme', template.programmeName && `Programme: ${template.programmeName}`].filter(Boolean).join(' · ')}
              source={[template.author, dateLabel(template.updatedAt) ? `Updated ${dateLabel(template.updatedAt)}` : dateLabel(template.createdAt) ? `Created ${dateLabel(template.createdAt)}` : null].filter(Boolean).join(' · ')}
              status={statusLabel(template.status)} positive={template.status === 'published'} />)}
          </DirectoryCard>
          <DirectoryCard title="Review Templates" description="Manage reusable standard review forms for MCM, PR and PR + Skills Radar." icon="ri-file-list-3-line" tone="amber" href={paths.reviews} unit="Forms" query={reviews} count={reviews.value?.templates.length}>
            {reviews.value?.templates.slice(0, 6).map(template => <PreviewRow key={template.id} title={template.name}
              metadata={[FAMILY_LABELS[template.review_family], `${templateKind(template)} template`, template.statistics && `${template.statistics.questions} questions`].filter(Boolean).join(' · ')}
              source={dateLabel(template.updated_at) ? `Updated ${updatedLabel(template)}` : null} status={template.is_active ? 'Active' : 'Inactive'} positive={template.is_active} />)}
          </DirectoryCard>
          <DirectoryCard title="KSB Standards" description="Browse Skills England standards and their knowledge, skills and behaviours." icon="ri-node-tree" tone="teal" href={paths.standards} unit="Standards"
            unavailable="Preview and total unavailable. Browse the standards catalogue in its workspace." />
          <DirectoryCard title="Knowledge Base" description="Upload programme books and manage their indexed content in the Knowledge Base." icon="ri-book-open-line" tone="pink" href={paths.books} unit="Sources" query={books} count={books.value?.length}>
            {books.value?.slice(0, 6).map(book => <PreviewRow key={book.id} title={book.title}
              metadata={[book.version?.pageCount != null ? `${book.version.pageCount} pages` : null, book.version?.edition, book.scopes?.length ? `Scopes: ${book.scopes.join(', ')}` : null].filter(Boolean).join(' · ')}
              source={dateLabel(book.createdAt) ? `Created ${dateLabel(book.createdAt)}` : null}
              status={bookStatuses[book.processing?.status] || 'Status unavailable'} positive={book.processing?.status === 'ready'} />)}
          </DirectoryCard>
        </div>
      </section>
      <nav className={styles.moreTools} aria-label="More library tools"><h2>More library tools</h2>
        <Link to="/curriculum/free-courses"><AppIcon className="ri-book-2-line" />Free Courses<AppIcon className="ri-arrow-right-line" /></Link>
        <Link to="/curriculum/quiz-xml"><AppIcon className="ri-file-list-3-line" />Quiz Workspace<AppIcon className="ri-arrow-right-line" /></Link>
        <Link to="/curriculum/question-bank"><AppIcon className="ri-questionnaire-line" />Question Bank<AppIcon className="ri-arrow-right-line" /></Link>
      </nav>
    </main>
  </WorkspaceShell>;
}
