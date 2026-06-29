import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface TestQuestion {
  id: string;
  stem: string;
  type: string;
  difficulty: string;
  ksbRef: string;
  bank: string;
  programme: string;
  usage: number;
  lastUsed: string;
}

const TEST_BANKS = [
  { name: 'Business Admin — Core Knowledge', programme: 'Business Admin L3', questions: 145, active: 120, draft: 18, retired: 7, lastUpdated: '4 Jun 2026', coverage: 92 },
  { name: 'Business Admin — Skills Assessment', programme: 'Business Admin L3', questions: 98, active: 85, draft: 10, retired: 3, lastUpdated: '2 Jun 2026', coverage: 78 },
  { name: 'Data Analyst — Statistical Methods', programme: 'Data Analyst L4', questions: 132, active: 110, draft: 15, retired: 7, lastUpdated: '5 Jun 2026', coverage: 88 },
  { name: 'Data Analyst — Data Visualisation', programme: 'Data Analyst L4', questions: 87, active: 72, draft: 12, retired: 3, lastUpdated: '1 Jun 2026', coverage: 74 },
  { name: 'Marketing Exec — Campaign Planning', programme: 'Marketing Exec L4', questions: 76, active: 68, draft: 8, retired: 0, lastUpdated: '28 May 2026', coverage: 82 },
  { name: 'Marketing Exec — Digital Channels', programme: 'Marketing Exec L4', questions: 64, active: 55, draft: 6, retired: 3, lastUpdated: '25 May 2026', coverage: 70 },
];

const QUESTIONS: TestQuestion[] = [
  { id: 'q-101', stem: 'Which of the following best describes the Shannon-Weaver communication model?', type: 'Multiple Choice', difficulty: 'Medium', ksbRef: 'K1', bank: 'Business Admin — Core Knowledge', programme: 'Business Admin L3', usage: 4, lastUsed: '5 Jun 2026' },
  { id: 'q-102', stem: 'List three barriers to effective communication in a remote workplace.', type: 'Short Answer', difficulty: 'Easy', ksbRef: 'K2', bank: 'Business Admin — Core Knowledge', programme: 'Business Admin L3', usage: 3, lastUsed: '3 Jun 2026' },
  { id: 'q-103', stem: 'Explain the difference between formal and informal communication channels.', type: 'Essay', difficulty: 'Hard', ksbRef: 'K3', bank: 'Business Admin — Core Knowledge', programme: 'Business Admin L3', usage: 2, lastUsed: '1 Jun 2026' },
  { id: 'q-104', stem: 'What is the primary purpose of a Pareto chart in data analysis?', type: 'Multiple Choice', difficulty: 'Medium', ksbRef: 'K10', bank: 'Data Analyst — Data Visualisation', programme: 'Data Analyst L4', usage: 3, lastUsed: '4 Jun 2026' },
  { id: 'q-105', stem: 'Calculate the standard deviation for the dataset: [12, 15, 18, 22, 25]', type: 'Calculation', difficulty: 'Hard', ksbRef: 'S11', bank: 'Data Analyst — Statistical Methods', programme: 'Data Analyst L4', usage: 2, lastUsed: '2 Jun 2026' },
  { id: 'q-106', stem: 'Define market segmentation and explain its importance.', type: 'Essay', difficulty: 'Medium', ksbRef: 'K5', bank: 'Marketing Exec — Campaign Planning', programme: 'Marketing Exec L4', usage: 4, lastUsed: '5 Jun 2026' },
  { id: 'q-107', stem: 'Which digital channel typically has the highest conversion rate for B2B marketing?', type: 'Multiple Choice', difficulty: 'Easy', ksbRef: 'K7', bank: 'Marketing Exec — Digital Channels', programme: 'Marketing Exec L4', usage: 3, lastUsed: '1 Jun 2026' },
  { id: 'q-108', stem: 'Match each agile ceremony with its correct purpose.', type: 'Matching', difficulty: 'Medium', ksbRef: 'S14', bank: 'Business Admin — Skills Assessment', programme: 'Business Admin L3', usage: 1, lastUsed: '28 May 2026' },
];

