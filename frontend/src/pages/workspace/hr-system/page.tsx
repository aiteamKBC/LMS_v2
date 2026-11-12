import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { CertificateDocument } from '@/components/feature/CertificateDocument';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageTabs } from '@/components/ui/PageTabs';
import { getBreatheRuns, listBreatheConnections, type BreatheConnectionStatus, type BreatheSyncRun } from '@/api/breatheIntegration';
import { useAuth } from '@/hooks/useAuth';
import { actualHours, DEMO_KSBS, DEMO_LEARNERS, DEMO_MODULES, DEMO_PROGRAMME, learningProgress, moduleAchievement, trainingDraft, type DemoLearner } from './demoProgramme';
import styles from './workspace.module.css';

const VIEWS = [
  { value: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { value: 'learners', label: 'Learners', icon: 'ri-team-line' },
  { value: 'modules', label: 'Programme & modules', icon: 'ri-book-open-line' },
  { value: 'requests', label: 'Training requests', icon: 'ri-send-plane-line' },
  { value: 'certificates', label: 'Certificates', icon: 'ri-award-line' },
  { value: 'connections', label: 'Connections & history', icon: 'ri-links-line' },
];
const number = (value: number) => value.toLocaleString('en-GB');
const difference = (value: number) => `${value > 0 ? '+' : ''}${value}h`;

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`${styles.badge} ${styles[tone] ?? ''}`}>{children}</span>;
}

function LearnerStatus({ learner }: { learner: DemoLearner }) {
  return <Badge tone={learner.status === 'At risk' ? 'danger' : 'success'}>{learner.status}</Badge>;
}

function Progress({ value, risk = false }: { value: number; risk?: boolean }) {
  return <div className={styles.progressCell}><div className={styles.progressTrack}><span className={risk ? styles.riskBar : ''} style={{ width: `${value}%` }} /></div><strong>{value}%</strong></div>;
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]') ?? []);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [onClose]);
  return <div className={styles.backdrop} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.dialog}>
      <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>HR SYSTEM · DEMO</p><h2 id={titleId}>{title}</h2></div><button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close details"><AppIcon name="ri-close-line" /></button></div>
      {children}
    </div>
  </div>;
}

function LearnerDetails({ learner, onClose }: { learner: DemoLearner; onClose: () => void }) {
  const [group, setGroup] = useState('K');
  const codes = DEMO_KSBS.filter(code => code.startsWith(group));
  return <Dialog title={learner.name} onClose={onClose}>
    <div className={styles.detailSummary}><LearnerStatus learner={learner} /><span>{actualHours(learner)}h actual / 850h planned</span><span>{learningProgress(learner)}% learning completion</span></div>
    <h3 className={styles.sectionTitle}>Programme KSBs · {learner.achievedKsbCodes.length} of 62 achieved</h3>
    <p className={styles.muted}>Illustrative achievement and module mapping for this demonstration.</p>
    <PageTabs label="KSB category" value={group} onChange={setGroup} items={[
      { value: 'K', label: 'Knowledge', count: 31 }, { value: 'S', label: 'Skills', count: 26 }, { value: 'B', label: 'Behaviours', count: 5 },
    ]} />
    <div className={styles.ksbGrid}>{codes.map(code => <span key={code} className={learner.achievedKsbCodes.includes(code) ? styles.achieved : styles.pending} title={learner.achievedKsbCodes.includes(code) ? `${code} achieved` : `${code} pending`}><AppIcon name={learner.achievedKsbCodes.includes(code) ? 'ri-check-line' : 'ri-time-line'} />{code}</span>)}</div>
    <p className={styles.muted}>Green = achieved · grey = pending. Hours do not automatically award KSBs.</p>
    <h3 className={styles.sectionTitle}>Four modules · one programme</h3>
    <ModuleTable learner={learner} />
    {learner.status === 'At risk' && <div className={styles.warning}><strong>Demo alert: follow-up needed</strong><p>Programme overdue at the demo date (12 Nov 2026), 43 KSBs pending and 490h below the full programme plan. This is a sample scenario, not a new LMS risk calculation.</p></div>}
  </Dialog>;
}

