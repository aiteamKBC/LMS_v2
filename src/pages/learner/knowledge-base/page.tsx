import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import {
  LEARNER_KB_CATEGORIES,
  LEARNER_KB_ARTICLES,
  LEARNER_KB_GLOSSARY,
  LEARNER_KB_QUICK_LINKS,
} from '@/mocks/learner-knowledge-base';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

export default function LearnerKnowledgeBase() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<typeof LEARNER_KB_ARTICLES[0] | null>(null);
  const [showGlossary, setShowGlossary] = useState(false);
  const [glossarySearch, setGlossarySearch] = useState('');

  const filteredArticles = useMemo(() => {
    return LEARNER_KB_ARTICLES.filter(a => {
      const matchCat = !activeCategory || a.category === activeCategory;
      const matchSearch = !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.excerpt.toLowerCase().includes(search.toLowerCase()) || a.content.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [search, activeCategory]);

  const filteredGlossary = useMemo(() => {
    if (!glossarySearch.trim()) return LEARNER_KB_GLOSSARY;
    const q = glossarySearch.toLowerCase();
    return LEARNER_KB_GLOSSARY.filter(g => g.term.toLowerCase().includes(q) || g.definition.toLowerCase().includes(q));
  }, [glossarySearch]);

  const featuredArticles = LEARNER_KB_ARTICLES.slice(0, 5);

  const activeCategoryData = activeCategory ? LEARNER_KB_CATEGORIES.find(c => c.id === activeCategory) : null;

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Knowledge Base"
      pageSubtitle="Everything you need to know about your apprenticeship — all in one place"
      userName={p.fullName}
      userRole={`${p.programme} ${p.programmeLevel} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-7">

        {/* ── Hero ── */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950) / 0.95) 0%, oklch(var(--primary-900) / 0.9) 35%, oklch(var(--accent-900) / 0.85) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-20" style={{ width: '55%', height: '28%', left: '-8%', top: '-8%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.35) 0%, transparent 70%)', filter: 'blur(50px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-10" style={{ width: '65%', height: '32%', right: '-12%', top: '12%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.25) 0%, transparent 70%)', filter: 'blur(45px)' }} />
          </div>
          <div className="relative p-5 md:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center gap-5">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                    <i className="ri-book-read-line text-white text-xl"></i>
                  </span>
                  <div>
                    <h1 className="text-lg md:text-xl font-heading font-bold text-white">Knowledge Base</h1>
                    <p className="text-sm text-white/70">{LEARNER_KB_ARTICLES.length} articles across {LEARNER_KB_CATEGORIES.length} topics — your complete apprenticeship reference</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowGlossary(true)}
                  className="px-4 py-2.5 bg-white/10 border border-white/20 text-white rounded-xl text-sm font-semibold hover:bg-white/20 transition-smooth cursor-pointer whitespace-nowrap backdrop-blur-sm flex items-center gap-2"
                >
                  <i className="ri-book-2-line"></i> Glossary
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="mt-5 relative max-w-2xl">
              <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-white/50 text-lg"></i>
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setSelectedArticle(null); }}
                placeholder="Search all articles by keyword, topic, or question..."
                className="w-full pl-11 pr-12 py-3.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:ring-2 focus:ring-white/10 outline-none transition-smooth"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-smooth cursor-pointer"
                >
                  <i className="ri-close-line text-sm"></i>
                </button>
              )}
            </div>

            {/* Quick stats */}
            <div className="flex flex-wrap gap-4 mt-5">
              {[
                { icon: 'ri-article-line', label: 'Articles', value: LEARNER_KB_ARTICLES.length },
                { icon: 'ri-stack-line', label: 'Categories', value: LEARNER_KB_CATEGORIES.length },
                { icon: 'ri-book-2-line', label: 'Glossary Terms', value: LEARNER_KB_GLOSSARY.length },
                { icon: 'ri-question-answer-line', label: 'Quick Links', value: LEARNER_KB_QUICK_LINKS.length },
              ].map(stat => (
                <div key={stat.label} className="flex items-center gap-2 text-white/80">
                  <i className={`${stat.icon} text-white/50 text-sm`}></i>
                  <span className="text-xs"><strong className="text-white font-semibold">{stat.value}</strong> {stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Category Grid ── */}
        {!search && !activeCategory && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-heading font-semibold text-foreground-900">Browse by Topic</h2>
                <p className="text-xs text-foreground-400 mt-0.5">Choose a category to explore articles</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {LEARNER_KB_CATEGORIES.map(cat => {
                const count = LEARNER_KB_ARTICLES.filter(a => a.category === cat.id).length;
                return (
                  <button
                    key={cat.id}
                    onClick={() => { setActiveCategory(cat.id); setSelectedArticle(null); }}
                    className="bg-background-50 rounded-xl border border-background-200/50 p-4 text-left hover:border-background-300/60 hover:bg-background-100/50 transition-smooth group cursor-pointer"
                  >
                    <span className={`w-10 h-10 rounded-xl ${cat.color} flex items-center justify-center mb-3`}>
                      <i className={`${cat.icon} text-lg`}></i>
                    </span>
                    <h3 className="text-[13px] font-semibold text-foreground-800 mb-1 group-hover:text-foreground-900 transition-smooth">{cat.name}</h3>
                    <p className="text-[11px] text-foreground-400 leading-relaxed line-clamp-2">{cat.description}</p>
                    <p className="text-[10px] text-foreground-300 mt-2 font-medium">{count} article{count !== 1 ? 's' : ''}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Category Header (when filtered) ── */}
        {activeCategory && activeCategoryData && (
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setActiveCategory(null); setSelectedArticle(null); }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer shrink-0"
            >
              <i className="ri-arrow-left-line text-sm"></i>
            </button>
            <span className={`w-10 h-10 rounded-xl ${activeCategoryData.color} flex items-center justify-center shrink-0`}>
              <i className={`${activeCategoryData.icon} text-lg`}></i>
            </span>
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground-900">{activeCategoryData.name}</h2>
              <p className="text-xs text-foreground-400">{activeCategoryData.description}</p>
            </div>
          </div>
        )}

        {/* ── Featured Articles (when nothing is filtered/searched) ── */}
        {!search && !activeCategory && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-heading font-semibold text-foreground-900">Essential Reading</h2>
                <p className="text-xs text-foreground-400 mt-0.5">Start here — the most important articles for every apprentice</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {featuredArticles.map((article, i) => {
                const cat = LEARNER_KB_CATEGORIES.find(c => c.id === article.category);
                return (
                  <div
                    key={article.id}
                    onClick={() => setSelectedArticle(article)}
                    className="bg-background-50 rounded-xl border border-background-200/50 p-4 hover:border-background-300/60 transition-smooth cursor-pointer group"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-[10px] font-bold text-foreground-300 w-5 h-5 rounded-full bg-background-100 flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          {cat && (
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md ${cat.color.replace('100', '50').replace('700', '600')}`}>
                              {cat.name}
                            </span>
                          )}
                          <span className="text-[9px] text-foreground-300">{article.readTime} min read</span>
                        </div>
                        <h3 className="text-[13px] font-semibold text-foreground-800 group-hover:text-foreground-900 transition-smooth leading-snug mb-1">{article.title}</h3>
                        <p className="text-[11px] text-foreground-400 leading-relaxed line-clamp-2">{article.excerpt}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Article Browser ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground-900">
                {search ? `Search Results` : activeCategory ? 'Articles' : 'All Articles'}
              </h2>
              <p className="text-xs text-foreground-400 mt-0.5">
                {filteredArticles.length} article{filteredArticles.length !== 1 ? 's' : ''} found
              </p>
            </div>
            {(search || activeCategory) && (
              <button
                onClick={() => { setSearch(''); setActiveCategory(null); setSelectedArticle(null); }}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium cursor-pointer"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Article list */}
            <div className="lg:col-span-2 space-y-2">
              {filteredArticles.map(article => {
                const cat = LEARNER_KB_CATEGORIES.find(c => c.id === article.category);
                return (
                  <div
                    key={article.id}
                    onClick={() => setSelectedArticle(selectedArticle?.id === article.id ? null : article)}
                    className={`rounded-xl border p-4 cursor-pointer transition-smooth group ${
                      selectedArticle?.id === article.id
                        ? 'border-primary-300 bg-primary-50/30 ring-1 ring-primary-200/50'
                        : 'bg-background-50 border-background-200/50 hover:border-background-300/60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`w-9 h-9 rounded-xl ${cat?.color || 'bg-background-100'} flex items-center justify-center shrink-0 mt-0.5`}>
                        <i className={`${cat?.icon || 'ri-file-text-line'} text-sm`}></i>
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {cat && (
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md ${cat.color.replace('100', '50').replace('700', '600')}`}>
                              {cat.name}
                            </span>
                          )}
                          <span className="text-[9px] text-foreground-300">{article.readTime} min read</span>
                        </div>
                        <h3 className="text-[13px] font-semibold text-foreground-800 group-hover:text-foreground-900 transition-smooth mb-1">{article.title}</h3>
                        <p className="text-[11px] text-foreground-400 leading-relaxed line-clamp-2">{article.excerpt}</p>
                      </div>
                      <i className={`${selectedArticle?.id === article.id ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300 shrink-0 mt-1 transition-smooth`}></i>
                    </div>
                  </div>
                );
              })}
              {filteredArticles.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-background-100 flex items-center justify-center mb-3">
                    <i className="ri-search-line text-foreground-300 text-xl"></i>
                  </div>
                  <p className="text-sm text-foreground-500 font-medium">No articles found</p>
                  <p className="text-xs text-foreground-400 mt-1">Try a different search term or browse by category</p>
                  <button
                    onClick={() => { setSearch(''); setActiveCategory(null); }}
                    className="mt-4 px-4 py-2 bg-background-100 text-foreground-600 rounded-xl text-sm font-semibold hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    Show all articles
                  </button>
                </div>
              )}
            </div>

            {/* Article Detail Panel */}
            <div>
              {selectedArticle ? (
                <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 md:p-5 sticky top-4">
                  <div className="flex items-center justify-between mb-3">
                    {(() => {
                      const cat = LEARNER_KB_CATEGORIES.find(c => c.id === selectedArticle.category);
                      return (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cat?.color || 'bg-background-100 text-foreground-500'}`}>
                          {cat?.name || selectedArticle.category}
                        </span>
                      );
                    })()}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          const idx = filteredArticles.findIndex(a => a.id === selectedArticle.id);
                          if (idx > 0) setSelectedArticle(filteredArticles[idx - 1]);
                        }}
                        disabled={filteredArticles.findIndex(a => a.id === selectedArticle.id) === 0}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <i className="ri-arrow-up-s-line text-xs"></i>
                      </button>
                      <button
                        onClick={() => {
                          const idx = filteredArticles.findIndex(a => a.id === selectedArticle.id);
                          if (idx < filteredArticles.length - 1) setSelectedArticle(filteredArticles[idx + 1]);
                        }}
                        disabled={filteredArticles.findIndex(a => a.id === selectedArticle.id) === filteredArticles.length - 1}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <i className="ri-arrow-down-s-line text-xs"></i>
                      </button>
                      <button
                        onClick={() => setSelectedArticle(null)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer ml-1"
                      >
                        <i className="ri-close-line text-xs"></i>
                      </button>
                    </div>
                  </div>

                  <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3 leading-snug">{selectedArticle.title}</h3>

                  <div className="flex items-center gap-3 text-[10px] text-foreground-400 mb-4">
                    <span className="flex items-center gap-1"><i className="ri-time-line"></i> {selectedArticle.readTime} min read</span>
                    <span className="flex items-center gap-1"><i className="ri-article-line"></i> Knowledge Base</span>
                  </div>

                  <div className="bg-background-100/70 rounded-lg p-3.5 mb-4">
                    <p className="text-[12px] text-foreground-700 leading-relaxed whitespace-pre-line">{selectedArticle.content}</p>
                  </div>

                  <div className="flex items-center gap-2 pt-3 border-t border-background-100">
                    <button className="text-xs text-foreground-400 hover:text-foreground-600 font-medium cursor-pointer flex items-center gap-1.5 transition-smooth">
                      <i className="ri-thumb-up-line"></i> Helpful
                    </button>
                    <button className="text-xs text-foreground-400 hover:text-foreground-600 font-medium cursor-pointer flex items-center gap-1.5 transition-smooth">
                      <i className="ri-thumb-down-line"></i> Not helpful
                    </button>
                    <span className="text-xs text-foreground-300 ml-auto">Still stuck?</span>
                    <button
                      onClick={() => nav('/learner/support?action=new-ticket')}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium cursor-pointer"
                    >
                      Create ticket
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-background-50 rounded-xl border border-background-200/50 p-6 text-center">
                  <div className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                    <i className="ri-book-open-line text-foreground-300 text-xl"></i>
                  </div>
                  <p className="text-[13px] text-foreground-500 font-medium">Select an article</p>
                  <p className="text-[11px] text-foreground-300 mt-1">Click any article to read it here</p>

                  {/* Quick links */}
                  <div className="mt-5 pt-4 border-t border-background-100 text-left">
                    <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide mb-2">Quick Links</p>
                    <div className="space-y-1">
                      {LEARNER_KB_QUICK_LINKS.map(link => (
                        <button
                          key={link.href}
                          onClick={() => nav(link.href)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-foreground-600 hover:bg-background-100 hover:text-foreground-800 transition-smooth cursor-pointer"
                        >
                          <i className={`${link.icon} text-foreground-400 text-sm`}></i>
                          {link.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Glossary Modal ── */}
        {showGlossary && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowGlossary(false)}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-2xl mx-4 shadow-2xl border border-background-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300 max-h-[75vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-background-200/50 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center">
                    <i className="ri-book-2-line text-accent-600 text-lg"></i>
                  </span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Apprenticeship Glossary</h3>
                    <p className="text-xs text-foreground-400">{LEARNER_KB_GLOSSARY.length} key terms defined</p>
                  </div>
                </div>
                <button onClick={() => setShowGlossary(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-sm"></i>
                </button>
              </div>

              {/* Glossary search */}
              <div className="px-6 py-3 border-b border-background-100 shrink-0">
                <div className="relative">
                  <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
                  <input
                    type="text"
                    value={glossarySearch}
                    onChange={e => setGlossarySearch(e.target.value)}
                    placeholder="Search glossary terms..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 placeholder:text-foreground-300 focus:border-primary-300 outline-none transition-smooth"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-3">
                  {filteredGlossary.map((item, i) => (
                    <div key={i} className="bg-background-50 rounded-lg border border-background-200/50 p-3.5">
                      <h4 className="text-sm font-semibold text-foreground-800 mb-1">{item.term}</h4>
                      <p className="text-[12px] text-foreground-500 leading-relaxed">{item.definition}</p>
                    </div>
                  ))}
                  {filteredGlossary.length === 0 && (
                    <div className="text-center py-8">
                      <i className="ri-search-line text-foreground-200 text-2xl mb-2"></i>
                      <p className="text-sm text-foreground-400">No glossary terms match your search</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}