export default function TestBanksPage() {
  const [selectedBank, setSelectedBank] = useState<string | null>(TEST_BANKS[0].name);
  const [filterDifficulty, setFilterDifficulty] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const bank = TEST_BANKS.find(b => b.name === selectedBank);
  const bankQuestions = QUESTIONS.filter(q => q.bank === selectedBank);
  const filteredQs = bankQuestions.filter(q => {
    if (filterDifficulty !== 'all' && q.difficulty !== filterDifficulty) return false;
    if (filterType !== 'all' && q.type !== filterType) return false;
    return true;
  });

  const totalQs = TEST_BANKS.reduce((s, b) => s + b.questions, 0);
  const totalActive = TEST_BANKS.reduce((s, b) => s + b.active, 0);
  const avgCoverage = Math.round(TEST_BANKS.reduce((s, b) => s + b.coverage, 0) / TEST_BANKS.length);

  const diffColors: Record<string, string> = {
    'Easy': 'bg-emerald-100 text-emerald-700',
    'Medium': 'bg-amber-100 text-amber-700',
    'Hard': 'bg-red-100 text-red-700',
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Test Banks" pageSubtitle="Centralised question repository — manage, tag and reuse questions across programmes" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-database-2-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Test Banks</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{TEST_BANKS.length} banks</strong> containing <strong>{totalQs} questions</strong>. {totalActive} active, avg {avgCoverage}% KSB coverage.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{TEST_BANKS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Banks</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{totalQs}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Questions</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{avgCoverage}%</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Coverage</p></div>
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Bank List */}
          <div className="w-[300px] shrink-0 space-y-2">
            <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-1">Question Banks</h4>
            {TEST_BANKS.map(b => (
              <button key={b.name} onClick={() => setSelectedBank(b.name)} className={`w-full text-left p-3 rounded-xl border transition-smooth cursor-pointer ${selectedBank === b.name ? 'border-primary-300 bg-primary-50/50' : 'border-foreground-200/60 bg-background-50 hover:bg-background-100/50'}`}>
                <p className="text-[13px] font-semibold text-foreground-900 mb-1">{b.name}</p>
                <p className="text-[10px] text-foreground-400">{b.programme}</p>
                <div className="flex items-center gap-3 mt-2 text-[10px]">
                  <span className="text-emerald-600 font-medium">{b.active} active</span>
                  <span className="text-amber-600 font-medium">{b.draft} draft</span>
                  <span className="text-red-500 font-medium">{b.retired} retired</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 bg-background-200 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-primary-500" style={{ width: `${b.coverage}%` }}></div>
                  </div>
                  <span className="text-[10px] text-foreground-400">{b.coverage}%</span>
                </div>
              </button>
            ))}
          </div>

          {/* Questions Table */}
          <div className="flex-1 min-w-0">
            {bank && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">{bank.name}</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{bank.questions} questions · Last updated {bank.lastUpdated}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> Add Question</button>
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-upload-cloud-line mr-1"></i> Import</button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
                    {['all', 'Easy', 'Medium', 'Hard'].map(d => (
                      <button key={d} onClick={() => setFilterDifficulty(d)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterDifficulty === d ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{d === 'all' ? 'All' : d}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
                    {['all', 'Multiple Choice', 'Short Answer', 'Essay', 'Calculation', 'Matching'].map(t => (
                      <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterType === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{t === 'all' ? 'All Types' : t}</button>
                    ))}
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                  <div className="divide-y divide-background-200/30">
                    {filteredQs.map(q => (
                      <div key={q.id} className="p-3.5 hover:bg-background-100/30 transition-smooth cursor-pointer">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-foreground-900">{q.stem}</p>
                            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-1.5">
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${diffColors[q.difficulty]}`}>{q.difficulty}</span>
                              <span className="text-[10px] text-foreground-400">{q.type}</span>
                              <span className="text-[8px] text-foreground-300">&middot;</span>
                              <span className="text-[10px] font-medium text-secondary-600 bg-secondary-50 px-1.5 py-0.5 rounded">{q.ksbRef}</span>
                              <span className="text-[8px] text-foreground-300">&middot;</span>
                              <span className="text-[10px] text-foreground-400">Used {q.usage}x</span>
                              <span className="text-[8px] text-foreground-300">&middot;</span>
                              <span className="text-[10px] text-foreground-400">{q.lastUsed}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-primary-100 hover:text-primary-600 transition-smooth cursor-pointer"><i className="ri-edit-line text-xs"></i></button>
                            <button className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-secondary-100 hover:text-secondary-600 transition-smooth cursor-pointer"><i className="ri-file-copy-line text-xs"></i></button>
                            <button className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-smooth cursor-pointer"><i className="ri-delete-bin-line text-xs"></i></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {filteredQs.length === 0 && (
                    <div className="text-center py-12 text-foreground-400">
                      <i className="ri-database-2-line text-3xl mb-2 block"></i>
                      <p className="text-[12px]">No questions match the current filters</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}