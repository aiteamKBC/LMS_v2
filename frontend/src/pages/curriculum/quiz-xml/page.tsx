import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface QuizXml {
  id: string;
  title: string;
  module: string;
  programme: string;
  questions: number;
  version: string;
  status: 'published' | 'draft' | 'validating';
  lastBuilt: string;
  xmlSize: string;
  schemaValid: boolean;
  mappedComponents: number;
}

const QUIZZES: QuizXml[] = [
  { id: 'qx-01', title: 'Business Communication — Week 1 Quiz', module: 'Business Communication', programme: 'Business Admin L3', questions: 12, version: 'v2.1', status: 'published', lastBuilt: '5 Jun 2026', xmlSize: '24 KB', schemaValid: true, mappedComponents: 2 },
  { id: 'qx-02', title: 'Written Communication Assessment', module: 'Business Communication', programme: 'Business Admin L3', questions: 15, version: 'v1.8', status: 'published', lastBuilt: '3 Jun 2026', xmlSize: '31 KB', schemaValid: true, mappedComponents: 3 },
  { id: 'qx-03', title: 'Organisational Culture Checkpoint', module: 'Organisational Culture', programme: 'Business Admin L3', questions: 10, version: 'v1.5', status: 'draft', lastBuilt: '1 Jun 2026', xmlSize: '18 KB', schemaValid: true, mappedComponents: 1 },
  { id: 'qx-04', title: 'Data Visualisation — Tableau Basics', module: 'Data Visualisation', programme: 'Data Analyst L4', questions: 18, version: 'v2.0', status: 'published', lastBuilt: '4 Jun 2026', xmlSize: '42 KB', schemaValid: true, mappedComponents: 2 },
  { id: 'qx-05', title: 'Statistical Concepts Quiz', module: 'Statistical Analysis', programme: 'Data Analyst L4', questions: 20, version: 'v1.3', status: 'validating', lastBuilt: '28 May 2026', xmlSize: '45 KB', schemaValid: false, mappedComponents: 3 },
  { id: 'qx-06', title: 'Segmentation & Targeting Test', module: 'Marketing Planning', programme: 'Marketing Exec L4', questions: 14, version: 'v1.7', status: 'published', lastBuilt: '2 Jun 2026', xmlSize: '28 KB', schemaValid: true, mappedComponents: 2 },
  { id: 'qx-07', title: 'Digital Channels Assessment', module: 'Digital Channels', programme: 'Marketing Exec L4', questions: 16, version: 'v1.4', status: 'draft', lastBuilt: '25 May 2026', xmlSize: '33 KB', schemaValid: true, mappedComponents: 2 },
  { id: 'qx-08', title: 'Agile Development Fundamentals', module: 'Agile Development', programme: 'Software Dev L4', questions: 22, version: 'v0.9', status: 'draft', lastBuilt: '20 May 2026', xmlSize: '50 KB', schemaValid: false, mappedComponents: 4 },
];

