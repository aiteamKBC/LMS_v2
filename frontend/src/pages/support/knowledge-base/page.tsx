import { useState, useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const supportConfig = roleNavMap.support;

const ARTICLES = [
  { id: 'kb-01', title: 'Evidence file upload fails — troubleshooting guide', category: 'Technical', excerpt: 'Common causes of evidence upload failures include file size limits, unsupported formats, CORS errors, and session timeouts. This guide walks through systematic diagnosis.', content: 'Step 1: Verify file is under 50MB limit. Step 2: Ensure file is PDF, PNG, JPG, DOCX, or MP4. Step 3: Clear browser cache. Step 4: Check browser console for CORS errors. Step 5: Verify user session is active. Step 6: Escalate to engineering if all steps pass.', tags: ['upload', 'evidence', 'error', 'CORS'], author: 'Ahmed Khalil', updated: '8 Jun 2026', usedCount: 34 },
  { id: 'kb-02', title: 'OTJH hours not accumulating — fix and explanation', category: 'Data Issue', excerpt: 'When OTJH hours are logged but not reflected in monthly totals, the issue is usually a cron job failure or a timezone mismatch in the aggregation query.', content: 'Check the OTJH aggregation cron job status in Admin > Automations. Verify learner timezone settings. Manually trigger recalculation for affected learners via the OTJH admin panel. If issue persists across multiple learners, check the aggregation stored procedure for date boundary errors.', tags: ['OTJH', 'hours', 'aggregation', 'cron'], author: 'Ahmed Khalil', updated: '5 Jun 2026', usedCount: 28 },
  { id: 'kb-03', title: 'Employer DocuSign "Session Expired" error resolution', category: 'Integration', excerpt: 'The DocuSign session expired error occurs when the integration token has not been refreshed. This is a known issue with long-lived signing sessions.', content: '1. Ask employer to log out and log back in. 2. If still failing, regenerate DocuSign token from Admin > Integrations > DocuSign. 3. Verify the employer account has a valid email matching their DocuSign account. 4. For urgent cases, use the manual signing workflow bypass.', tags: ['DocuSign', 'employer', 'signing', 'session'], author: 'Layla Moussa', updated: '3 Jun 2026', usedCount: 22 },
  { id: 'kb-04', title: 'WhatsApp notification delivery failures — diagnosis', category: 'Notifications', excerpt: 'WhatsApp Business API delivery failures typically stem from template approval status, phone number verification, or rate limiting.', content: 'Check WhatsApp Business API dashboard for template status (must be APPROVED). Verify recipient phone number is correct with country code. Check rate limits: 250 msgs/second for utility templates. If template was recently updated, allow 24h for Meta re-approval.', tags: ['WhatsApp', 'notifications', 'templates', 'delivery'], author: 'Ahmed Khalil', updated: '1 Jun 2026', usedCount: 19 },
  { id: 'kb-05', title: 'Coach dashboard blank after learner allocation', category: 'Bug Report', excerpt: 'A blank coach dashboard after MIS allocates new learners is caused by the client-side cache not invalidating after the allocation API call.', content: 'Instruct the coach to hard-refresh (Ctrl+Shift+R). If still blank, clear the coach user session cache via Admin > Users > [Coach Name] > Clear Cache. As a platform fix, ensure the allocation API triggers a cache-bust header on the coach dashboard endpoint.', tags: ['coach', 'dashboard', 'cache', 'allocation'], author: 'David Osei', updated: '28 May 2026', usedCount: 17 },
  { id: 'kb-06', title: 'AI marking incorrectly rejecting valid evidence — what to do', category: 'Complaint', excerpt: 'When AI marking produces false negatives on valid evidence, follow this escalation and override process while maintaining audit integrity.', content: '1. Do NOT override the AI result in the learner view — this loses audit trail. 2. Navigate to QA > Evidence QA and mark the evidence as "Coach Override — False Negative". 3. Attach coach justification note. 4. Flag in AI Settings for model feedback. 5. Inform learner that evidence has been manually approved.', tags: ['AI', 'marking', 'false-negative', 'evidence', 'override'], author: 'Nadia Hussain', updated: '25 May 2026', usedCount: 15 },
  { id: 'kb-07', title: 'Bulk user import CSV formatting requirements', category: 'Onboarding', excerpt: 'CSV imports fail silently when formatting rules are not met. This guide covers all required columns, encoding, and special character handling.', content: 'Required columns: first_name, last_name, email, role, tenant_code, programme_code (optional), start_date (YYYY-MM-DD). File must be UTF-8 encoded. Special characters in names (apostrophes, hyphens) must be properly escaped. Maximum 500 rows per import. Use the template from Admin > Bulk User Import.', tags: ['CSV', 'import', 'users', 'formatting'], author: 'Ahmed Khalil', updated: '22 May 2026', usedCount: 14 },
  { id: 'kb-08', title: 'QA sampling report generating blank PDF', category: 'Reporting', excerpt: 'Blank PDF exports from QA sampling are caused by empty result sets being passed to the PDF renderer without a fallback message.', content: 'Verify the selected date range and filters return results on the screen first. If screen shows data but PDF is blank, clear the report cache via Admin > System > Clear Report Cache. For April 2026 specifically, check if the cohort had any QA samples — some cohorts had zero samples that month.', tags: ['PDF', 'QA', 'sampling', 'blank', 'report'], author: 'Layla Moussa', updated: '20 May 2026', usedCount: 12 },
  { id: 'kb-09', title: 'Self-Paced attendance mode not appearing in dropdown', category: 'Technical', excerpt: 'Attendance modes are controlled by cohort-level configuration, not global settings. Missing modes indicate cohort config drift.', content: 'Navigate to MIS > Cohorts > [Cohort Name] > Settings > Attendance Modes. Verify "Self-Paced" is checked. If not present, add it via "Edit Attendance Modes". The change propagates to all learners in that cohort within 5 minutes.', tags: ['attendance', 'cohort', 'configuration', 'dropdown'], author: 'David Osei', updated: '18 May 2026', usedCount: 11 },
  { id: 'kb-10', title: 'Monthly coaching report template variables not resolving', category: 'Reporting', excerpt: 'When email templates show raw variable names like {LEARNER_NAME}, the Handlebars rendering pipeline has encountered a data binding failure.', content: 'Check that the template variable names match exactly (case-sensitive) with the data model fields. Common mistake: {LEARNER_NAME} should be {{learner.full_name}}. Verify the template is using the correct Handlebars syntax (double braces). Test the template in Admin > Templates > Preview with a sample learner record.', tags: ['template', 'variables', 'email', 'Handlebars'], author: 'Ahmed Khalil', updated: '15 May 2026', usedCount: 9 },
  { id: 'kb-11', title: 'Learner unable to view training plan after enrolment', category: 'Data Issue', excerpt: 'Training plan visibility depends on enrolment status, ILR submission, and coach assignment all being complete.', content: 'Verify: 1) Enrolment status is "Active" in Compliance > Enrolment Review. 2) ILR record has been submitted for this learner. 3) A coach has been assigned in MIS > Coach Assignment. 4) The programme has published modules. If all pass, manually trigger "Publish Training Plan" from the learner profile page.', tags: ['training-plan', 'enrolment', 'ILR', 'coach'], author: 'Layla Moussa', updated: '12 May 2026', usedCount: 7 },
  { id: 'kb-12', title: 'Employer satisfaction survey link broken in emails', category: 'Bug Report', excerpt: 'Automated survey links pointing to old URLs need updating in the notification template and email configuration simultaneously.', content: 'Update the survey base URL in two places: 1) Admin > Notifications > Templates > "Employer Satisfaction Survey" — update the href. 2) Admin > System > Platform URLs > "Survey Base URL". After updating, send a test email to verify. Old emails already sent will have broken links — re-send from the employer record page.', tags: ['survey', 'email', 'links', 'URL'], author: 'Ahmed Khalil', updated: '10 May 2026', usedCount: 5 },
];

const CATEGORIES_LIST = ['All', 'Technical', 'Data Issue', 'Integration', 'Notifications', 'Bug Report', 'Complaint', 'Onboarding', 'Reporting'];

export default function SupportKnowledgeBase() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedArticle, setSelectedArticle] = useState<typeof ARTICLES[0] | null>(null);

  const filtered = useMemo(() => {
    return ARTICLES.filter(a => {
      const matchCat = activeCategory === 'All' || a.category === activeCategory;
      const matchSearch = !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.excerpt.toLowerCase().includes(search.toLowerCase()) || a.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
      return matchCat && matchSearch;
    });
  }, [search, activeCategory]);

  return (
    <WorkspaceShell
      role="support"
      roleLabel={supportConfig.label}
      navItems={supportConfig.items}
      pageTitle="Knowledge Base"
      pageSubtitle={`${ARTICLES.length} articles · search and browse common resolutions`}
      userName="Ahmed Khalil"
      userRole="Senior Support Lead"
      workspaceLabel={supportConfig.workspaceLabel}
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Search */}
        <div className="relative">
          <AppIcon className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-300 text-base"></AppIcon>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search articles by title, content, or tags..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none transition-smooth"
          />
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES_LIST.map(cat => (
            <button
              key={cat}
              onClick={() => { setActiveCategory(cat); setSelectedArticle(null); }}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${
                activeCategory === cat ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-600 hover:bg-background-200'
              }`}
            >
              {cat}
            </button>
          ))}
          <span className="text-[11px] text-foreground-400 ml-2">{filtered.length} article{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Article List */}
          <div className="lg:col-span-2 space-y-2">
            {filtered.map(article => (
              <div
                key={article.id}
                onClick={() => setSelectedArticle(article === selectedArticle ? null : article)}
                className={`rounded-xl border p-4 cursor-pointer transition-smooth ${
                  selectedArticle?.id === article.id ? 'border-primary-300 bg-primary-50/30 ring-1 ring-primary-200/50' : 'bg-background-50 border-background-200/50 hover:border-background-300/60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center shrink-0 mt-0.5">
                    <AppIcon className="ri-book-read-line text-accent-600 text-sm"></AppIcon>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-semibold text-foreground-800">{article.title}</p>
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 whitespace-nowrap shrink-0">{article.category}</span>
                    </div>
                    <p className="text-[11px] text-foreground-500 mt-1 line-clamp-2 leading-relaxed">{article.excerpt}</p>
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      {article.tags.map(tag => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-md bg-background-100 text-foreground-400">{tag}</span>
                      ))}
                      <span className="text-[9px] text-foreground-300 ml-auto flex items-center gap-1">
                        <AppIcon className="ri-eye-line"></AppIcon> {article.usedCount}
                      </span>
                      <span className="text-[9px] text-foreground-300">{article.updated}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Article Detail */}
          <div>
            {selectedArticle ? (
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 md:p-5 sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{selectedArticle.category}</span>
                  <button
                    onClick={() => setSelectedArticle(null)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
                  >
                    <AppIcon className="ri-close-line text-xs"></AppIcon>
                  </button>
                </div>

                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">{selectedArticle.title}</h3>

                <div className="flex items-center gap-3 text-[10px] text-foreground-400 mb-4">
                  <span className="flex items-center gap-1"><AppIcon className="ri-user-line"></AppIcon> {selectedArticle.author}</span>
                  <span className="flex items-center gap-1"><AppIcon className="ri-time-line"></AppIcon> {selectedArticle.updated}</span>
                  <span className="flex items-center gap-1"><AppIcon className="ri-eye-line"></AppIcon> Used {selectedArticle.usedCount}×</span>
                </div>

                <div className="bg-background-100/70 rounded-lg p-3 mb-4">
                  <p className="text-[12px] text-foreground-700 leading-relaxed whitespace-pre-line">{selectedArticle.content}</p>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selectedArticle.tags.map(tag => (
                    <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-md bg-background-100 text-foreground-400">{tag}</span>
                  ))}
                </div>

                <div className="flex gap-2 pt-3 border-t border-background-100">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1">
                    <AppIcon className="ri-file-copy-line"></AppIcon> Copy to Ticket
                  </button>
                  <button className="px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1">
                    <AppIcon className="ri-pencil-line"></AppIcon> Edit
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-book-open-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-[13px] text-foreground-500">Select an article to read</p>
                <p className="text-[11px] text-foreground-300 mt-1">12 articles in the knowledge base</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}