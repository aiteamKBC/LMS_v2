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
  type CurriculumStandard,
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
  // Spreadsheet row this draft was read from, so an import error can point at
  // the line the user is looking at in Excel rather than at a running count.
  sourceRow?: number;
};

type FrameworkForm = {
  name: string;
  programmeName: string;
  standardSourceId: string;
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
  // A file with errors still yields its good rows: until the user takes them,
  // `importedRows` is an offer, not something that happened.
  applied: boolean;
};

const EMPTY_FORM: FrameworkForm = { name: '', programmeName: '', standardSourceId: '', notes: '', status: 'active' };
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

// K then S then B, and inside a type the dotted codes fall under their parent
// (K1, K1.1, K1.2, K2) because codeSortValue weighs each segment in turn.
function sortKsbItems<T extends { type: KsbType; code: string; displayOrder?: number }>(items: T[]) {
  const typeOrder: Record<KsbType, number> = { K: 1, S: 2, B: 3 };
  return [...items].sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || codeSortValue(a.code) - codeSortValue(b.code) || (a.displayOrder || 0) - (b.displayOrder || 0));
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
    standardSourceId: framework.standardSourceId || '',
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

// The template carries exactly the three fields a KSB row edits: the type, the
// full code and the definition text. A child point (K1.1) needs no parent
// column — the dotted code says where it belongs, and the rows are laid out in
// that order so K1.1 sits directly under K1.
function rowsForTemplate(items: Array<{ type: KsbType; code: string; description: string; displayOrder?: number }>) {
  return sortKsbItems(items).map(item => ({
    Type: item.type,
    Code: `${item.type}${cleanCode(item.code, item.type)}`,
    Description: item.description,
  }));
}

const EXAMPLE_TEMPLATE_ROWS = [
  { type: 'K' as KsbType, code: '1', description: 'Marketing Concepts and Theory' },
  { type: 'K' as KsbType, code: '1.1', description: 'The fundamentals of marketing and the role it plays in creating customer value.' },
  { type: 'K' as KsbType, code: '1.2', description: 'The concepts of brand positioning for a target audience.' },
  { type: 'S' as KsbType, code: '1', description: 'Research and Analysis' },
  { type: 'S' as KsbType, code: '1.1', description: 'Analyse customer and competitor data to support marketing decisions.' },
  { type: 'B' as KsbType, code: '1', description: 'Agile and flexible' },
  { type: 'B' as KsbType, code: '1.1', description: 'Respond positively to feedback and use it to improve professional practice.' },
];

function templateFileName(frameworkName: string) {
  const slug = frameworkName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `${slug}-ksb-template.xlsx` : 'ksb-framework-template.xlsx';
}

