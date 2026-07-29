import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import {
  deleteCurriculumKsbFramework,
  createCurriculumKsbFramework,
  updateCurriculumKsbFramework,
  type CurriculumKsbFramework,
  type CurriculumKsbItemInput,
  type CurriculumKsbSet,
  type CurriculumProgramme,
} from '@/lib/curriculumApi';
import { useToast } from '@/hooks/useToast';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';

type KsbType = 'K' | 'S' | 'B';

type KsbDraft = {
  localId: string;
  saved: boolean;
  type: KsbType;
  code: string;
  parentCode: string;
  title: string;
  description: string;
  displayOrder: number;
  expanded?: boolean;
};

type FrameworkForm = {
  name: string;
  programmeName: string;
  notes: string;
  status: 'active' | 'draft' | 'archived';
};

type ImportError = {
  row: number;
  field: string;
  message: string;
};

type ImportResult = {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errorRows: ImportError[];
};

const EMPTY_FORM: FrameworkForm = { name: '', programmeName: '', notes: '', status: 'active' };
const TEMPLATE_SHEET = 'KSB Framework Template';

function typeLabel(type: KsbType) {
  return type === 'K' ? 'Knowledge' : type === 'S' ? 'Skills' : 'Behaviours';
}

function typeSingular(type: KsbType) {
  return type === 'K' ? 'Knowledge' : type === 'S' ? 'Skill' : 'Behaviour';
}