function ModuleTable({ learner }: { learner: DemoLearner }) {
  return <div className={styles.tableScroll}><table className={styles.table}>
    <caption className="sr-only">Module breakdown for {learner.name}</caption>
    <thead><tr><th>Module</th><th>Planned</th><th>Actual</th><th>Learning</th><th>KSBs</th></tr></thead>
    <tbody>{DEMO_MODULES.map((module, index) => <tr key={module.id}>
      <td><span className={styles.moduleNumber}>0{index + 1}</span><strong>{module.name}</strong></td><td>{module.plannedHours}h</td><td>{learner.actualHoursByModule[index]}h</td><td>{learner.progressByModule[index]}%</td><td>{moduleAchievement(learner, index)} / {module.ksbCodes.length}</td>
    </tr>)}</tbody>
    <tfoot><tr><th>Programme total</th><td>850h</td><td>{actualHours(learner)}h</td><td>{learningProgress(learner)}%</td><td>{learner.achievedKsbCodes.length} / 62</td></tr></tfoot>
  </table></div>;
}

function Connections() {
  const [connections, setConnections] = useState<BreatheConnectionStatus[]>([]);
  const [selected, setSelected] = useState('');
  const [runs, setRuns] = useState<BreatheSyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(false);
  const [error, setError] = useState('');
  const [runsError, setRunsError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setConnections([]); setSelected('');
    listBreatheConnections().then(data => {
      if (!current) return;
      setConnections(data.results); setSelected(data.results[0]?.id ?? '');
    }).catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'Could not load connections.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [revision]);
  useEffect(() => {
    let current = true;
    setRuns([]); setRunsError(''); setRunsLoading(Boolean(selected));
    if (selected) getBreatheRuns(selected).then(data => { if (current) setRuns(data.results); })
      .catch((cause: unknown) => { if (current) setRunsError(cause instanceof Error ? cause.message : 'Could not load sync history.'); })
      .finally(() => { if (current) setRunsLoading(false); });
    return () => { current = false; };
  }, [selected]);
  const connection = connections.find(item => item.id === selected);
  return <section className={styles.panel}>
    <div className={styles.panelHeading}><div><p className={styles.eyebrow}>CONNECTED SERVICE</p><h2>Breathe connections & history</h2><p className={styles.muted}>These are real service responses. Demo learners are never submitted from this screen.</p></div><Badge>Live service read</Badge></div>
    <div className={styles.actions}><button type="button" className={styles.secondaryButton} onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh connections</button><Link className={styles.primaryButton} to="/workspace/integrations/breathe">Connection settings <AppIcon name="ri-arrow-right-line" /></Link></div>
    {loading ? <p role="status" className={styles.empty}>Loading connections…</p> : error ? <div role="alert" className={styles.warning}><strong>Connection data unavailable</strong><p>{error}</p><p>No connection or delivery success has been assumed.</p></div> : connections.length === 0 ? <div className={styles.empty}><AppIcon name="ri-plug-line" size={32} /><h3>No Breathe connections found</h3><p>Add a verified connection before matching employees or sending training records.</p></div> : <>
      <label className={styles.field}>Connection<select value={selected} onChange={event => setSelected(event.target.value)}>{connections.map(item => <option key={item.id} value={item.id}>{item.externalAccountId || item.id}</option>)}</select></label>
      {connection && <div className={styles.connectionFacts}><div><span>Status reported by service</span><strong>{connection.status}</strong></div><div><span>Last verified</span><strong>{connection.lastVerifiedAt || 'Not verified'}</strong></div><div><span>Last sync</span><strong>{connection.lastSyncAt || 'No sync recorded'}</strong></div></div>}
      {connection?.lastError && <p role="alert" className={styles.warning}>{connection.lastError}</p>}
      <h3 className={styles.sectionTitle}>Delivery history</h3>
      {runsLoading ? <p role="status">Loading history…</p> : runsError ? <p role="alert" className={styles.warning}>{runsError}</p> : runs.length === 0 ? <p className={styles.empty}>No sync runs recorded for this connection.</p> : <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Run</th><th>Resources</th><th>Status</th><th>Mode</th><th>Result</th></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td>{run.id}</td><td>{run.resources.join(', ')}</td><td>{run.status}</td><td>{run.dryRun ? 'Dry run' : 'Live'}</td><td>{run.errorMessage || Object.entries(run.counts).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'No result reported'}</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}

export default function HRSystemWorkspace() {
  const { auth } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(item => item.value === params.get('view')) ? params.get('view')! : 'overview';
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const main = contentRef.current?.closest<HTMLElement>('.workspace-main');
    if (main) main.scrollTop = 0;
  }, [view]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedLearner, setSelectedLearner] = useState(DEMO_LEARNERS[0].id);
  const [details, setDetails] = useState<DemoLearner | null>(null);
  const [draft, setDraft] = useState<DemoLearner | null>(null);
  const [certificate, setCertificate] = useState(false);
  const selected = DEMO_LEARNERS.find(item => item.id === selectedLearner) ?? DEMO_LEARNERS[0];
  const visible = DEMO_LEARNERS.filter(learner => (filter === 'all' || learner.status === filter)
    && `${learner.name} ${learner.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const go = (next: string) => setParams(next === 'overview' ? {} : { view: next });
  const navItems = [
    ...VIEWS.map(item => ({ id: `hr-${item.value}`, label: item.label, icon: item.icon, href: `/workspace/hr-system${item.value === 'overview' ? '' : `?view=${item.value}`}`, active: item.value === view })),
    { id: 'hr-b2b-portal', label: 'B2B Company Portal', icon: 'ri-building-2-line', href: '/workspace/b2b' },
  ];
  const closeDetails = useRef(() => setDetails(null)).current;
  const closeDraft = useRef(() => setDraft(null)).current;
  const closeCertificate = useRef(() => setCertificate(false)).current;
  const demoLabel = <Badge tone="gold">DEMO · SYNTHETIC DATA</Badge>;

  const learnersTable = <section className={styles.panel}>
    <div className={styles.panelHeading}><div><p className={styles.eyebrow}>PROGRAMME PERFORMANCE</p><h2>Your learners, in focus</h2><p className={styles.muted}>850 planned hours and 62 KSBs per learner · four modules</p></div><span className={styles.count}>{DEMO_LEARNERS.length} learners</span></div>
    <div className={styles.toolbar}><PageTabs label="Filter learners by status" value={filter} onChange={setFilter} items={[
      { value: 'all', label: 'All learners', count: 3 }, { value: 'Completed', label: 'Completed', count: 1 }, { value: 'On track', label: 'On track', count: 1 }, { value: 'At risk', label: 'At risk', count: 1, tone: 'critical' },
    ]} /><label className={styles.search}><AppIcon name="ri-search-line" /><input aria-label="Search demo learners" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search learners…" /></label></div>
    <div className={styles.tableScroll}><table className={`${styles.table} ${styles.learnersTable}`}><caption className="sr-only">Demo programme learner progress</caption><thead><tr><th>Learner</th><th>Actual / planned</th><th>Learning</th><th>KSBs achieved</th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
      {visible.map(learner => <tr key={learner.id}><td><div className={styles.person}><span className={`${styles.avatar} ${styles[`avatar${learner.id.slice(-1)}`]}`}>{learner.initials}</span><div><strong>{learner.name}</strong><small>{learner.email}</small></div></div></td><td data-label="Actual / planned"><strong>{number(actualHours(learner))}<span className={styles.muted}> / 850h</span></strong><small className={styles.hoursNote}>{difference(actualHours(learner) - 850)} vs plan</small></td><td data-label="Learning"><Progress value={learningProgress(learner)} risk={learner.status === 'At risk'} /></td><td data-label="KSBs achieved"><button className={styles.textButton} type="button" onClick={() => setDetails(learner)} aria-label={`View KSBs for ${learner.name}`}>{learner.achievedKsbCodes.length} <span className={styles.muted}>/ 62</span><AppIcon name="ri-arrow-right-up-line" /></button></td><td data-label="Status"><LearnerStatus learner={learner} /><small>{learner.dueLabel}</small></td><td><button type="button" className={styles.iconButton} aria-label={`View details for ${learner.name}`} onClick={() => { setSelectedLearner(learner.id); setDetails(learner); }}><AppIcon name="ri-arrow-right-line" /></button></td></tr>)}
    </tbody></table>{visible.length === 0 && <p className={styles.empty}>No demo learners match your search and status filter.</p>}</div>
    <div className={styles.panelFooter}><span>Learning completion and KSB achievement are measured separately.</span><span>As at 12 Nov 2026 · Demo</span></div>
  </section>;

  return <div className={styles.root}><WorkspaceShell appearance="learner" role="integrations" roleLabel="HR System" workspaceLabel="HR System" navItems={navItems} pageTitle="HR System" pageSubtitle="Learning connected to your people" userName={auth.account?.displayName ?? 'Administrator'} headerExtras={demoLabel} hideBreadcrumbs>
    <div ref={contentRef} className={styles.content}>
      <div className={styles.pageHeading}><div><p className={styles.eyebrow}><span className={styles.brandDot} /> KBC LEARNING · HR SYSTEM</p><h1>{view === 'overview' ? 'Learning that moves people forward.' : VIEWS.find(item => item.value === view)?.label}</h1><p className={styles.muted}>One clear view of programme hours, skills and the journey into Breathe HR.</p></div><button type="button" className={styles.primaryButton} onClick={() => go(view === 'connections' ? 'overview' : 'connections')}><AppIcon name="ri-links-line" />{view === 'connections' ? 'Back to overview' : 'Breathe connection'}</button></div>
      <div className={styles.demoNotice}><AppIcon name="ri-information-line" /><p><strong>Presentation demo.</strong> Three fictional learners. Sample hours, progress, KSBs and alerts. Sending from this screen is not enabled.</p><span>12 NOV 2026</span></div>

      {(view === 'overview' || view === 'learners') && <>
        <div className={styles.metrics}>
          <div className={`${styles.metric} ${styles.featured}`}><div className={styles.metricTop}><span>Programme hours planned</span><AppIcon name="ri-time-line" /></div><strong>{number(DEMO_PROGRAMME.plannedHours * DEMO_LEARNERS.length)}<em>h</em></strong><p>850h × 3 learners <span>4 modules each</span></p></div>
          <div className={`${styles.metric} ${styles.mint}`}><div className={styles.metricTop}><span>Actual hours logged</span><AppIcon name="ri-bar-chart-line" /></div><strong>{number(DEMO_LEARNERS.reduce((sum, learner) => sum + actualHours(learner), 0))}<em>h</em></strong><p>900h · 810h · 360h <span>Across all learners</span></p></div>
          <div className={`${styles.metric} ${styles.sand}`}><div className={styles.metricTop}><span>KSBs achieved</span><AppIcon name="ri-medal-line" /></div><strong>{DEMO_LEARNERS.reduce((sum, learner) => sum + learner.achievedKsbCodes.length, 0)}<em> / 186</em></strong><p>62 targets per learner <span>Knowledge · Skills · Behaviours</span></p></div>
          <div className={`${styles.metric} ${styles.lilac}`}><div className={styles.metricTop}><span>Learners needing support</span><AppIcon name="ri-notification-3-line" /></div><strong>1<em> / 3</em></strong><p>One overdue demo scenario <button type="button" onClick={() => setDetails(DEMO_LEARNERS[2])}>Review learner <AppIcon name="ri-arrow-right-line" /></button></p></div>
        </div>
        <div className={styles.overviewGrid}><div className={styles.mainColumn}>
          <div className={styles.programmeBanner}><span className={styles.programmeIcon}><AppIcon name="ri-graduation-cap-line" size={25} /></span><div><p className={styles.eyebrow}>ACTIVE DEMONSTRATION PROGRAMME</p><h2>{DEMO_PROGRAMME.name}</h2><p>850 planned hours · 4 modules · 62 KSBs</p></div><button type="button" className={styles.secondaryButton} onClick={() => go('modules')}>Explore programme <AppIcon name="ri-arrow-right-line" /></button></div>
          {learnersTable}
          <section className={styles.journey}><div><p className={styles.eyebrow}>FROM LEARNING TO HR</p><h2>A clear path. Every step visible.</h2></div><div className={styles.journeySteps}>{[['01', 'LMS learning', 'Hours, progress & KSB evidence'], ['02', 'Review & match', 'Confirm the right HR employee'], ['03', 'HR training record', 'Send supported fields & summary']].map(([step, title, text]) => <div key={step}><span>{step}</span><strong>{title}</strong><p>{text}</p></div>)}</div></section>
        </div><aside className={styles.sideColumn}>
          <section className={`${styles.panel} ${styles.providerCard}`}><div className={styles.providerHeading}><span className={styles.providerLogo}>b</span><div><h2>Breathe HR</h2><p>Training record delivery</p></div><Badge tone="gold">Not sent</Badge></div><p>Your people data meets your learning data. Preview the programme summary before mapping it to an HR record.</p><div className={styles.providerStats}><div><strong>3</strong><span>Demo drafts</span></div><div><strong>0</strong><span>Sent from this UI</span></div></div><button type="button" className={styles.primaryButton} onClick={() => go('requests')}>Review training requests <AppIcon name="ri-arrow-right-line" /></button><button type="button" className={styles.textButton} onClick={() => go('connections')}>Check actual connection <AppIcon name="ri-external-link-line" /></button></section>
          <section className={styles.panel}><div className={styles.panelHeading}><h2>Needs your attention</h2><Badge tone="danger">2 demo alerts</Badge></div><button type="button" className={styles.alertItem} onClick={() => setDetails(DEMO_LEARNERS[2])}><span className={styles.alertIcon}><AppIcon name="ri-error-warning-line" /></span><span><strong>Programme follow-up needed</strong><p>Demo Learner 03 · 30% complete<br />43 KSBs still pending</p><small>Overdue at the demo date</small></span><AppIcon name="ri-arrow-right-s-line" /></button><button type="button" className={styles.alertItem} onClick={() => setDetails(DEMO_LEARNERS[0])}><span className={`${styles.alertIcon} ${styles.gold}`}><AppIcon name="ri-time-line" /></span><span><strong>Review additional learning time</strong><p>Demo Learner 01 · 900h actual<br />50h above the full plan</p><small>Completed · time variance only</small></span><AppIcon name="ri-arrow-right-s-line" /></button></section>
          <section className={styles.sampleCard}><AppIcon name="ri-award-line" size={28} /><h3>Make achievement visible.</h3><p>Preview a branded sample certificate for the completed demo learner.</p><button type="button" className={styles.textButton} onClick={() => setCertificate(true)}>View sample certificate <AppIcon name="ri-arrow-right-line" /></button></section>
        </aside></div>
      </>}

      {view === 'modules' && <section className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>PROGRAMME → MODULES → LEARNER</p><h2>{DEMO_PROGRAMME.name}</h2><p className={styles.muted}>150h + 200h + 250h + 250h = 850h per learner</p></div><Badge tone="gold">Illustrative training plan</Badge></div><label className={styles.field}>View learner<select value={selectedLearner} onChange={event => setSelectedLearner(event.target.value)}>{DEMO_LEARNERS.map(learner => <option key={learner.id} value={learner.id}>{learner.name}</option>)}</select></label><ModuleTable learner={selected} /><div className={styles.moduleCards}>{DEMO_MODULES.map((module, index) => <article key={module.id}><span className={styles.eyebrow}>MODULE 0{index + 1}</span><h3>{module.name}</h3><strong>{module.plannedHours}<small> planned hours</small></strong><Progress value={selected.progressByModule[index]} /><p>{selected.actualHoursByModule[index]}h actual · {moduleAchievement(selected, index)} / {module.ksbCodes.length} KSBs achieved</p></article>)}</div><p className={styles.muted}>Module hours add to the programme total. Programme learning completion is weighted by module planned hours; KSBs use distinct achieved codes.</p></section>}

      {view === 'requests' && <section className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>LMS → BREATHE</p><h2>Review before delivery</h2><p className={styles.muted}>Three synthetic previews. No queue entry, employee record or training record is created.</p></div><Badge tone="gold">Preview only</Badge></div><div className={styles.warning}><strong>Employee matching and API verification required</strong><p>Hours, learning completion and KSBs are proposed as a training notes summary. They are not assumed to be native writable API fields. A sample certificate is not an issued file or a live link.</p></div><div className={styles.requestList}>{DEMO_LEARNERS.map(learner => <article key={learner.id}><div className={styles.person}><span className={styles.avatar}>{learner.initials}</span><div><strong>{learner.name}</strong><small>{DEMO_PROGRAMME.name}</small></div><Badge>Draft preview</Badge></div><div className={styles.requestFacts}><span><strong>850h / {actualHours(learner)}h</strong>Planned / actual</span><span><strong>{learningProgress(learner)}%</strong>Learning completion</span><span><strong>{learner.achievedKsbCodes.length} / 62</strong>KSBs achieved</span></div><div className={styles.actions}><button className={styles.secondaryButton} type="button" onClick={() => setDraft(learner)}>Inspect summary <AppIcon name="ri-file-search-line" /></button><span className={styles.muted}>Not matched · Not sent</span></div></article>)}</div></section>}

      {view === 'certificates' && <section className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>RECOGNISE ACHIEVEMENT</p><h2>A certificate worth sharing</h2><p className={styles.muted}>Uses the existing KBC certificate design. Presentation sample only.</p></div><Badge tone="gold">Not issued</Badge></div><div className={styles.certificateIntro}><AppIcon name="ri-award-line" size={60} /><div><h3>Demo Learner 01</h3><p>100% learning completion · 62 / 62 KSBs · 900h actual</p><p>No certificate has been issued, uploaded or sent to Breathe.</p><button type="button" className={styles.primaryButton} onClick={() => setCertificate(true)}>Preview branded sample</button></div></div></section>}
      {view === 'connections' && <Connections />}
      <footer className={styles.footer}><span><span className={styles.brandDot} /> KBC · HR System</span><span>Demonstration workspace · learning data remains in the LMS</span></footer>
    </div>
    {details && <LearnerDetails learner={details} onClose={closeDetails} />}
    {draft && <Dialog title={`Training preview · ${draft.name}`} onClose={closeDraft}><Badge tone="gold">Unsent · no employee mapping</Badge><p className={styles.muted}>Match the employee and select a Breathe training type before this summary can become an HR record.</p><div className={styles.code}>{trainingDraft(draft).notes.split('\n').map(line => <p key={line}>{line}</p>)}</div></Dialog>}
    {certificate && <Dialog title="Sample certificate · not issued" onClose={closeCertificate}><div className={styles.warning}><strong>DEMO ONLY — NOT A VALID CERTIFICATE</strong><p>Fictional learner and programme results. No verification link or HR upload.</p></div><div className={styles.certificate}><CertificateDocument title="SAMPLE CERTIFICATE" bodyText="This presentation sample illustrates programme achievement for a fictional learner." learnerName="Demo Learner 01" programmeName={DEMO_PROGRAMME.name} progressLabel="Demo: 100% learning · 62/62 KSBs" layoutConfig={{ primaryColor: '#30134d', accentColor: '#c89f4a', decorationStyle: 'executive', logoUrl: '/kbc-logo.png', showQr: false, showAwardDate: false, showCertificateNumber: false, showInstructor: false, footerText: 'DEMONSTRATION ONLY · NOT ISSUED' }} /></div></Dialog>}
  </WorkspaceShell></div>;
}