export default function QuizXmlWorkspacePage() {
  const [selectedQuiz, setSelectedQuiz] = useState<QuizXml | null>(null);
  const [showXmlPreview, setShowXmlPreview] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = filterStatus === 'all' ? QUIZZES : QUIZZES.filter(q => q.status === filterStatus);
  const published = QUIZZES.filter(q => q.status === 'published').length;
  const draft = QUIZZES.filter(q => q.status === 'draft').length;
  const validationIssues = QUIZZES.filter(q => !q.schemaValid).length;

  const sampleXml = `<quiz id="qx-01" version="2.1">
  <metadata>
    <title>Business Communication — Week 1 Quiz</title>
    <module>M01 — Business Communication</module>
    <ksb_refs>K1 K2 K3</ksb_refs>
    <time_limit>20</time_limit>
    <pass_mark>70</pass_mark>
  </metadata>
  <questions>
    <question id="q1" type="multiple_choice" points="1">
      <stem>Which model describes communication as a linear process?</stem>
      <options>
        <option correct="true">Shannon-Weaver Model</option>
        <option correct="false">Schramm Model</option>
        <option correct="false">Berlo's SMCR Model</option>
        <option correct="false">Transactional Model</option>
      </options>
      <feedback>The Shannon-Weaver Model (1949) is linear: Sender → Encoder → Channel → Decoder → Receiver</feedback>
    </question>
    <!-- ... -->
  </questions>
</quiz>`;

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Quiz XML Workspace" pageSubtitle="Build, validate and publish SCORM-compatible quiz XML packages" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-code-box-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Quiz XML Workspace</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{QUIZZES.length} quiz packages</strong> — {published} published, {draft} in draft. {validationIssues} with schema validation issues.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{QUIZZES.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Quizzes</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{QUIZZES.reduce((s, q) => s + q.questions, 0)}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Questions</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{published}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Published</p></div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {(['all', 'published', 'draft', 'validating'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterStatus === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> New Quiz XML</button>
          <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-upload-cloud-line mr-1"></i> Import SCORM</button>
        </div>

        <div className="flex gap-6">
          {/* Quiz List */}
          <div className="flex-1 min-w-0">
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                <span>Quiz</span>
                <span>Version</span>
                <span className="text-center">Questions</span>
                <span className="text-center">Size</span>
                <span className="text-center">Schema</span>
                <span className="text-center">Status</span>
                <span className="text-center">Action</span>
              </div>
              <div className="divide-y divide-background-200/30">
                {filtered.map(q => (
                  <div key={q.id} onClick={() => { setSelectedQuiz(q); setShowXmlPreview(false); }} className={`grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 items-center cursor-pointer transition-smooth ${selectedQuiz?.id === q.id ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : 'hover:bg-background-100/30'}`}>
                    <div>
                      <span className="text-[12px] font-medium text-foreground-900 block">{q.title}</span>
                      <span className="text-[10px] text-foreground-400">{q.module} · {q.programme}</span>
                    </div>
                    <span className="text-[11px] text-foreground-500">{q.version}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{q.questions}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{q.xmlSize}</span>
                    <div className="flex justify-center">
                      {q.schemaValid ? <i className="ri-checkbox-circle-line text-emerald-500 text-sm"></i> : <i className="ri-error-warning-line text-red-500 text-sm"></i>}
                    </div>
                    <div className="flex justify-center">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${q.status === 'published' ? 'bg-emerald-100 text-emerald-700' : q.status === 'validating' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'}`}>{q.status}</span>
                    </div>
                    <div className="flex justify-center gap-1">
                      <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Build</button>
                      <button className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-secondary-100 hover:text-secondary-600 transition-smooth cursor-pointer"><i className="ri-download-line text-xs"></i></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detail Panel */}
          {selectedQuiz && (
            <div className="w-[380px] shrink-0">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium sticky top-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-heading font-bold text-foreground-900">{selectedQuiz.title}</h4>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${selectedQuiz.status === 'published' ? 'bg-emerald-100 text-emerald-700' : selectedQuiz.status === 'validating' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'}`}>{selectedQuiz.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { l: 'Questions', v: String(selectedQuiz.questions) },
                    { l: 'Version', v: selectedQuiz.version },
                    { l: 'XML Size', v: selectedQuiz.xmlSize },
                    { l: 'Mapped Components', v: String(selectedQuiz.mappedComponents) },
                    { l: 'Schema Valid', v: selectedQuiz.schemaValid ? 'Yes' : 'No' },
                    { l: 'Last Built', v: selectedQuiz.lastBuilt },
                  ].map(s => (
                    <div key={s.l} className="bg-background-100/50 rounded-lg p-2.5">
                      <p className="text-[9px] text-foreground-400 uppercase tracking-wider">{s.l}</p>
                      <p className={`text-sm font-semibold ${s.l === 'Schema Valid' ? (selectedQuiz.schemaValid ? 'text-emerald-600' : 'text-red-600') : 'text-foreground-900'}`}>{s.v}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={() => setShowXmlPreview(!showXmlPreview)} className="flex-1 px-3 py-1.5 bg-background-100 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-100 hover:text-secondary-700 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className={`${showXmlPreview ? 'ri-eye-off-line' : 'ri-eye-line'} mr-1`}></i> {showXmlPreview ? 'Hide XML' : 'Preview XML'}
                  </button>
                  <button className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-edit-line mr-1"></i> Edit XML</button>
                </div>
                {showXmlPreview && (
                  <div className="bg-foreground-900 rounded-lg p-3 overflow-auto max-h-[350px]">
                    <pre className="text-[10px] text-emerald-300 font-mono leading-relaxed whitespace-pre">{sampleXml}</pre>
                  </div>
                )}
                {!selectedQuiz.schemaValid && (
                  <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-[10px] font-semibold text-red-700"><i className="ri-error-warning-line mr-1"></i> Schema Validation Errors</p>
                    <ul className="text-[10px] text-red-600 mt-1 space-y-0.5 list-disc list-inside">
                      <li>Missing required attribute: time_limit</li>
                      <li>Question q7: invalid type "matrix"</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}