// Downloading a framework that already has definitions hands back those
// definitions, not examples: the file is the edit surface for a bulk change and
// the copy to fall back on if an upload replaces the wrong thing. Examples are
// only for a framework with nothing in it yet.
function downloadTemplate(items: KsbDraft[], frameworkName: string) {
  const source = items.length
    ? items.map(item => ({ type: item.type, code: item.code, description: item.title || item.description, displayOrder: item.displayOrder }))
    : EXAMPLE_TEMPLATE_ROWS;
  const worksheet = XLSX.utils.json_to_sheet(rowsForTemplate(source));
  worksheet['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 70 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, TEMPLATE_SHEET);
  XLSX.writeFile(workbook, templateFileName(items.length ? frameworkName : ''), { compression: true });
}

// Imported by the focused spreadsheet parser tests; keeping the parser beside
// the form avoids a second, drifting copy of the template rules.
// eslint-disable-next-line react-refresh/only-export-components
export async function parseTemplate(file: File): Promise<{ items: KsbDraft[]; result: ImportResult }> {
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
    const explicitParent = cleanCode(String(row.parent_code || row.parentCode || row.Parent || ''), type);
    const titleCell = String(row.title || row.Title || '').trim();
    const descriptionCell = String(row.description || row.Description || '').trim();
    // The template ships one text column; older files carried Title as well, so
    // take whichever is filled as the definition text.
    const text = titleCell || descriptionCell;
    // K1.1 belongs to K1: derive the parent from the code when it is not given.
    const parentCode = explicitParent || (code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : '');
    const displayOrder = Number(row.display_order || row.displayOrder || index + 1) || index + 1;

    if (!type && !code && !text) return;
    if (!['K', 'S', 'B'].includes(type)) errors.push({ row: rowNumber, field: 'type', message: 'Type must be K, S or B.' });
    if (!code) errors.push({ row: rowNumber, field: 'code', message: 'Code is required.' });
    if (!text) errors.push({ row: rowNumber, field: 'description', message: 'Description is required.' });
    if (type && code && text) {
      items.push({
        localId: makeLocalId(),
        saved: false,
        type,
        code,
        parentCode,
        title: text,
        description: titleCell ? descriptionCell : '',
        displayOrder,
        sourceRow: rowNumber,
      });
    }
  });

  // A bad row takes only itself out. Both checks below drop the offending row
  // instead of the file, so the rows that survive are always self-consistent
  // and the user can take them without fixing the spreadsheet first.
  const codes = new Set<string>();
  const unique = items.filter(item => {
    const key = fullCode(item);
    if (codes.has(key)) {
      errors.push({ row: item.sourceRow || 0, field: 'code', message: `Duplicate KSB code ${key} — the first row wins.` });
      return false;
    }
    codes.add(key);
    return true;
  });
  const accepted = unique.filter(item => {
    if (item.parentCode && !codes.has(`${item.type}${item.parentCode}`)) {
      errors.push({ row: item.sourceRow || 0, field: 'parent_code', message: `Parent ${item.type}${item.parentCode} was not found.` });
      return false;
    }
    return true;
  });

  return {
    items: sortKsbItems(accepted),
    result: {
      totalRows: rows.length,
      importedRows: accepted.length,
      skippedRows: rows.length - accepted.length,
      errorRows: errors.sort((a, b) => a.row - b.row),
      applied: false,
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
    if (!item.title.trim()) errors[`${rowKey}.title`] = 'Description is required.';
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
  standards = [],
  loading,
  onRefresh,
  onClose,
}: {
  frameworks: CurriculumKsbFramework[];
  ksbSets: CurriculumKsbSet[];
  programmes?: CurriculumProgramme[];
  standards?: CurriculumStandard[];
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
  // Rows a file with errors still yielded, held until the user asks for them.
  const [pendingImport, setPendingImport] = useState<KsbDraft[] | null>(null);
  const [openSections, setOpenSections] = useState<Record<KsbType, boolean>>({ K: true, S: true, B: true });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedFramework = useMemo(
    () => frameworks.find(framework => framework.id === selectedId) || frameworks[0] || null,
    [frameworks, selectedId],
  );
  const selectedSet = useMemo(() => getFrameworkSet(creating ? null : selectedFramework, ksbSets), [creating, selectedFramework, ksbSets]);
  const linkedStandard = useMemo(
    () => standards.find(standard => standard.id === form.standardSourceId) || null,
    [form.standardSourceId, standards],
  );

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
      setPendingImport(null);
      return;
    }
    setForm(formFromFramework(selectedFramework));
    setItems(draftsFromSet(selectedFramework, selectedSet));
    setErrors({});
    setImportResult(null);
    setPendingImport(null);
  }, [creating, selectedFramework, selectedSet]);

  const searchNeedle = search.trim().toLowerCase();
  const filteredFrameworks = useMemo(() => frameworks.filter(framework => {
    if (!searchNeedle) return true;
    return framework.name.toLowerCase().includes(searchNeedle)
      || (framework.programmeName || framework.ifateRef || '').toLowerCase().includes(searchNeedle);
  }), [frameworks, searchNeedle]);

  // The first fetch leaves `frameworks` legitimately empty, and "0 frameworks"
  // reads as an answer rather than as a wait. While a search is narrowing the
  // list, the total on its own contradicts what is on screen.
  const frameworkCountLabel = loading
    ? 'Loading frameworks...'
    : searchNeedle
      ? `${filteredFrameworks.length} of ${frameworks.length} frameworks`
      : `${frameworks.length} ${frameworks.length === 1 ? 'framework' : 'frameworks'}`;

  const groupedItems = useMemo(() => ({
    K: sortKsbItems(items.filter(item => item.type === 'K')),
    S: sortKsbItems(items.filter(item => item.type === 'S')),
    B: sortKsbItems(items.filter(item => item.type === 'B')),
  }), [items]);

  const selectedTitle = creating ? 'New framework' : selectedFramework ? 'Edit framework' : 'KSB Framework';
  const selectedSubtitle = creating ? 'KSB Framework' : form.name || 'Select a framework';
  const validationErrors = useMemo(() => validateFramework(form, items), [form, items]);
  const canSave = Object.keys(validationErrors).length === 0 && (creating || !!selectedFramework);

  // Saving and importing write the same framework record; only the KSB rows differ.
  const frameworkPayload = (draft: KsbDraft[]) => ({
    name: form.name.trim(),
    programmeName: form.programmeName.trim(),
    standardSourceId: form.standardSourceId.trim(),
    description: form.notes.trim(),
    notes: form.notes.trim(),
    isActive: form.status !== 'archived',
    ksbItems: itemsToPayload(draft),
    knowledgeCodes: draft.filter(item => item.type === 'K').map(fullCode),
    skillCodes: draft.filter(item => item.type === 'S').map(fullCode),
    behaviourCodes: draft.filter(item => item.type === 'B').map(fullCode),
  });

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
      const payload = frameworkPayload(items);
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

  const applyImport = async (imported: KsbDraft[], parsed: ImportResult) => {
    setItems(imported);
    setPendingImport(null);
    setImportResult({ ...parsed, importedRows: imported.length, applied: true });
    if (!creating && selectedFramework) {
      await updateCurriculumKsbFramework(selectedFramework.id, frameworkPayload(imported));
      onRefresh();
      success('Template imported', `${imported.length} KSB definitions imported and saved.`);
    } else {
      success('Template imported', `${imported.length} KSB definitions loaded. Save the framework to commit them.`);
    }
  };

  // An import replaces every definition in the framework — a wider change than
  // deleting a single KSB, which already asks. It gets the same confirmation,
  // and the file on disk is the copy to go back to.
  const confirmImport = async (imported: KsbDraft[], parsed: ImportResult) => {
    if (!items.length) {
      await applyImport(imported, parsed);
      return;
    }
    const saves = !creating && selectedFramework;
    await showCurriculumConfirm({
      title: 'Replace the current KSB definitions?',
      text: `This framework has ${items.length} definitions. Importing removes all of them and puts the ${imported.length} from the file in their place${saves ? ', saving the framework straight away' : ''}. Download the template first if you need a copy of what is there now.`,
      icon: 'warning',
      confirmButtonText: `Replace with ${imported.length}`,
      cancelButtonText: 'Keep current',
      onConfirm: () => applyImport(imported, parsed),
    });
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const parsed = await parseTemplate(file);
      setImportResult(parsed.result);
      setPendingImport(null);
      if (parsed.result.errorRows.length) {
        // The good rows stay on offer instead of the whole file being thrown out.
        setPendingImport(parsed.items);
        toastError(
          'Template has row errors',
          parsed.items.length
            ? `${parsed.result.errorRows.length} rows need attention. ${parsed.items.length} rows are ready if you want them.`
            : `${parsed.result.errorRows.length} rows need attention and no row could be read.`,
        );
        return;
      }
      if (!parsed.items.length) {
        info('Nothing to import', 'That file has no KSB rows in it.');
        return;
      }
      await confirmImport(parsed.items, parsed.result);
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
              <p className="text-xs text-foreground-400">{frameworkCountLabel}</p>
            </div>
            <button onClick={() => { setCreating(true); setSelectedId(''); }} className="primary-action inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-700 text-white transition-smooth hover:bg-primary-600">
              <AppIcon className="ri-add-line" size={16}></AppIcon>
            </button>
          </div>
          <div className="relative mt-3">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search frameworks" className="w-full h-10 rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-sm outline-none focus:border-primary-300" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            [0, 1, 2].map(placeholder => (
              <div key={placeholder} aria-hidden="true" className="rounded-xl border border-background-200 bg-background-50 p-3">
                <div className="flex items-start gap-2">
                  <span className="h-9 w-10 shrink-0 animate-pulse rounded-lg bg-background-200" />
                  <div className="min-w-0 flex-1 space-y-1.5 py-1">
                    <span className="block h-2.5 w-3/4 animate-pulse rounded bg-background-200" />
                    <span className="block h-2 w-1/2 animate-pulse rounded bg-background-200" />
                  </div>
                </div>
              </div>
            ))
          ) : !filteredFrameworks.length ? (
            <div className="px-3 py-10 text-center">
              <AppIcon className={searchNeedle ? 'ri-search-line text-2xl text-foreground-300' : 'ri-bar-chart-line text-2xl text-foreground-300'}></AppIcon>
              <p className="mt-2 text-xs font-semibold text-foreground-700">
                {searchNeedle ? `No framework matches "${search.trim()}".` : 'No KSB frameworks yet.'}
              </p>
              <button
                onClick={() => { if (searchNeedle) { setSearch(''); return; } setCreating(true); setSelectedId(''); }}
                className="mt-2 text-[11px] font-semibold text-primary-700 underline-offset-2 hover:underline"
              >
                {searchNeedle ? 'Clear search' : 'Create the first framework'}
              </button>
            </div>
          ) : filteredFrameworks.map(framework => {
            const ksbCount = getFrameworkSet(framework, ksbSets)?.ksbs.length ?? 0;
            const isSelected = selectedFramework?.id === framework.id && !creating;
            const subtitle = framework.programmeName || framework.ifateRef || framework.standard;
            return (
            <div key={framework.id} className={`relative rounded-xl border transition-smooth hover:border-primary-200 hover:shadow-sm ${isSelected ? 'border-primary-500 bg-primary-50/50' : 'border-background-200 bg-background-50'}`}>
              {/* The card is the edit affordance; a separate Edit button ran the
                  same handler and cost a row of height in a 290px rail. */}
              <button
                onClick={() => { setCreating(false); setSelectedId(framework.id); }}
                aria-current={isSelected || undefined}
                className="w-full rounded-xl p-3 pr-10 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                <div className="flex items-start gap-2">
                  <span className="flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                    <span className="text-xs font-bold leading-none">{ksbCount}</span>
                    <span className="mt-0.5 text-[8px] font-bold leading-none uppercase">KSBs</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-foreground-900 truncate" title={framework.name}>{framework.name}</p>
                    <p className="text-[11px] text-foreground-400 truncate" title={subtitle}>{subtitle}</p>
                  </div>
                </div>
                <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${framework.status === 'archived' ? 'bg-foreground-100 text-foreground-500' : 'bg-primary-100 text-primary-700'}`}>{framework.status === 'archived' ? 'Archived' : 'Active'}</span>
              </button>
              {/* Kept visible rather than hover-revealed: a hover-only control is
                  unreachable on touch. Quiet until pointed at instead. */}
              <button
                onClick={() => void requestDeleteFramework(framework)}
                aria-label={`Delete ${framework.name}`}
                title={`Delete ${framework.name}`}
                className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-lg text-foreground-400 transition-smooth hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              >
                <AppIcon name="ri-delete-bin-line" size={14}></AppIcon>
              </button>
            </div>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <div className="relative overflow-hidden px-5 py-4 bg-primary-950 text-white flex items-center justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.18),transparent_34%),linear-gradient(135deg,rgba(109,40,217,0.35),rgba(15,23,42,0))]" />
          <div className="relative">
            <p className="text-[11px] text-white/60 font-semibold">{selectedTitle}</p>
            <h3 className="text-lg font-heading font-bold text-white">{selectedSubtitle}</h3>
          </div>
          <button onClick={onClose} className="relative w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Close KSB Framework Manager">
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!creating && !selectedFramework ? (
            <div className="h-full flex items-center justify-center text-center">
              <div>
                <AppIcon className="ri-bar-chart-line text-3xl text-foreground-300"></AppIcon>
                <p className="mt-2 text-sm font-semibold text-foreground-700">Select or create a KSB framework.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-background-200 bg-background-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-background-200 flex items-start gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-700 text-xs font-bold text-white">1</span>
                  <div>
                    <h4 className="text-sm font-bold text-foreground-900">Profile Details</h4>
                    <p className="text-xs text-foreground-400">Complete these fields before adding KSB definitions.</p>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Framework/Profile Name" required value={form.name} error={errors.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} />
                  <ProgrammeSelect programmes={programmes} value={form.programmeName} error={errors.programmeName} onChange={value => setForm(prev => ({ ...prev, programmeName: value }))} />
                  <StandardSelect standards={standards} value={form.standardSourceId} onChange={value => setForm(prev => ({ ...prev, standardSourceId: value }))} />
                  {linkedStandard && (
                    <div className="md:col-span-2 flex flex-wrap gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-semibold text-emerald-800">
                      <span className="font-bold">Inherited compliance details:</span>
                      {linkedStandard.minimumHours && <span>{linkedStandard.minimumHours} hrs minimum</span>}
                      {linkedStandard.maxFunding && <span>· {linkedStandard.maxFunding} max funding</span>}
                      {linkedStandard.duration && <span>· {linkedStandard.duration}</span>}
                      {linkedStandard.larsCode && <span>· LARS {linkedStandard.larsCode}</span>}
                    </div>
                  )}
                  <label className="md:col-span-2">
                    <span className="text-[10px] font-semibold text-foreground-500 uppercase">Notes</span>
                    <textarea value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-background-200 px-3 py-2 text-sm outline-none focus:border-primary-300" />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-background-200 bg-background-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-background-200 flex flex-wrap items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-700 text-xs font-bold text-white">2</span>
                  <h4 className="text-sm font-bold text-foreground-900 mr-auto">KSB Definitions</h4>
                  <button onClick={() => downloadTemplate(items, form.name || form.programmeName)} title={items.length ? `Downloads the ${items.length} definitions in this framework` : 'Downloads an example template'} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-background-200 px-3 py-2 text-[11px] font-semibold transition-smooth hover:bg-background-100"><AppIcon className="shrink-0" name="ri-download-line" size={15}></AppIcon>{items.length ? 'Download Definitions' : 'Download Template'}</button>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-background-200 px-3 py-2 text-[11px] font-semibold transition-smooth hover:bg-background-100 disabled:opacity-50"><AppIcon className="shrink-0" name="ri-upload-line" size={15}></AppIcon>{uploading ? 'Uploading...' : 'Upload Template'}</button>
                  <button onClick={addDefaultKsb} className="primary-action inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary-700 px-3 py-2 text-[11px] font-semibold text-white transition-smooth hover:bg-primary-600"><AppIcon className="shrink-0" name="ri-add-line" size={15}></AppIcon>Add KSB</button>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
                </div>
                {importResult && (
                  <div className={`mx-4 mt-4 rounded-lg border p-3 ${importResult.errorRows.length ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    <p className="text-xs font-bold text-foreground-900">
                      {importResult.applied
                        ? `Import result: ${importResult.totalRows} rows, ${importResult.importedRows} imported, ${importResult.skippedRows} skipped, ${importResult.errorRows.length} errors.`
                        : `Template check: ${importResult.totalRows} rows, ${importResult.importedRows} ready to import, ${importResult.skippedRows} skipped, ${importResult.errorRows.length} errors.`}
                    </p>
                    {importResult.errorRows.length > 0 && (
                      <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                        {importResult.errorRows.map((row, index) => <p key={index} className="text-[11px] text-red-700">Row {row.row} · {row.field}: {row.message}</p>)}
                      </div>
                    )}
                    {pendingImport && pendingImport.length > 0 && (
                      <button onClick={() => void confirmImport(pendingImport, importResult)} className="primary-action mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-700 px-3 py-2 text-[11px] font-semibold text-white transition-smooth hover:bg-primary-600">
                        <AppIcon className="shrink-0" name="ri-check-line" size={15}></AppIcon>Import the {pendingImport.length} rows that are ready
                      </button>
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
            <button onClick={saveFramework} disabled={!canSave || saving} className="primary-action px-5 py-2.5 rounded-lg bg-primary-700 text-white text-xs font-bold hover:bg-primary-600 disabled:bg-foreground-300 disabled:cursor-not-allowed">{saving ? 'Saving...' : 'Save Framework'}</button>
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

function StandardSelect({ standards, value, onChange }: { standards: CurriculumStandard[]; value: string; onChange: (value: string) => void }) {
  const hasCurrentValue = !value || standards.some(standard => standard.id === value);
  return (
    <label className="md:col-span-2">
      <span className="text-[10px] font-semibold uppercase text-foreground-500">Skills England Standard</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-background-200 px-3 text-sm outline-none focus:border-primary-300"
      >
        <option value="">No linked standard</option>
        {!hasCurrentValue && <option value={value}>{value} (unavailable)</option>}
        {standards.map(standard => (
          <option key={standard.id} value={standard.id}>
            {standard.name} · {standard.code || standard.standardRef} · {standard.level || 'Level not set'}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-[11px] text-foreground-400">
        Links funding, minimum hours, duration and LARS metadata without changing this profile&apos;s KSB definitions.
      </span>
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
        <AppIcon className={`ri-arrow-down-s-line transition-transform ${open ? 'rotate-180' : ''}`}></AppIcon>
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
          <button onClick={onAddParent} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-background-300 px-3 py-3 text-xs font-semibold text-foreground-500 hover:bg-background-100">
            <AppIcon className="shrink-0" name="ri-add-line" size={15}></AppIcon>Add {typeSingular(type)}
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
          <input value={item.title} onChange={event => onUpdate(item.localId, { title: event.target.value })} placeholder={parent ? 'Parent KSB description' : 'KSB point description'} className={`h-10 w-full rounded-lg border px-3 text-sm font-semibold outline-none focus:border-primary-300 ${rowError('title') ? 'border-red-300 bg-red-50' : 'border-background-200'}`} />
          {rowError('title') && <p className="mt-1 text-[10px] text-red-600">{rowError('title')}</p>}
        </div>
        <div className="flex gap-1">
          {parent && <button onClick={onAddChild} className="primary-action inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-700 px-3 text-xs font-bold text-white hover:bg-primary-600"><AppIcon className="shrink-0" name="ri-add-line" size={15}></AppIcon>Add point</button>}
          <button onClick={onDelete} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50" aria-label={`Delete ${item.code || 'KSB point'}`}><AppIcon name="ri-delete-bin-line" size={16}></AppIcon></button>
        </div>
      </div>
    </div>
  );
}
