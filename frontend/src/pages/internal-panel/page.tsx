import { useState, useCallback, useEffect } from 'react';
import {
  INTERNAL_PANEL_STATS,
  INTERNAL_PANEL_TILES,
  HOW_TO_STEPS,
  loadCustomPages,
  saveCustomPages,
  type CustomPage,
  type CustomPageField,
} from '@/mocks/internal-panel';
import { BrandLockup } from '@/components/BrandLockup';

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input', icon: 'ri-text' },
  { value: 'number', label: 'Number', icon: 'ri-number-1' },
  { value: 'date', label: 'Date Picker', icon: 'ri-calendar-line' },
  { value: 'select', label: 'Dropdown', icon: 'ri-arrow-down-s-line' },
  { value: 'checkbox', label: 'Checkbox', icon: 'ri-checkbox-line' },
  { value: 'textarea', label: 'Long Text', icon: 'ri-file-text-line' },
];

const COLORS = [
  { value: '#1B8A8C', label: 'Teal' },
  { value: '#6B8E23', label: 'Olive' },
  { value: '#D97A2E', label: 'Orange' },
  { value: '#4A6FA5', label: 'Blue' },
  { value: '#7B5EA7', label: 'Purple' },
  { value: '#C75B8E', label: 'Pink' },
  { value: '#4A5568', label: 'Slate' },
];

interface SubPageData {
  groupHeader: string;
  groupColor: string;
  tile: { label: string; id: string; icon: string; description: string };
  siblingTiles: { label: string; id: string; icon: string; description: string }[];
}

