import { useState } from 'react';
import { BarChart3, BookOpen, CalendarDays, CalendarCheck, ChevronDown, Clock3, FileText, Info, Lightbulb, PenLine, Search, Target, Ticket, Upload, UserCheck, Users, type LucideIcon } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { roleNavMap } from '@/mocks/navigation';
import { coachInfoSources } from './sources';
import styles from './infoSource.module.css';

const nav = roleNavMap.coach;
const sections = [...new Set(coachInfoSources.map(topic => topic.section))];
const icons: Record<string, LucideIcon> = {
  caseload: Users, dates: CalendarDays, otjh: Clock3, activities: BarChart3,
  snapshot: FileText, reviews: Target, 'imported-reviews': Upload, calendar: CalendarCheck,
  attendance: UserCheck, marking: FileText, 'monthly-logs': PenLine, support: Ticket,
};

export default function CoachInfoSource() {
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ caseload: true });
  const query = search.trim().toLowerCase();
  const topics = coachInfoSources.filter(topic =>
    (section === 'all' || topic.section === section)
    && [topic.title, topic.section, topic.description, topic.explanation, ...topic.references,
      ...topic.sources.flatMap(source => [source.table, source.fields, source.purpose, source.database ?? 'LMS database']),
    ].join(' ').toLowerCase().includes(query));

  return (
    <WorkspaceShell role="coach" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel}
      pageTitle="Info Source" pageSubtitle="A reference to the data behind the coach workspace">
      <PageContainer className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.heroIcon}><BookOpen size={30} aria-hidden="true" /></span>
          <div className={styles.heroText}>
            <h1>Info Source</h1>
            <p>Understand where the data in your coach workspace comes from, including source tables and key fields.</p>
          </div>
          <aside className={styles.tip}>
            <Lightbulb size={25} aria-hidden="true" />
            <p>Explore the sources behind dashboard metrics, reports and calculations.</p>
          </aside>
        </header>

        <section className={styles.guide} aria-labelledby="info-source-guide">
          <Info size={23} aria-hidden="true" />
          <div>
            <h2 id="info-source-guide">How to use this page</h2>
            <p>Each section describes a data source, its key fields and how it is used. Expand a topic to view the details and code references.</p>
            <p>This is a read-only reference, with no live learner records.</p>
            <details className={styles.identity}>
              <summary>Understanding learner IDs</summary>
              <p><code>"Learner".learners.id</code> is the profile ID; <code>learners.enrolment_id</code> links to <code>enrolment."Created_users".id</code>.
                {' '}Check each table’s meaning of <code>learner_id</code>. Table and field names are case-sensitive.</p>
            </details>
          </div>
        </section>

        <div className={styles.filters}>
          <div className={styles.search}>
            <label htmlFor="info-source-search" className="sr-only">Search topics, tables or fields</label>
            <Search size={18} aria-hidden="true" />
            <input id="info-source-search" type="search" value={search} onChange={event => setSearch(event.target.value)}
              placeholder="Search data sources (e.g. learner, attendance, coaching...)" />
          </div>
          <div className={styles.category}>
            <label htmlFor="info-source-section">Category</label>
            <select id="info-source-section" value={section} onChange={event => setSection(event.target.value)}>
              <option value="all">All categories</option>
              {sections.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <p role="status" className={styles.count}>{topics.length}{topics.length !== coachInfoSources.length ? ` of ${coachInfoSources.length}` : ''} data sources</p>
        </div>

        <div className={styles.topics}>
          {topics.length === 0 ? (
            <div className={styles.empty}>
              <Search size={26} aria-hidden="true" />
              <h2>No matching topics</h2>
              <p>Try another topic, table or field, or clear the filters.</p>
              <button type="button" onClick={() => { setSearch(''); setSection('all'); }}>Clear filters</button>
            </div>
          ) : topics.map(topic => {
            const Icon = icons[topic.id] ?? FileText;
            const isExpanded = Boolean(expanded[topic.id]);
            return (
              <article key={topic.id} className={styles.card} aria-labelledby={`topic-${topic.id}`}>
                <div className={styles.cardHeader}>
                  <span className={styles.topicIcon}><Icon size={25} aria-hidden="true" /></span>
                  <span className={styles.number} aria-hidden="true">{coachInfoSources.indexOf(topic) + 1}</span>
                  <div className={styles.topicText}>
                    <div className={styles.titleRow}>
                      <h2 id={`topic-${topic.id}`}>{topic.title}</h2>
                      <span className={styles.badge}>{topic.section}</span>
                    </div>
                    <p>{topic.description}</p>
                  </div>
                  <button type="button" className={styles.toggle} aria-expanded={isExpanded}
                    aria-controls={`source-details-${topic.id}`} aria-label={`${isExpanded ? 'Hide' : 'View'} details for ${topic.title}`}
                    onClick={() => setExpanded(current => ({ ...current, [topic.id]: !current[topic.id] }))}>
                    <span>{isExpanded ? 'Hide details' : 'View details'}</span><ChevronDown size={19} aria-hidden="true" />
                  </button>
                </div>
                <div id={`source-details-${topic.id}`} hidden={!isExpanded} className={styles.details}>
                  <div className={styles.tableWrap}>
                    <table className={styles.sourceTable}>
                      <caption className="sr-only">Source tables and key fields for {topic.title}</caption>
                      <thead><tr><th scope="col">Source table</th><th scope="col">Key fields</th></tr></thead>
                      <tbody>{topic.sources.map(source => (
                        <tr key={source.table}>
                          <th scope="row">
                            <code className={styles.tableName}>{source.table}</code>
                            <p>{source.purpose}</p>
                            {source.database && <span className={styles.database}>{source.database}</span>}
                          </th>
                          <td><div className={styles.fields}>{source.fields.split(', ').map(field => <code key={field}>{field}</code>)}</div></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className={styles.usage}><Info size={17} aria-hidden="true" /><p>{topic.explanation}</p></div>
                  <details className={styles.references}>
                    <summary>Code references</summary>
                    <ul>{topic.references.map(reference => <li key={reference}><code>{reference}</code></li>)}</ul>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      </PageContainer>
    </WorkspaceShell>
  );
}