function makeLocalId() {
  return `ksb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanCode(value: string, type?: KsbType) {
  let code = String(value || '').trim().toUpperCase();
  if (type && code.startsWith(type)) code = code.slice(1);
  return code.replace(/[^0-9.]/g, '');
}

function fullCode(item: Pick<KsbDraft, 'type' | 'code'>) {
  return `${item.type}${cleanCode(item.code, item.type)}`;
}

function codeSortValue(code: string) {
  return cleanCode(code).split('.').reduce((total, part, index) => total + (Number(part) || 0) / Math.pow(100, index), 0);
}

function sortKsbItems(items: KsbDraft[]) {
  const typeOrder: Record<KsbType, number> = { K: 1, S: 2, B: 3 };
  return [...items].sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || codeSortValue(a.code) - codeSortValue(b.code) || a.displayOrder - b.displayOrder);
}

function frameworkId(framework: CurriculumKsbFramework | null) {
  return framework?.id || '';
}

function getFrameworkSet(framework: CurriculumKsbFramework | null, ksbSets: CurriculumKsbSet[]) {
  if (!framework) return undefined;
  return ksbSets.find(set =>
    set.frameworkId === framework.id ||
    String(set.profileId || '') === String(framework.profileId || '').replace(/^ksb-/, '') ||
    set.programmeName === (framework.programmeName || framework.ifateRef) ||
    set.standard === framework.standard
  );
}

function formFromFramework(framework: CurriculumKsbFramework | null): FrameworkForm {
  if (!framework) return EMPTY_FORM;
  return {
    name: framework.name || '',
    programmeName: framework.programmeName || framework.ifateRef || framework.programmes?.[0] || '',
    notes: framework.notes || '',
    status: framework.status === 'archived' ? 'archived' : framework.status === 'draft' ? 'draft' : 'active',
  };
}

function draftsFromSet(framework: CurriculumKsbFramework | null, ksbSet?: CurriculumKsbSet): KsbDraft[] {
  if (!ksbSet?.ksbs?.length) return [];
  return sortKsbItems(ksbSet.ksbs.map((ksb, index) => {
    const inferredType = ksb.fullCode?.charAt(0) || ksb.code.charAt(0);
    const type = (inferredType === 'S' || inferredType === 'B' || inferredType === 'K')
      ? inferredType
      : ksb.type === 'Skill' ? 'S' : ksb.type === 'Behaviour' ? 'B' : 'K';
    return {
      localId: String(ksb.id || `${frameworkId(framework)}-${type}-${ksb.code}-${index}`),
      saved: true,
      type,
      code: cleanCode(ksb.rawCode || ksb.code || ksb.fullCode || '', type),
      parentCode: cleanCode(ksb.parentCode || '', type),
      title: ksb.title || '',
      description: ksb.description || '',
      displayOrder: ksb.displayOrder || index + 1,
      expanded: false,
    };
  }));
}

function itemsToPayload(items: KsbDraft[]): CurriculumKsbItemInput[] {
  return sortKsbItems(items).map((item, index) => ({
    id: item.saved ? item.localId : undefined,
    type: item.type,
    code: cleanCode(item.code, item.type),
    parentCode: cleanCode(item.parentCode, item.type) || undefined,
    title: item.title.trim(),
    description: item.description.trim(),
    displayOrder: index + 1,
  }));
}

function rowsForTemplate(items: KsbDraft[]) {
  return sortKsbItems(items).map((item, index) => ({
    type: item.type,
    code: cleanCode(item.code, item.type),
    parent_code: cleanCode(item.parentCode, item.type),
    title: item.title,
    description: item.description,
    display_order: item.displayOrder || index + 1,
  }));
}

function downloadTemplate() {
  const sampleRows = [
    { type: 'K', code: '1', parent_code: '', title: 'Marketing Concepts and Theory', description: 'Core marketing concepts, models and planning principles.', display_order: 1 },
    { type: 'K', code: '1.1', parent_code: '1', title: 'The fundamentals of marketing', description: 'Explains the role of marketing in creating customer value.', display_order: 2 },
    { type: 'K', code: '1.2', parent_code: '1', title: 'The concepts of brand positioning', description: 'Describes how brands are positioned for target audiences.', display_order: 3 },
    { type: 'S', code: '1', parent_code: '', title: 'Research and Analysis', description: 'Ability to gather, interpret and apply market insight.', display_order: 4 },
    { type: 'S', code: '1.1', parent_code: '1', title: 'Analyse customer and competitor data', description: 'Uses evidence to support marketing decisions.', display_order: 5 },
    { type: 'B', code: '1', parent_code: '', title: 'Agile and flexible', description: 'Adapts approach in response to changing priorities.', display_order: 6 },
    { type: 'B', code: '1.1', parent_code: '1', title: 'Respond positively to feedback', description: 'Uses feedback to improve work and professional practice.', display_order: 7 },
  ];
  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  worksheet['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 44 }, { wch: 60 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, TEMPLATE_SHEET);
  XLSX.writeFile(workbook, 'ksb-framework-template.xlsx', { compression: true });
}

async function parseTemplate(file: File): Promise<{ items: KsbDraft[]; result: ImportResult }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames.includes(TEMPLATE_SHEET) ? TEMPLATE_SHEET : workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });
  const errors: ImportError[] = [];
  const items: KsbDraft[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const type = String(row.type || row.Type || '').trim().toUpperCase() as KsbType;
    const code = cleanCode(String(row.code || row.Code || ''), type);
    const parentCode = cleanCode(String(row.parent_code || row.parentCode || row.Parent || ''), type);
    const title = String(row.title || row.Title || '').trim();
    const description = String(row.description || row.Description || '').trim();
    const displayOrder = Number(row.display_order || row.displayOrder || index + 1) || index + 1;

    if (!type && !code && !title && !description) return;
    if (!['K', 'S', 'B'].includes(type)) errors.push({ row: rowNumber, field: 'type', message: 'Type must be K, S or B.' });
    if (!code) errors.push({ row: rowNumber, field: 'code', message: 'Code is required.' });
    if (!title) errors.push({ row: rowNumber, field: 'title', message: 'Title is required.' });
    if (type && code && title) {
      items.push({ localId: makeLocalId(), saved: false, type, code, parentCode, title, description, displayOrder });
    }
  });

  const codes = new Set<string>();
  items.forEach(item => {
    const key = fullCode(item);
    if (codes.has(key)) errors.push({ row: item.displayOrder + 1, field: 'code', message: `Duplicate KSB code ${key}.` });
    codes.add(key);
  });
  items.forEach(item => {
    if (item.parentCode && !codes.has(`${item.type}${item.parentCode}`)) {
      errors.push({ row: item.displayOrder + 1, field: 'parent_code', message: `Parent ${item.type}${item.parentCode} was not found.` });
    }
  });

  return {
    items: errors.length ? [] : sortKsbItems(items),
    result: {
      totalRows: rows.length,
      importedRows: errors.length ? 0 : items.length,
      skippedRows: rows.length - items.length,
      errorRows: errors,
    },
  };
}

function validateFramework(form: FrameworkForm, items: KsbDraft[]) {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Framework/Profile Name is required.';
  if (!form.programmeName.trim()) errors.programmeName = 'Programme / Standard is required.';

  const seen = new Set<string>();
  const parentCodes = new Set(items.filter(item => !item.parentCode).map(fullCode));
  items.forEach((item, index) => {
    const rowKey = item.localId;
    if (!item.type) errors[`${rowKey}.type`] = 'Type is required.';
    if (!cleanCode(item.code, item.type)) errors[`${rowKey}.code`] = 'Code is required.';
    if (!item.title.trim()) errors[`${rowKey}.title`] = 'Title is required.';
    const key = fullCode(item);
    if (seen.has(key)) errors[`${rowKey}.code`] = `Duplicate code ${key}.`;
    seen.add(key);
    if (item.parentCode && !parentCodes.has(`${item.type}${cleanCode(item.parentCode, item.type)}`)) {
      errors[`${rowKey}.parentCode`] = 'Child point must belong to a valid parent.';
    }
    if (item.parentCode && cleanCode(item.code, item.type) === cleanCode(item.parentCode, item.type)) {
      errors[`${rowKey}.parentCode`] = 'Child point cannot use the same code as its parent.';
    }
    if (!item.parentCode && cleanCode(item.code, item.type).includes('.')) {
      errors[`${rowKey}.code`] = 'Parent KSB code should be a whole number.';
    }
    if (item.parentCode && !cleanCode(item.code, item.type).startsWith(`${cleanCode(item.parentCode, item.type)}.`)) {
      errors[`${rowKey}.code`] = 'Child point code should start with the parent code.';
    }
    if (!item.localId) errors[`row-${index}`] = 'Invalid row.';
  });

  return errors;
}

export function KsbFrameworkManager({
  frameworks,
  ksbSets,
  programmes = [],
  loading,
  onRefresh,
  onClose,
}: {
  frameworks: CurriculumKsbFramework[];
  ksbSets: CurriculumKsbSet[];
  programmes?: CurriculumProgramme[];
  loading?: boolean;
  onRefresh: () => void;
  onClose?: () => void;
}) {
  const { success, error: toastError, info } = useToast();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FrameworkForm>(EMPTY_FORM);
  const [items, setItems] = useState<KsbDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [openSections, setOpenSections] = useState<Record<KsbType, boolean>>({ K: true, S: true, B: true });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedFramework = useMemo(
    () => frameworks.find(framework => framework.id === selectedId) || frameworks[0] || null,
    [frameworks, selectedId],
  );
  const selectedSet = useMemo(() => getFrameworkSet(creating ? null : selectedFramework, ksbSets), [creating, selectedFramework, ksbSets]);

  useEffect(() => {
    if (!frameworks.length || selectedId) return;
    setSelectedId(frameworks[0].id);
  }, [frameworks, selectedId]);

  useEffect(() => {
    if (creating) {
      setForm(EMPTY_FORM);
      setItems([]);
      setErrors({});
      setImportResult(null);
      return;
    }
    setForm(formFromFramework(selectedFramework));
    setItems(draftsFromSet(selectedFramework, selectedSet));
    setErrors({});
    setImportResult(null);
  }, [creating, selectedFramework, selectedSet]);

  const filteredFrameworks = frameworks.filter(framework => {
    const needle = search.toLowerCase();
    return !needle || framework.name.toLowerCase().includes(needle) || (framework.programmeName || framework.ifateRef || '').toLowerCase().includes(needle);
  });

  const groupedItems = useMemo(() => ({
    K: sortKsbItems(items.filter(item => item.type === 'K')),
    S: sortKsbItems(items.filter(item => item.type === 'S')),
    B: sortKsbItems(items.filter(item => item.type === 'B')),
  }), [items]);

  const selectedTitle = creating ? 'New framework' : selectedFramework ? 'Edit framework' : 'KSB Framework';
  const selectedSubtitle = creating ? 'KSB Framework' : form.name || 'Select a framework';
  const validationErrors = useMemo(() => validateFramework(form, items), [form, items]);
  const canSave = Object.keys(validationErrors).length === 0 && (creating || !!selectedFramework);

  const updateItem = (id: string, patch: Partial<KsbDraft>) => {
    setItems(prev => sortKsbItems(prev.map(item => item.localId === id ? { ...item, ...patch } : item)));
  };

  const addParent = (type: KsbType) => {
    const existing = items
      .filter(item => item.type === type && !item.parentCode && !cleanCode(item.code, type).includes('.'))
      .map(item => Number(cleanCode(item.code, type)))
      .filter(Boolean);
    const next = Math.max(0, ...existing) + 1;
    setItems(prev => [...prev, { localId: makeLocalId(), saved: false, type, code: String(next), parentCode: '', title: '', description: '', displayOrder: prev.length + 1, expanded: true }]);
    setOpenSections(prev => ({ ...prev, [type]: true }));
  };

  const addDefaultKsb = () => {
    addParent('K');
  };

  const addChild = (parent: KsbDraft) => {
    const parentCode = cleanCode(parent.code, parent.type);
    const existing = items
      .filter(item => {
        if (item.type !== parent.type) return false;
        const itemCode = cleanCode(item.code, item.type);
        const explicitParent = cleanCode(item.parentCode, item.type) === parentCode;
        const inferredParent = !item.parentCode && itemCode.startsWith(`${parentCode}.`);
        return explicitParent || inferredParent;
      })
      .map(item => Number(cleanCode(item.code, item.type).split('.')[1]))
      .filter(Boolean);
    const next = `${parentCode}.${Math.max(0, ...existing) + 1}`;
    setItems(prev => sortKsbItems([...prev, { localId: makeLocalId(), saved: false, type: parent.type, code: next, parentCode, title: '', description: '', displayOrder: prev.length + 1, expanded: true }]));
  };

  const removeItem = (item: KsbDraft) => {
    const childPrefix = `${cleanCode(item.code, item.type)}.`;
    setItems(prev => prev.filter(candidate => candidate.localId !== item.localId && !(candidate.type === item.type && cleanCode(candidate.code, candidate.type).startsWith(childPrefix))));
  };

  const requestDeleteItem = async (item: KsbDraft) => {
    await showCurriculumConfirm({
      title: 'Delete KSB?',
      text: 'This will remove this KSB from the framework. If it is used in session mapping, related mappings may also be affected.',
      icon: 'warning',
      confirmButtonText: 'Delete KSB',
      cancelButtonText: 'Cancel',
      successTitle: 'KSB deleted',
      successText: `${fullCode(item)} was removed from the draft framework.`,
      onConfirm: () => removeItem(item),
    });
  };

  const saveFramework = async () => {
    const nextErrors = validateFramework(form, items);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toastError('Framework has validation errors', 'Fix the highlighted fields before saving.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        programmeName: form.programmeName.trim(),
        description: form.notes.trim(),
        notes: form.notes.trim(),
        isActive: form.status !== 'archived',
        ksbItems: itemsToPayload(items),
        knowledgeCodes: items.filter(item => item.type === 'K').map(fullCode),
        skillCodes: items.filter(item => item.type === 'S').map(fullCode),
        behaviourCodes: items.filter(item => item.type === 'B').map(fullCode),
      };
      if (creating) {
        const result = await createCurriculumKsbFramework(payload);
        setCreating(false);
        setSelectedId(result.framework?.id ? `ksb-${result.framework.id}` : '');
      } else if (selectedFramework) {
        await updateCurriculumKsbFramework(selectedFramework.id, payload);
      }
      success('Framework saved', `${items.length} KSB definitions are now linked to this framework.`);
      onRefresh();
    } catch (err) {
      toastError('Unable to save framework', err instanceof Error ? err.message : 'The framework could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const deleteFramework = async (target: CurriculumKsbFramework) => {
    setSaving(true);
    try {
      await deleteCurriculumKsbFramework(target.id);
      onRefresh();
    } catch (err) {
      toastError('Unable to delete framework', err instanceof Error ? err.message : 'The framework could not be deleted.');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteFramework = async (framework: CurriculumKsbFramework) => {
    await showCurriculumConfirm({
      title: 'Delete framework?',
      text: 'Deleting this framework removes it from the KSB profiles table. Existing modules using it will keep their historical reference.',
      icon: 'warning',
      confirmButtonText: 'Delete Framework',
      cancelButtonText: 'Cancel',
      successTitle: 'Framework deleted',
      successText: 'Existing modules using it will keep their historical reference.',
      onConfirm: () => deleteFramework(framework),
    });
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await parseTemplate(file);
      setImportResult(result.result);
      if (result.result.errorRows.length) {
        toastError('Template has row errors', `${result.result.errorRows.length} rows need attention before import.`);
      } else {
        setItems(result.items);
        if (!creating && selectedFramework) {
          await updateCurriculumKsbFramework(selectedFramework.id, {
            name: form.name.trim(),
            programmeName: form.programmeName.trim(),
            description: form.notes.trim(),
            notes: form.notes.trim(),
            isActive: form.status !== 'archived',
            ksbItems: itemsToPayload(result.items),
            knowledgeCodes: result.items.filter(item => item.type === 'K').map(fullCode),
            skillCodes: result.items.filter(item => item.type === 'S').map(fullCode),
            behaviourCodes: result.items.filter(item => item.type === 'B').map(fullCode),
          });
          onRefresh();
          success('Template imported', `${result.items.length} KSB definitions imported and saved.`);
        } else {
          success('Template imported', `${result.items.length} KSB definitions loaded. Save the framework to commit them.`);
        }
      }
    } catch (err) {
      toastError('Could not read template', err instanceof Error ? err.message : 'Upload a valid XLSX or CSV file.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div className="min-h-[calc(100vh-190px)] rounded-2xl border border-background-200 bg-background-50 overflow-hidden shadow-sm flex">
      <aside className="w-[290px] shrink-0 border-r border-background-200 bg-background-100/60 flex flex-col">
        <div className="p-4 border-b border-background-200">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <h2 className="text-sm font-heading font-bold text-foreground-900">KSB Frameworks</h2>
              <p className="text-xs text-foreground-400">{frameworks.length} frameworks</p>
            </div>
            <button onClick={() => { setCreating(true); setSelectedId(''); }} className="w-9 h-9 rounded-lg bg-primary-950 text-white flex items-center justify-center hover:bg-primary-900 transition-smooth">
              <i className="ri-add-line text-base"></i>
            </button>
          </div>
          <div className="relative mt-3">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search frameworks" className="w-full h-10 rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-sm outline-none focus:border-primary-300" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? <p className="p-3 text-xs text-foreground-400">Loading frameworks...</p> : filteredFrameworks.map(framework => {
            const ksbCount = getFrameworkSet(framework, ksbSets)?.ksbs.length ?? 0;
            return (
            <div key={framework.id} className={`rounded-lg border p-3 ${selectedFramework?.id === framework.id && !creating ? 'border-primary-500 bg-primary-50/50' : 'border-background-200 bg-background-50'}`}>
              <button onClick={() => { setCreating(false); setSelectedId(framework.id); }} className="w-full text-left">
                <div className="flex items-start gap-2">
                  <span className="w-10 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex flex-col items-center justify-center shrink-0">
                    <span className="text-xs font-bold leading-none">{ksbCount}</span>
                    <span className="mt-0.5 text-[8px] font-bold leading-none uppercase">KSBs</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-foreground-900 truncate">{framework.name}</p>
                    <p className="text-[11px] text-foreground-400 truncate">{framework.programmeName || framework.ifateRef || framework.standard}</p>
                  </div>
                </div>
                <span className={`inline-flex mt-2 text-[9px] font-semibold px-2 py-0.5 rounded-full ${framework.status === 'archived' ? 'bg-foreground-100 text-foreground-500' : 'bg-emerald-100 text-emerald-700'}`}>{framework.status === 'archived' ? 'Archived' : 'Active'}</span>
              </button>
              <div className="mt-2 flex gap-1">
                <button onClick={() => { setCreating(false); setSelectedId(framework.id); }} className="px-2 py-1 rounded-md border border-background-200 text-[10px] font-semibold hover:bg-background-100"><i className="ri-edit-line mr-1"></i>Edit</button>
                <button onClick={() => void requestDeleteFramework(framework)} className="px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-600 text-[10px] font-semibold hover:bg-red-100"><i className="ri-delete-bin-line mr-1"></i>Delete</button>
              </div>
            </div>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <div className="px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <div>
            <p className="text-[11px] text-white/60 font-semibold">{selectedTitle}</p>
            <h3 className="text-lg font-heading font-bold">{selectedSubtitle}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Close KSB Framework Manager">
            <i className="ri-close-line"></i>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!creating && !selectedFramework ? (
            <div className="h-full flex items-center justify-center text-center">
              <div>
                <i className="ri-bar-chart-line text-3xl text-foreground-300"></i>
                <p className="mt-2 text-sm font-semibold text-foreground-700">Select or create a KSB framework.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-background-200 bg-background-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-background-200 flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-primary-950 text-white flex items-center justify-center text-xs font-bold">1</span>
                  <div>
                    <h4 className="text-sm font-bold text-foreground-900">Profile Details</h4>
                    <p className="text-xs text-foreground-400">Complete these fields before adding KSB definitions.</p>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Framework/Profile Name" required value={form.name} error={errors.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} />
                  <ProgrammeSelect programmes={programmes} value={form.programmeName} error={errors.programmeName} onChange={value => setForm(prev => ({ ...prev, programmeName: value }))} />
                  <label className="md:col-span-2">
                    <span className="text-[10px] font-semibold text-foreground-500 uppercase">Notes</span>
                    <textarea value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-background-200 px-3 py-2 text-sm outline-none focus:border-primary-300" />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-background-200 bg-background-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-background-200 flex flex-wrap items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-primary-950 text-white flex items-center justify-center text-xs font-bold">2</span>
                  <h4 className="text-sm font-bold text-foreground-900 mr-auto">KSB Definitions</h4>
                  <button onClick={downloadTemplate} className="px-3 py-2 rounded-lg border border-background-200 text-[11px] font-semibold hover:bg-background-100"><i className="ri-download-line mr-1"></i>Download Template</button>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="px-3 py-2 rounded-lg border border-background-200 text-[11px] font-semibold hover:bg-background-100 disabled:opacity-50"><i className="ri-upload-line mr-1"></i>{uploading ? 'Uploading...' : 'Upload Template'}</button>
                  <button onClick={addDefaultKsb} className="px-3 py-2 rounded-lg bg-primary-950 text-white text-[11px] font-semibold hover:bg-primary-900"><i className="ri-add-line mr-1"></i>Add KSB</button>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
                </div>
                {importResult && (
                  <div className={`mx-4 mt-4 rounded-lg border p-3 ${importResult.errorRows.length ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    <p className="text-xs font-bold text-foreground-900">Import result: {importResult.totalRows} rows, {importResult.importedRows} imported, {importResult.skippedRows} skipped, {importResult.errorRows.length} errors.</p>
                    {importResult.errorRows.length > 0 && (
                      <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                        {importResult.errorRows.map((row, index) => <p key={index} className="text-[11px] text-red-700">Row {row.row} · {row.field}: {row.message}</p>)}
                      </div>
                    )}
                  </div>
                )}
                <div className="p-4 space-y-3">
                  {(['K', 'S', 'B'] as KsbType[]).map(type => (
                    <KsbSection
                      key={type}
                      type={type}
                      items={groupedItems[type]}
                      errors={errors}
                      open={openSections[type]}
                      onToggle={() => setOpenSections(prev => ({ ...prev, [type]: !prev[type] }))}
                      onAddParent={() => addParent(type)}
                      onAddChild={addChild}
                      onUpdate={updateItem}
                      onDelete={requestDeleteItem}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 px-5 pr-40 py-3 border-t border-background-200 bg-background-50 flex items-center gap-3">
          <p className="text-xs font-semibold text-foreground-400 mr-auto">{items.length} required KSB codes</p>
          <div className="flex shrink-0 items-center gap-3">
            {!creating && selectedFramework && <button onClick={() => void requestDeleteFramework(selectedFramework)} className="px-4 py-2 rounded-lg text-red-600 text-xs font-bold hover:bg-red-50">Delete</button>}
            <button onClick={saveFramework} disabled={!canSave || saving} className="px-5 py-2.5 rounded-lg bg-primary-950 text-white text-xs font-bold hover:bg-primary-900 disabled:bg-foreground-300 disabled:cursor-not-allowed">{saving ? 'Saving...' : 'Save Framework'}</button>
          </div>
        </div>
      </section>

    </div>
  );
}

function Field({ label, value, onChange, required, error }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; error?: string }) {
  return (
    <label>
      <span className="text-[10px] font-semibold text-foreground-500 uppercase">{label}{required ? ' *' : ''}</span>
      <input value={value} onChange={event => onChange(event.target.value)} className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-primary-300 ${error ? 'border-red-300 bg-red-50' : 'border-background-200'}`} />
      {error && <span className="mt-1 block text-[11px] text-red-600">{error}</span>}
    </label>
  );
}

function ProgrammeSelect({ programmes, value, onChange, error }: { programmes: CurriculumProgramme[]; value: string; onChange: (value: string) => void; error?: string }) {
  const options = useMemo(() => {
    const seen = new Set<string>();
    return programmes
      .map(programme => {
        const code = programme.standard || programme.sourceId || programme.id;
        const optionValue = code || programme.name;
        const label = code && code !== programme.name ? `${programme.name} · ${code}` : programme.name;
        return { value: optionValue, label };
      })
      .filter(option => {
        if (!option.value || seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
      });
  }, [programmes]);

  const hasCurrentValue = !value || options.some(option => option.value === value);

  return (
    <label>
      <span className="text-[10px] font-semibold text-foreground-500 uppercase">Programme / Standard *</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:border-primary-300 ${error ? 'border-red-300 bg-red-50' : 'border-background-200'}`}
      >
        <option value="">Select programme / standard</option>
        {!hasCurrentValue && <option value={value}>{value}</option>}
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {error && <span className="mt-1 block text-[11px] text-red-600">{error}</span>}
    </label>
  );
}

