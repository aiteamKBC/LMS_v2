import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import type { CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';
import { curriculumNavItems } from '@/mocks/navigation';
import { useQualityVersionAvailability } from './useQualityVersionAvailability';
import styles from './QualityLandingPage.module.css';

const description = 'Find real curriculum gaps and go straight to the record that fixes them. No placeholder approvals here.';
const clean = (value: unknown) => String(value ?? '').trim();
const normalise = (value: unknown) => clean(value).toLowerCase();
const missingStaff = (value: unknown) => ['', 'unassigned', 'not assigned', 'tbc'].includes(normalise(value));
const programmeKey = (record: CurriculumProgramme) => clean(record.sourceId || record.id);
const programmeQualityHref = (record: CurriculumProgramme) => `/curriculum/programmes/${encodeURIComponent(programmeKey(record))}?tab=quality`;
const moduleHref = (record: CurriculumModule) => {
  const id = clean(record.moduleCatalogueId || record.catalogueId || record.id);
  return id ? `/curriculum/module-builder?module=${encodeURIComponent(id)}` : undefined;
};
type AffectedRecord = { key: string; name: string; context?: string; href?: string };

function Badge({ children, clear = false }: { children: ReactNode; clear?: boolean }) {
  return <span className={`${styles.badge} ${clear ? styles.clearBadge : ''}`}>{children}</span>;
}

function Destination({ title, icon, tone, description: copy, badge, href, children, disabledLabel }: {
  title: string; icon: string; tone: 'pink' | 'teal' | 'rose' | 'orange'; description: string;
  badge?: string; href?: string; children?: ReactNode; disabledLabel?: string;
}) {
  return <section className={`${styles.destination} ${styles[tone]}`} aria-label={title}>
    <div className={styles.destinationTop}><span className={styles.destinationIcon}><AppIcon className={icon} /></span>{badge && <Badge>{badge}</Badge>}</div>
    <h3>{title}</h3><p>{copy}</p>{children}
    {href ? <Link className={styles.workspaceLink} to={href} aria-label={`Open ${title} workspace`}>Open workspace <AppIcon className="ri-arrow-right-line" /></Link>
      : <button className={styles.workspaceLink} type="button" disabled>{disabledLabel || 'Unavailable'}</button>}
  </section>;
}

function AttentionCheck({ title, description: copy, count, loading, icon, records, href }: {
  title: string; description: string; count: number | null; loading: boolean; icon: string; records: AffectedRecord[]; href: string;
}) {
  const result = loading ? 'Checking…' : count === null ? 'Unavailable' : count === 0 ? 'Clear' : String(count);
  return <details className={styles.check} data-clear={count === 0 && !loading}>
    <summary><span className={styles.checkIcon}><AppIcon className={count === 0 && !loading ? 'ri-check-line' : icon} /></span>
      <span className={styles.checkCopy}><strong>{title}</strong><span>{copy}</span></span>
      <span className={styles.checkResult}>{result}</span><AppIcon className="ri-arrow-right-s-line" /></summary>
    <div className={styles.checkBody}>
      {loading ? <p role="status">Checking current records…</p> : count === null ? <p>Results are unavailable. Refresh the quality checks to try again.</p>
        : count === 0 ? <p>No affected records were found in the current workspace data.</p>
          : <ul>{records.map(record => <li key={record.key}>{record.href ? <Link to={record.href}>{record.name}<AppIcon className="ri-arrow-right-line" /></Link> : <span>{record.name} — record link unavailable</span>}{record.context && <small>{record.context}</small>}</li>)}</ul>}
      <Link className={styles.listLink} to={href}>Open record workspace <AppIcon className="ri-arrow-right-line" /></Link>
    </div>
  </details>;
}

export function QualityLandingPage() {
  // Keep the existing Quality scope and compact read. No authoring trees,
  // report exports, version snapshots or programme-by-programme coverage reads.
  const overview = useCurriculumData({ compact: true });
  const programmes = useCurriculumProgrammes();
  const versions = useQualityVersionAvailability();
  const [selectedId, setSelectedId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const programmesReady = !programmes.loading && !programmes.error && Array.isArray(programmes.programmes);
  const modulesReady = !overview.loading && !overview.error && Array.isArray(overview.data?.modules);
  const groupsReady = !overview.loading && !overview.error && Array.isArray(overview.data?.groups);
  const modules = overview.data?.modules ?? [];
  const groups = overview.data?.groups ?? [];
  // These predicates and the four-part Open checks sum are the existing hub
  // definitions. Counts refer to module rows, not deduplicated authored modules.
  const sourceGaps = programmes.programmes.filter(record => Number(record.ksbTotal || 0) === 0 && !clean(record.ksbProfileSourceId));
  const mappingGaps = modules.filter(record => Number(record.ksbCount || 0) === 0);
  const unpublished = modules.filter(record => normalise(record.status) !== 'published');
  const openChecks = programmesReady && modulesReady && groupsReady ? sourceGaps.length + mappingGaps.length
    + modules.filter(record => missingStaff(record.tutor)).length + groups.filter(record => missingStaff(record.coach)).length : null;
  const counts = [programmesReady ? sourceGaps.length : null, modulesReady ? mappingGaps.length : null, modulesReady ? unpublished.length : null];
  const allChecksReady = counts.every(count => count !== null);
  const categories = counts.filter(count => count !== null && count > 0).length;
  const loading = overview.loading || programmes.loading || refreshing;
  const selected = programmesReady ? programmes.programmes.find(record => programmeKey(record) === selectedId) : undefined;
  const moduleRecords = (records: CurriculumModule[]): AffectedRecord[] => records.map(record => ({
    key: `${record.id}:${record.groupId || ''}:${record.cohortId || ''}`, name: record.name || 'Untitled module',
    context: [record.programme, record.cohort, record.group].map(clean).filter(Boolean).join(' · '), href: moduleHref(record),
  }));
  const refresh = async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      await Promise.allSettled([overview.reload({ revalidate: true }), programmes.reload({ revalidate: true }), versions.reload(true)]);
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  };
  const value = (ready: boolean, count: number) => loading ? 'Checking…' : ready ? count : 'Unavailable';

  return <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio"
    pageTitle="Quality" pageSubtitle="Find real curriculum gaps and go straight to the record that fixes them. No placeholder approval states."
    userName="Rachel Myers" userRole="Curriculum Designer">
    <main id="curriculum-quality-landing" className={styles.page}>
      <section className={styles.intro} aria-labelledby="quality-heading">
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link to="/workspace/curriculum">Curriculum</Link><AppIcon className="ri-arrow-right-s-line" /><span>Quality</span></nav>
        <div className={styles.introLine}><div><h1 id="quality-heading">Quality</h1><p>{description}</p></div>
          <div className={styles.actions}><Link to={selected ? programmeQualityHref(selected) : '/curriculum/programmes'}><ShieldCheck size={15} aria-hidden="true" />Programme quality</Link>
            <Link to="/curriculum/published"><AppIcon className="ri-play-circle-line" />Open Published Content</Link>
            <button type="button" className={styles.primary} disabled={loading} onClick={() => void refresh()}><ShieldCheck size={15} aria-hidden="true" />{refreshing ? 'Checking…' : 'Run quality check'}</button></div>
        </div>
        <div className={styles.checkInfo}><Badge>Open issues: unavailable</Badge><span>Last check time unavailable</span></div>
      </section>
      <section className={styles.health} aria-label="Curriculum health">
        <span className={styles.shield}><ShieldCheck size={25} aria-hidden="true" /></span>
        <div className={styles.healthCopy}><span className={styles.eyebrow}>Curriculum health</span><h2>Quality</h2><p>Review KSB sources, mappings, publication and staffing gaps in the current curriculum. Checking does not change curriculum content or learner records.</p></div>
        <dl className={styles.counters}>
          <div><dt>Programmes checked</dt><dd>{value(programmesReady, programmes.programmes.length)}</dd></div>
          <div><dt>Modules checked</dt><dd>{value(modulesReady, modules.length)}</dd></div>
          <div><dt>Open checks</dt><dd>{loading ? 'Checking…' : openChecks ?? 'Unavailable'}</dd></div>
        </dl>
        <p className={styles.definition}>Open checks counts missing KSB sources, module mappings, tutors and coaches. One record can contribute to more than one check.</p>
      </section>
      {(overview.error || programmes.error || !loading && (!modulesReady || !groupsReady)) && <div role="alert" className={styles.error}>Some quality results are unavailable. <button type="button" disabled={refreshing} onClick={() => void refresh()}>Retry quality checks</button></div>}
      {refreshing && <p role="status" className={styles.refreshStatus}>Refreshing quality results from current records…</p>}
      <section aria-labelledby="quality-destinations-heading">
        <div className={styles.directoryHeading}><div><h2 id="quality-destinations-heading">Choose what you want to do</h2><p>Each destination owns its data, so you always know where a change will be saved.</p></div><span>4 workspaces</span></div>
        <div className={styles.destinations}>
          <Destination title="Published Content" icon="ri-book-open-line" tone="pink" description="See what is live, ready to run, or being delivered before it is published. Authored modules are grouped in the workspace."
            badge={loading ? 'Checking…' : modulesReady ? `${unpublished.length} unpublished module rows` : 'Count unavailable'} href="/curriculum/published" />
          <Destination title="Curriculum Reports" icon="ri-bar-chart-box-line" tone="teal" description="Coverage, delivery and staffing read from current records, previewed on screen and exportable as CSV." href="/curriculum/reports" />
          <Destination title="Version Control" icon="ri-git-branch-line" tone="rose" description="Review saved versions and revisions of modules, weeks and components, including what changed and who saved it."
            badge={versions.loading ? 'Checking availability' : versions.error ? 'Availability unavailable' : !versions.available ? 'Unavailable' : undefined}
            href={!versions.loading && !versions.error && versions.available ? '/curriculum/version-control' : undefined} disabledLabel={versions.loading ? 'Checking availability…' : 'Unavailable'}>
            {versions.error && <p className={styles.versionError}>Could not check version history. <button type="button" onClick={() => void versions.reload(true)}>Retry availability</button></p>}
            {!versions.loading && !versions.error && !versions.available && <p>Version history is not available in this workspace.</p>}
          </Destination>
          <Destination title="KSB Coverage" icon="ri-node-tree" tone="orange" description="Pick a programme and trace its KSBs to the modules and components that teach them." badge="Per programme"
            href={selected ? `/curriculum/ksb-mapping?programme=${encodeURIComponent(programmeKey(selected))}` : '/curriculum/ksb-mapping'}>
            <label className={styles.programmePicker}><span>Programme</span><select aria-label="Quality programme" value={selected ? selectedId : ''} disabled={!programmesReady || !programmes.programmes.length} onChange={event => setSelectedId(event.target.value)}>
              <option value="">{programmes.loading ? 'Loading programmes…' : !programmesReady ? 'Programmes unavailable' : !programmes.programmes.length ? 'No programmes available' : 'Choose a programme…'}</option>
              {programmesReady && programmes.programmes.filter(record => programmeKey(record)).map(record => <option key={programmeKey(record)} value={programmeKey(record)}>{record.name}</option>)}
            </select></label>
          </Destination>
        </div>
      </section>
      <section className={styles.attention} aria-labelledby="attention-heading">
        <header className={styles.attentionHeading}><div><h2 id="attention-heading">Checks that need attention</h2><p>Counts come from current curriculum records, not a simulated approval workflow.</p></div>
          <span>{loading ? 'Checking records…' : allChecksReady ? `${categories} of 3 categories need work` : 'Some checks unavailable'}</span></header>
        <AttentionCheck title="Programmes without a KSB source" description="Programmes with no applied source and no KSB total recorded." icon="ri-node-tree" count={counts[0]} loading={programmes.loading || refreshing}
          href="/curriculum/programmes" records={sourceGaps.map(record => ({ key: programmeKey(record), name: record.name, href: programmeKey(record) ? programmeQualityHref(record) : undefined }))} />
        <AttentionCheck title="Modules without KSB mappings" description="Module rows with no KSB mappings recorded. Expand to open an affected module." icon="ri-link-unlink" count={counts[1]} loading={overview.loading || refreshing}
          href="/curriculum/ksb-mapping" records={moduleRecords(mappingGaps)} />
        <AttentionCheck title="Modules not yet published" description="Module rows whose recorded status is not published. Expand to open an affected module." icon="ri-draft-line" count={counts[2]} loading={overview.loading || refreshing}
          href="/curriculum/published" records={moduleRecords(unpublished)} />
      </section>
      <div className={styles.additional}><Link to="/curriculum/audit-trail"><AppIcon className="ri-history-line" />Audit Trail<AppIcon className="ri-arrow-right-line" /></Link>
        <p>Quality assurance workflow unavailable: sampling, IQA findings and sign-off are not supported here yet.</p></div>
    </main>
  </WorkspaceShell>;
}