export default function InternalPanelPage() {
  // Layout
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Data
  const [customPages, setCustomPages] = useState<CustomPage[]>(() => loadCustomPages());
  const [showCustomPages, setShowCustomPages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Navigation
  const [currentView, setCurrentView] = useState<'grid' | 'sub-page' | 'custom-form'>('grid');
  const [subPageData, setSubPageData] = useState<SubPageData | null>(null);
  const [activeCustomPage, setActiveCustomPage] = useState<CustomPage | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ label: string; id: string }[]>([]);

  // Modals
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [howToModalOpen, setHowToModalOpen] = useState(false);
  const [createPageModalOpen, setCreatePageModalOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<CustomPage | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formIcon, setFormIcon] = useState('ri-file-text-line');
  const [formColor, setFormColor] = useState('#1B8A8C');
  const [formFields, setFormFields] = useState<CustomPageField[]>([
    { label: '', type: 'text' },
  ]);

  // Persist to localStorage whenever customPages change
  useEffect(() => {
    saveCustomPages(customPages);
  }, [customPages]);

  // Audio TTS
  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  // Filtering
  const filteredTiles = INTERNAL_PANEL_TILES.filter((group) => {
    const matchesHeader = group.header.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTile = group.tiles.some((tile) =>
      tile.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return matchesHeader || matchesTile;
  });

  // --- Sub-page navigation ---
  const openSubPage = (groupHeader: string, groupColor: string, tile: SubPageData['tile'], allTiles: SubPageData['siblingTiles']) => {
    setSubPageData({ groupHeader, groupColor, tile, siblingTiles: allTiles });
    setBreadcrumbs([{ label: groupHeader, id: groupHeader.toLowerCase() }]);
    setCurrentView('sub-page');
    setSearchQuery('');
  };

  const goBackToGrid = () => {
    setCurrentView('grid');
    setSubPageData(null);
    setBreadcrumbs([]);
  };

  const openCustomForm = (page: CustomPage) => {
    setActiveCustomPage(page);
    setBreadcrumbs([{ label: page.title, id: page.id }]);
    setCurrentView('custom-form');
  };

  // --- Create Page ---
  const openCreateModal = () => {
    setEditingPage(null);
    setFormTitle('');
    setFormDescription('');
    setFormCategory('');
    setFormIcon('ri-file-text-line');
    setFormColor('#1B8A8C');
    setFormFields([{ label: '', type: 'text' }]);
    setCreatePageModalOpen(true);
  };

  const openEditModal = (page: CustomPage) => {
    setEditingPage(page);
    setFormTitle(page.title);
    setFormDescription(page.description);
    setFormCategory(page.category);
    setFormIcon(page.icon);
    setFormColor(page.color);
    setFormFields(page.fields.map((f) => ({ ...f })));
    setCreatePageModalOpen(true);
  };

  const addField = () => {
    setFormFields((prev) => [...prev, { label: '', type: 'text' }]);
  };

  const removeField = (index: number) => {
    setFormFields((prev) => prev.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<CustomPageField>) => {
    setFormFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    );
  };

  const handleSavePage = (e: React.FormEvent) => {
    e.preventDefault();
    const validFields = formFields.filter((f) => f.label.trim() !== '');

    if (editingPage) {
      setCustomPages((prev) =>
        prev.map((p) =>
          p.id === editingPage.id
            ? { ...p, title: formTitle, description: formDescription, category: formCategory, icon: formIcon, color: formColor, fields: validFields }
            : p
        )
      );
    } else {
      const newPage: CustomPage = {
        id: `custom-${Date.now()}`,
        title: formTitle,
        description: formDescription,
        category: formCategory,
        icon: formIcon,
        color: formColor,
        fields: validFields,
      };
      setCustomPages((prev) => [...prev, newPage]);
      setShowCustomPages(true);
    }

    setCreatePageModalOpen(false);
    setEditingPage(null);
  };

  const handleDeletePage = (pageId: string) => {
    setCustomPages((prev) => prev.filter((p) => p.id !== pageId));
    if (activeCustomPage?.id === pageId) {
      goBackToGrid();
      setActiveCustomPage(null);
    }
  };

  // --- Render helpers ---
  const renderFieldTypeBadge = (type: CustomPageField['type']) => {
    const info: Record<string, { cls: string; label: string }> = {
      text: { cls: 'bg-blue-50 text-blue-700', label: 'Text' },
      number: { cls: 'bg-amber-50 text-amber-700', label: 'Number' },
      date: { cls: 'bg-emerald-50 text-emerald-700', label: 'Date' },
      select: { cls: 'bg-violet-50 text-violet-700', label: 'Select' },
      checkbox: { cls: 'bg-rose-50 text-rose-700', label: 'Checkbox' },
      textarea: { cls: 'bg-sky-50 text-sky-700', label: 'Long Text' },
    };
    const i = info[type] || { cls: 'bg-gray-50 text-gray-700', label: type };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${i.cls}`}>{i.label}</span>;
  };

  const renderFieldPreview = (field: CustomPageField) => {
    const baseClass = 'w-full h-9 px-3 rounded-lg border border-foreground-200 bg-background-50 text-[13px] text-foreground-700 focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-300/40 transition-smooth';
    switch (field.type) {
      case 'text':
        return <input type="text" placeholder={field.label} className={baseClass} readOnly />;
      case 'number':
        return <input type="number" placeholder={field.label} className={baseClass} readOnly />;
      case 'date':
        return <input type="date" className={baseClass} readOnly />;
      case 'select': {
        const opts = (field.options || 'Option 1,Option 2,Option 3').split(',').filter(Boolean);
        return (
          <select className={`${baseClass} cursor-pointer`} disabled>
            <option>{field.label}</option>
            {opts.map((o) => <option key={o}>{o.trim()}</option>)}
          </select>
        );
      }
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded border-foreground-200 accent-[#1B8A8C]" readOnly />
            <span className="text-[13px] text-foreground-700">{field.label}</span>
          </label>
        );
      case 'textarea':
        return <textarea rows={3} placeholder={field.label} className={`${baseClass} h-auto min-h-[80px] resize-none`} readOnly></textarea>;
      default:
        return <input type="text" placeholder={field.label} className={baseClass} readOnly />;
    }
  };

  // ────────────────── RENDER ──────────────────
  const renderSidebar = () => (
    <>
      <div
        className={`shrink-0 bg-[#4A5568] flex flex-col transition-all duration-300 ${
          sidebarOpen ? 'w-[52px]' : 'w-0 overflow-hidden'
        }`}
      >
        <button
          onClick={() => setSidebarOpen(false)}
          className="w-[52px] h-[52px] flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-smooth cursor-pointer"
          title="Close sidebar"
        >
          <AppIcon className="ri-close-line text-xl"></AppIcon>
        </button>

        <button
          onClick={() => { goBackToGrid(); setCurrentView('grid'); }}
          className="w-[52px] h-[52px] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-smooth cursor-pointer"
          title="Home Grid"
        >
          <AppIcon className="ri-apps-line text-lg"></AppIcon>
        </button>

        <button
          onClick={() => setShowCustomPages(!showCustomPages)}
          className={`w-[52px] h-[52px] flex items-center justify-center transition-smooth cursor-pointer ${showCustomPages ? 'text-white bg-white/10' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
          title="Custom Pages"
        >
          <AppIcon className="ri-file-add-line text-lg"></AppIcon>
        </button>

        <div className="flex-1"></div>

        <button className="w-[52px] h-[52px] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-smooth cursor-pointer">
          <AppIcon className="ri-logout-box-line text-lg"></AppIcon>
        </button>
      </div>

      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed left-0 top-1/2 -translate-y-1/2 w-[32px] h-[48px] bg-[#4A5568] rounded-r-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-[#5A6578] transition-smooth cursor-pointer shadow-md z-50"
        >
          <AppIcon className="ri-arrow-right-s-line text-lg"></AppIcon>
        </button>
      )}
    </>
  );

  const renderTopBar = () => (
    <div className="bg-white border-b border-[#e2e4e8] px-4 md:px-5 py-3 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <BrandLockup size="compact" />
        <div>
          <h1 className="text-sm font-heading font-semibold text-foreground-900">Internal Panel</h1>
          <p className="text-[10px] text-foreground-400">KBC LearningOS Administration Hub</p>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <button
          onClick={openCreateModal}
          className="hidden sm:flex items-center gap-1.5 text-[12px] font-medium text-white bg-[#1B8A8C] hover:bg-[#167a7c] px-3 py-2 rounded-lg transition-smooth cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-add-line text-sm"></AppIcon>
          Create Page
        </button>

        <div className="relative hidden sm:block">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search modules..."
            className="w-[180px] md:w-[240px] h-9 pl-9 pr-3 rounded-lg border border-foreground-200 bg-background-50 text-[13px] text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-300/40 transition-smooth"
          />
        </div>

        <button
          onClick={() => setHowToModalOpen(true)}
          className="hidden md:flex items-center gap-1.5 text-[12px] text-foreground-500 hover:text-foreground-700 transition-smooth cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-book-open-line text-sm"></AppIcon>
          How to use
        </button>

        <button className="w-9 h-9 rounded-full border border-background-200/50 flex items-center justify-center text-foreground-500 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer relative">
          <AppIcon className="ri-notification-3-line text-sm"></AppIcon>
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 border border-white"></span>
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="w-9 h-9 rounded-full bg-[#4A5568] flex items-center justify-center text-white text-xs font-semibold cursor-pointer hover:bg-[#3A4558] transition-smooth"
          >
            HM
          </button>

          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)}></div>
              <div className="absolute right-0 top-full mt-2 w-[200px] bg-white rounded-xl border border-foreground-200 shadow-xl shadow-black/10 z-50 py-1 overflow-hidden">
                <div className="px-3 py-2 border-b border-foreground-200/60">
                  <p className="text-[13px] font-semibold text-foreground-900">Hassan Mitchell</p>
                  <p className="text-[10px] text-foreground-400">System Administrator</p>
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); goBackToGrid(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-foreground-600 hover:bg-background-100 hover:text-foreground-900 transition-smooth cursor-pointer text-left"
                >
                  <AppIcon className="ri-settings-4-line text-sm text-foreground-400"></AppIcon>
                  Panel Settings
                </button>
                <div className="border-t border-foreground-200/60 my-1"></div>
                <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-foreground-500 hover:text-red-600 hover:bg-red-50 transition-smooth cursor-pointer text-left">
                  <AppIcon className="ri-logout-box-r-line text-sm text-foreground-400"></AppIcon>
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const renderStats = () => (
    <div className="px-4 md:px-5 py-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {INTERNAL_PANEL_STATS.map((stat, i) => (
          <div
            key={stat.label}
            className="bg-white rounded-lg border border-[#e2e4e8] p-3.5 animate-in fade-in slide-in-from-bottom-3 duration-400"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#4A5568]/10 text-[#4A5568]">
                <AppIcon className={`${stat.icon} text-xs`}></AppIcon>
              </span>
              <p className="text-[11px] text-foreground-400 font-medium">{stat.label}</p>
            </div>
            <p className="text-xl font-heading font-bold text-foreground-900">{stat.value}</p>
            <p className="text-[10px] text-foreground-400 mt-0.5">{stat.change}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCustomPagesSection = () => {
    if (!showCustomPages || customPages.length === 0) return null;
    return (
      <div className="px-4 md:px-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-heading font-semibold text-foreground-900">Custom Pages</h2>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1 text-[11px] font-medium text-[#1B8A8C] hover:text-[#167a7c] transition-smooth cursor-pointer"
          >
            <AppIcon className="ri-add-line"></AppIcon>
            Add New
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {customPages.map((page, i) => (
            <div
              key={page.id}
              className="bg-white rounded-lg border border-[#e2e4e8] p-4 hover:shadow-md hover:border-[#c8cdd4] transition-all duration-200 group animate-in fade-in slide-in-from-bottom-3 cursor-pointer"
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() => openCustomForm(page)}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${page.color}15` }}>
                  <AppIcon className={`${page.icon} text-lg`} style={{ color: page.color }}></AppIcon>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditModal(page); }}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer opacity-0 group-hover:opacity-100"
                    title="Edit page"
                  >
                    <AppIcon className="ri-pencil-line text-xs"></AppIcon>
                  </button>
                </div>
              </div>
              <p className="text-[13px] font-semibold text-foreground-900 leading-tight mb-1">{page.title}</p>
              <p className="text-[10px] text-foreground-400 leading-snug mb-2">{page.description}</p>
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {page.fields.slice(0, 3).map((f, fi) => (
                    <span key={fi} className="text-[9px] px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-400">{f.label}</span>
                  ))}
                  {page.fields.length > 3 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-400">+{page.fields.length - 3}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTileGrid = () => (
    <div className="px-4 md:px-5 pb-10">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {filteredTiles.map((group, groupIdx) => (
          <div
            key={group.id}
            className="animate-in fade-in slide-in-from-bottom-3 duration-400"
            style={{ animationDelay: `${groupIdx * 80}ms` }}
          >
            <div className="bg-white rounded-lg border border-[#e2e4e8] overflow-hidden hover:shadow-md transition-all duration-200">
              {/* Header */}
              <div className="px-4 py-3 flex items-center gap-3" style={{ backgroundColor: `${group.color}10` }}>
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${group.color}20` }}
                >
                  <AppIcon className={`${group.icon} text-base`} style={{ color: group.color }}></AppIcon>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-foreground-900 leading-tight truncate">{group.header}</p>
                  <p className="text-[10px] text-foreground-400">{group.count} items</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      speak(`${group.header}. Contains ${group.tiles.map((t) => t.label).join(', ')}`);
                    }}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-foreground-300 hover:text-[#1B8A8C] hover:bg-[#1B8A8C]/10 transition-smooth cursor-pointer"
                    title="Read aloud"
                  >
                    <AppIcon className="ri-volume-up-line text-xs"></AppIcon>
                  </button>
                  <button
                    onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
                  >
                    <AppIcon className={`${expandedGroup === group.id ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-xs`}></AppIcon>
                  </button>
                </div>
              </div>

              {/* Sub-tiles */}
              <div className="px-2 py-2">
                {(expandedGroup === group.id ? group.tiles : group.tiles.slice(0, 3)).map((tile) => (
                  <button
                    key={tile.id}
                    onClick={() => openSubPage(group.header, group.color, tile, group.tiles)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-background-100 transition-smooth cursor-pointer group text-left"
                  >
                    <AppIcon className={`${tile.icon} text-[11px] text-foreground-300 group-hover:text-[#4A5568] transition-smooth shrink-0`}></AppIcon>
                    <span className="text-[11px] text-foreground-600 group-hover:text-foreground-900 transition-smooth truncate">{tile.label}</span>
                    <AppIcon className="ri-arrow-right-s-line text-[10px] text-foreground-200 ml-auto group-hover:text-foreground-400 transition-smooth shrink-0"></AppIcon>
                  </button>
                ))}
                {expandedGroup !== group.id && group.tiles.length > 3 && (
                  <button
                    onClick={() => setExpandedGroup(group.id)}
                    className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer"
                  >
                    <span>+{group.tiles.length - 3} more</span>
                    <AppIcon className="ri-arrow-down-s-line text-[10px]"></AppIcon>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderSubPage = () => {
    if (!subPageData) return null;
    const { groupHeader, groupColor, tile, siblingTiles } = subPageData;

    return (
      <div className="px-4 md:px-5 py-4 pb-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={goBackToGrid}
            className="flex items-center gap-1 text-[12px] text-foreground-400 hover:text-foreground-700 transition-smooth cursor-pointer"
          >
            <AppIcon className="ri-arrow-left-s-line text-sm"></AppIcon>
            <span>Home</span>
          </button>
          <AppIcon className="ri-arrow-right-s-line text-[10px] text-foreground-200"></AppIcon>
          <span className="text-[12px] text-foreground-500">{groupHeader}</span>
          <AppIcon className="ri-arrow-right-s-line text-[10px] text-foreground-200"></AppIcon>
          <span className="text-[12px] font-medium text-foreground-900">{tile.label}</span>
        </div>

        {/* Header Card */}
        <div className="bg-white rounded-xl border border-[#e2e4e8] p-5 mb-4">
          <div className="flex items-start gap-4">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${groupColor}15` }}
            >
              <AppIcon className={`${tile.icon} text-2xl`} style={{ color: groupColor }}></AppIcon>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-heading font-bold text-foreground-900 mb-1">{tile.label}</h2>
              <p className="text-[13px] text-foreground-500 leading-relaxed">{tile.description}</p>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() => speak(`${tile.label}. ${tile.description}`)}
                  className="flex items-center gap-1.5 text-[11px] text-foreground-400 hover:text-[#1B8A8C] transition-smooth cursor-pointer"
                >
                  <AppIcon className="ri-volume-up-line text-sm"></AppIcon>
                  Listen
                </button>
                <span className="text-[11px] text-foreground-300">|</span>
                <span className="text-[11px] text-foreground-400">
                  <AppIcon className="ri-time-line text-xs mr-1"></AppIcon>
                  {groupHeader}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-lg border border-[#e2e4e8] p-4 hover:border-[#c8cdd4] transition-all duration-200 cursor-pointer group">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mb-3">
              <AppIcon className="ri-add-circle-line text-emerald-600"></AppIcon>
            </div>
            <p className="text-[13px] font-semibold text-foreground-900 mb-1">Create New</p>
            <p className="text-[11px] text-foreground-400">Add a new entry or record to this section</p>
          </div>
          <div className="bg-white rounded-lg border border-[#e2e4e8] p-4 hover:border-[#c8cdd4] transition-all duration-200 cursor-pointer group">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center mb-3">
              <AppIcon className="ri-search-line text-amber-600"></AppIcon>
            </div>
            <p className="text-[13px] font-semibold text-foreground-900 mb-1">View All</p>
            <p className="text-[11px] text-foreground-400">Browse all records in this section</p>
          </div>
          <div className="bg-white rounded-lg border border-[#e2e4e8] p-4 hover:border-[#c8cdd4] transition-all duration-200 cursor-pointer group">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center mb-3">
              <AppIcon className="ri-bar-chart-line text-violet-600"></AppIcon>
            </div>
            <p className="text-[13px] font-semibold text-foreground-900 mb-1">Reports</p>
            <p className="text-[11px] text-foreground-400">Generate reports for this section</p>
          </div>
        </div>

        {/* Related Tools (Chain / سلسله) */}
        <h3 className="text-[13px] font-heading font-semibold text-foreground-700 mb-3">Related Tools in {groupHeader}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {siblingTiles
            .filter((t) => t.id !== tile.id)
            .map((st) => (
              <button
                key={st.id}
                onClick={() => openSubPage(groupHeader, groupColor, st, siblingTiles)}
                className="flex items-center gap-3 bg-white rounded-lg border border-[#e2e4e8] p-3 hover:border-[#c8cdd4] hover:shadow-sm transition-all duration-200 cursor-pointer text-left group"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${groupColor}12` }}
                >
                  <AppIcon className={`${st.icon} text-sm`} style={{ color: groupColor }}></AppIcon>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-foreground-800 group-hover:text-foreground-950 transition-smooth">{st.label}</p>
                  <p className="text-[10px] text-foreground-400 truncate">{st.description}</p>
                </div>
                <AppIcon className="ri-arrow-right-s-line text-foreground-200 group-hover:text-foreground-400 transition-smooth shrink-0"></AppIcon>
              </button>
            ))}
        </div>
      </div>
    );
  };

  const renderCustomFormView = () => {
    if (!activeCustomPage) return null;
    const page = activeCustomPage;

    return (
      <div className="px-4 md:px-5 py-4 pb-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={goBackToGrid}
            className="flex items-center gap-1 text-[12px] text-foreground-400 hover:text-foreground-700 transition-smooth cursor-pointer"
          >
            <AppIcon className="ri-arrow-left-s-line text-sm"></AppIcon>
            <span>Home</span>
          </button>
          <AppIcon className="ri-arrow-right-s-line text-[10px] text-foreground-200"></AppIcon>
          <span className="text-[12px] font-medium text-foreground-900">{page.title}</span>
        </div>

        {/* Form Card */}
        <div className="max-w-[640px]">
          <div className="bg-white rounded-xl border border-[#e2e4e8] p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${page.color}15` }}>
                  <AppIcon className={`${page.icon} text-lg`} style={{ color: page.color }}></AppIcon>
                </div>
                <div>
                  <h2 className="text-base font-heading font-semibold text-foreground-900">{page.title}</h2>
                  <p className="text-[11px] text-foreground-400">{page.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEditModal(page)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
                  title="Edit page"
                >
                  <AppIcon className="ri-pencil-line"></AppIcon>
                </button>
                <button
                  onClick={() => handleDeletePage(page.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-red-500 hover:bg-red-50 transition-smooth cursor-pointer"
                  title="Delete page"
                >
                  <AppIcon className="ri-delete-bin-line"></AppIcon>
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {page.fields.map((field, fi) => (
                <div key={fi}>
                  <label className="block text-[12px] font-medium text-foreground-700 mb-1.5">
                    {field.label}
                    <span className="ml-2">{renderFieldTypeBadge(field.type)}</span>
                  </label>
                  {renderFieldPreview(field)}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-background-200/50">
              <button
                onClick={goBackToGrid}
                className="px-4 py-2 rounded-lg border border-foreground-200 text-[13px] text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
              >
                Back
              </button>
              <button
                className="px-4 py-2 rounded-lg text-white text-[13px] font-medium transition-smooth cursor-pointer"
                style={{ backgroundColor: page.color }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCreateEditModal = () => {
    if (!createPageModalOpen) return null;
    const isEditing = editingPage !== null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setCreatePageModalOpen(false); setEditingPage(null); }}></div>
        <div className="relative bg-white rounded-2xl shadow-xl max-w-[560px] w-full max-h-[88vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
          <div className="sticky top-0 bg-white border-b border-foreground-400/50 px-5 py-3 flex items-center justify-between rounded-t-2xl z-10">
            <h3 className="text-base font-heading font-semibold text-foreground-900">
              {isEditing ? 'Edit Page' : 'Create New Page'}
            </h3>
            <button
              onClick={() => { setCreatePageModalOpen(false); setEditingPage(null); }}
              className="w-8 h-8 rounded-lg hover:bg-background-100 flex items-center justify-center text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer"
            >
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>

          <form onSubmit={handleSavePage} className="p-5 space-y-4">
            {/* Title */}
            <div>
              <label className="block text-[12px] font-medium text-foreground-700 mb-1.5">Page Title</label>
              <input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                name="title"
                type="text"
                required
                placeholder="e.g. Learner Intake Form"
                className="w-full h-10 px-3 rounded-lg border border-foreground-200 bg-background-50 text-[13px] text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-[#1B8A8C]/60 focus:ring-1 focus:ring-[#1B8A8C]/30 transition-smooth"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-[12px] font-medium text-foreground-700 mb-1.5">Description</label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                name="description"
                rows={2}
                placeholder="Brief description of this page..."
                maxLength={500}
                className="w-full px-3 py-2 rounded-lg border border-foreground-200 bg-background-50 text-[13px] text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-[#1B8A8C]/60 focus:ring-1 focus:ring-[#1B8A8C]/30 transition-smooth resize-none"
              ></textarea>
            </div>

            {/* Category + Icon */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-foreground-700 mb-1.5">Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  name="category"
                  required
                  className="w-full h-10 px-3 rounded-lg border border-foreground-200 bg-background-50 text-[13px] text-foreground-700 focus:outline-none focus:border-[#1B8A8C]/60 focus:ring-1 focus:ring-[#1B8A8C]/30 transition-smooth cursor-pointer"
                >
                  <option value="">Select category...</option>
                  <option value="Learners">Learners</option>
                  <option value="Compliance">Compliance</option>
                  <option value="Coaches">Coaches & Tutors</option>
                  <option value="Employers">Employers</option>
                  <option value="MIS">MIS</option>
                  <option value="Reports">Reports</option>
                  <option value="Programmes">Programmes</option>
                  <option value="QA">QA</option>
                  <option value="Finance">Finance</option>
                  <option value="Settings">Settings</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-foreground-700 mb-1.5">Icon</label>
                <select
                  value={formIcon}
                  onChange={(e) => setFormIcon(e.target.value)}
                  name="icon"
                  required
                  className="w-full h-10 px-3 rounded-lg border border-foreground-200 bg-background-50 text-[13px] text-foreground-700 focus:outline-none focus:border-[#1B8A8C]/60 focus:ring-1 focus:ring-[#1B8A8C]/30 transition-smooth cursor-pointer"
                >
                  <option value="ri-file-text-line">Document</option>
                  <option value="ri-user-add-line">User</option>
                  <option value="ri-building-2-line">Building</option>
                  <option value="ri-calendar-check-line">Calendar</option>
                  <option value="ri-bar-chart-line">Chart</option>
                  <option value="ri-settings-3-line">Settings</option>
                  <option value="ri-shield-check-line">Shield</option>
                  <option value="ri-money-pound-circle-line">Finance</option>
                </select>
              </div>
            </div>

            {/* Color */}
            <div>
              <label className="block text-[12px] font-medium text-foreground-700 mb-1.5">Color</label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <label key={c.value} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="color"
                      value={c.value}
                      checked={formColor === c.value}
                      onChange={() => setFormColor(c.value)}
                      className="sr-only peer"
                    />
                    <span
                      className="w-6 h-6 rounded-full border-2 border-transparent peer-checked:border-foreground-900 transition-smooth"
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    ></span>
                  </label>
                ))}
              </div>
            </div>

            {/* Fields Editor */}
            <div className="border-t border-background-200/50 pt-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[12px] font-medium text-foreground-700">Form Fields</label>
                <button
                  type="button"
                  onClick={addField}
                  className="flex items-center gap-1 text-[11px] font-medium text-[#1B8A8C] hover:text-[#167a7c] transition-smooth cursor-pointer"
                >
                  <AppIcon className="ri-add-line text-xs"></AppIcon>
                  Add Field
                </button>
              </div>

              <div className="space-y-3">
                {formFields.map((field, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-3 rounded-lg bg-background-50 border border-foreground-200/60">
                    <div className="flex-1 min-w-0 space-y-2">
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => updateField(idx, { label: e.target.value })}
                        placeholder="Field label..."
                        className="w-full h-8 px-2.5 rounded-md border border-foreground-200/60 bg-white text-[12px] text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-[#1B8A8C]/40 transition-smooth"
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={field.type}
                          onChange={(e) => updateField(idx, { type: e.target.value as CustomPageField['type'] })}
                          className="h-8 px-2 rounded-md border border-foreground-200/60 bg-white text-[11px] text-foreground-600 focus:outline-none focus:border-[#1B8A8C]/40 transition-smooth cursor-pointer"
                        >
                          {FIELD_TYPES.map((ft) => (
                            <option key={ft.value} value={ft.value}>{ft.label}</option>
                          ))}
                        </select>
                        {field.type === 'select' && (
                          <input
                            type="text"
                            value={field.options || ''}
                            onChange={(e) => updateField(idx, { options: e.target.value })}
                            placeholder="Options (comma separated)"
                            className="flex-1 h-8 px-2.5 rounded-md border border-foreground-200/60 bg-white text-[11px] text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-[#1B8A8C]/40 transition-smooth"
                          />
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeField(idx)}
                      className="w-7 h-7 rounded-md flex items-center justify-center text-foreground-300 hover:text-red-500 hover:bg-red-50 transition-smooth cursor-pointer shrink-0 mt-1"
                    >
                      <AppIcon className="ri-close-line text-sm"></AppIcon>
                    </button>
                  </div>
                ))}
              </div>

              {formFields.length === 0 && (
                <p className="text-[11px] text-foreground-300 text-center py-3">No fields added. Click "Add Field" to start.</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-2 border-t border-background-200/50">
              {isEditing && (
                <button
                  type="button"
                  onClick={() => { handleDeletePage(editingPage!.id); setCreatePageModalOpen(false); setEditingPage(null); }}
                  className="px-3 py-2 rounded-lg text-[13px] text-red-500 hover:bg-red-50 transition-smooth cursor-pointer mr-auto"
                >
                  <AppIcon className="ri-delete-bin-line text-sm mr-1"></AppIcon>
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => { setCreatePageModalOpen(false); setEditingPage(null); }}
                className="px-4 py-2 rounded-lg border border-foreground-200 text-[13px] text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#1B8A8C] text-white text-[13px] font-medium hover:bg-[#167a7c] transition-smooth cursor-pointer"
              >
                {isEditing ? 'Save Changes' : 'Create Page'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const renderHowToModal = () => {
    if (!howToModalOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHowToModalOpen(false)}></div>
        <div className="relative bg-white rounded-2xl shadow-xl max-w-[480px] w-full max-h-[80vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
          <div className="sticky top-0 bg-white border-b border-foreground-400/50 px-5 py-3 flex items-center justify-between rounded-t-2xl">
            <h3 className="text-base font-heading font-semibold text-foreground-900">How to use Internal Panel</h3>
            <button
              onClick={() => setHowToModalOpen(false)}
              className="w-8 h-8 rounded-lg hover:bg-background-100 flex items-center justify-center text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer"
            >
              <AppIcon className="ri-close-line"></AppIcon>
            </button>
          </div>
          <div className="p-5 space-y-4">
            {HOW_TO_STEPS.map((step, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[#1B8A8C]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[#1B8A8C] text-[11px] font-bold">{i + 1}</span>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-foreground-900 mb-0.5">{step.title}</p>
                  <p className="text-[12px] text-foreground-500 leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-background-200/50 flex justify-end">
            <button
              onClick={() => setHowToModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-[#1B8A8C] text-white text-[13px] font-medium hover:bg-[#167a7c] transition-smooth cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f5f6f8] flex">
      {renderSidebar()}

      <div className="flex-1 min-w-0 overflow-y-auto">
        {renderTopBar()}
        {renderStats()}

        {currentView === 'grid' && (
          <>
            {renderCustomPagesSection()}
            {renderTileGrid()}
          </>
        )}

        {currentView === 'sub-page' && renderSubPage()}

        {currentView === 'custom-form' && renderCustomFormView()}
      </div>

      {renderHowToModal()}
      {renderCreateEditModal()}
    </div>
  );
}