function KsbSection({ type, items, errors, open, onToggle, onAddParent, onAddChild, onUpdate, onDelete }: {
  type: KsbType;
  items: KsbDraft[];
  errors: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  onAddParent: () => void;
  onAddChild: (item: KsbDraft) => void;
  onUpdate: (id: string, patch: Partial<KsbDraft>) => void;
  onDelete: (item: KsbDraft) => void;
}) {
  const parents = items.filter(item => !item.parentCode && !cleanCode(item.code, item.type).includes('.'));
  const childrenFor = (parent: KsbDraft) => {
    const parentCode = cleanCode(parent.code, parent.type);
    return items.filter(item => {
      const itemCode = cleanCode(item.code, item.type);
      const explicitParent = item.parentCode && cleanCode(item.parentCode, item.type) === parentCode;
      const inferredParent = !item.parentCode && itemCode.startsWith(`${parentCode}.`);
      return explicitParent || inferredParent;
    });
  };

  return (
    <div className="rounded-lg border border-background-200 overflow-hidden">
      <button onClick={onToggle} className="w-full px-3 py-2 bg-background-100 flex items-center gap-2 text-left">
        <span className="w-6 h-6 rounded-md bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold">{type}</span>
        <span className="text-sm font-bold text-foreground-900">{typeLabel(type)}</span>
        <span className="text-xs text-foreground-400 mr-auto">{items.length} definitions</span>
        <i className={`ri-arrow-down-s-line transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && (
        <div className="p-3 space-y-2">
          {parents.map(parent => {
            const children = childrenFor(parent);
            return (
            <div key={parent.localId} className="rounded-xl border border-background-200 bg-white p-2 shadow-sm">
              <KsbRow item={parent} errors={errors} parent onAddChild={() => onAddChild(parent)} onUpdate={onUpdate} onDelete={() => onDelete(parent)} />
              {children.length > 0 && (
                <div className="relative ml-7 mt-2 space-y-2 pl-8 before:absolute before:left-3 before:top-0 before:bottom-5 before:w-px before:bg-primary-100">
                  {children.map(child => (
                    <div key={child.localId} className="relative before:absolute before:-left-5 before:top-5 before:h-px before:w-5 before:bg-primary-100">
                      <KsbRow item={child} errors={errors} child onUpdate={onUpdate} onDelete={() => onDelete(child)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })}
          <button onClick={onAddParent} className="w-full rounded-lg border border-dashed border-background-300 px-3 py-3 text-xs font-semibold text-foreground-500 hover:bg-background-100">
            <i className="ri-add-line mr-1"></i>Add {typeSingular(type)}
          </button>
        </div>
      )}
    </div>
  );
}

function KsbRow({ item, errors, parent, onAddChild, onUpdate, onDelete }: {
  item: KsbDraft;
  errors: Record<string, string>;
  parent?: boolean;
  child?: boolean;
  onAddChild?: () => void;
  onUpdate: (id: string, patch: Partial<KsbDraft>) => void;
  onDelete: () => void;
}) {
  const rowError = (field: string) => errors[`${item.localId}.${field}`];
  const rowTone = parent
    ? 'border-primary-100 bg-primary-50/40'
    : 'border-background-100 bg-background-50';
  return (
    <div className={`rounded-lg border p-2 ${rowTone}`}>
      <div className="grid grid-cols-[82px_104px_minmax(0,1fr)_auto] gap-2 items-start">
        <select value={item.type} onChange={event => onUpdate(item.localId, { type: event.target.value as KsbType })} className="h-10 rounded-lg border border-background-200 px-2 text-sm font-semibold">
          <option value="K">K</option>
          <option value="S">S</option>
          <option value="B">B</option>
        </select>
        <div>
          <div className="flex h-10 rounded-lg border border-background-200 overflow-hidden">
            <span className="w-9 bg-primary-50 text-primary-700 flex items-center justify-center text-xs font-bold">{item.type}</span>
            <input value={cleanCode(item.code, item.type)} onChange={event => onUpdate(item.localId, { code: cleanCode(event.target.value, item.type) })} className="min-w-0 flex-1 px-2 text-sm font-bold outline-none" />
          </div>
          {rowError('code') && <p className="mt-1 text-[10px] text-red-600">{rowError('code')}</p>}
          {rowError('parentCode') && <p className="mt-1 text-[10px] text-red-600">{rowError('parentCode')}</p>}
        </div>
        <div>
          <input value={item.title} onChange={event => onUpdate(item.localId, { title: event.target.value })} placeholder={parent ? 'Parent KSB title' : 'KSB point title'} className={`h-10 w-full rounded-lg border px-3 text-sm font-semibold outline-none focus:border-primary-300 ${rowError('title') ? 'border-red-300 bg-red-50' : 'border-background-200'}`} />
          {rowError('title') && <p className="mt-1 text-[10px] text-red-600">{rowError('title')}</p>}
        </div>
        <div className="flex gap-1">
          {parent && <button onClick={onAddChild} className="h-10 px-3 rounded-lg bg-primary-950 text-white text-xs font-bold hover:bg-primary-900"><i className="ri-add-line mr-1"></i>Add point</button>}
          <button onClick={onDelete} className="h-10 w-10 rounded-lg text-red-500 hover:bg-red-50"><i className="ri-delete-bin-line"></i></button>
        </div>
      </div>
    </div>
  );
}
