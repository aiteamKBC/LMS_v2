import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { CertificateDocument, type CertificateElementId } from '@/components/feature/CertificateDocument';
import { roleNavMap } from '@/mocks/navigation';
import { fetchCertificateTemplate, saveCertificateTemplate, type CertificateTemplate } from '@/api/platformAdmin';

const initial: CertificateTemplate = {
  name: 'Progress certificate',
  title: 'Certificate of Achievement',
  bodyText: 'has successfully completed the requirements and passed the LMS final examination for',
  minimumProgress: 85,
  requireFinalTest: false,
  layoutConfig: {
    primaryColor: '#6d35d4',
    accentColor: '#c99a2e',
    decorationStyle: 'waves',
    backgroundImageUrl: '',
    backgroundOpacity: 100,
    backgroundFit: 'cover',
    backgroundScale: 100,
    backgroundPositionX: 50,
    backgroundPositionY: 50,
    showFrame: true,
    contentBackdropOpacity: 90,
    footerText: 'www.kentbusinesscollege.com',
    instructorName: 'Instructor',
    website: 'www.kentbusinesscollege.com',
    providerBlurb: 'Kent Business College proudly provides government-approved, fully funded apprenticeships that support professional growth and long-term career development.',
    logoUrl: '/kbc-logo.png',
    certifyText: 'This is to certify that',
    recognitionText: 'in recognition of their dedication, knowledge, and commitment to professional excellence.',
    progressPrefix: 'with progress',
    instructorLabel: 'Instructor',
    awardedLabel: 'Awarded on',
    certificateNumberLabel: 'Certificate Number',
    showQr: true,
    showLogo: true,
    showInstructor: true,
    showAwardDate: true,
    showCertificateNumber: true,
    showFooter: true,
    showWebsite: true,
    showProgress: true,
    decorationSize: 82,
    logoSize: 100,
    titleSize: 100,
    subtitleSize: 100,
    certifySize: 100,
    learnerNameSize: 100,
    bodySize: 92,
    signatureSize: 100,
    footerSize: 100,
    qrSize: 100,
    extraSignatureFields: [],
  },
};

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold text-foreground-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-foreground-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary-200"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold text-foreground-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-foreground-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary-200"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export default function CertificateBuilderPage() {
  const [form, setForm] = useState<CertificateTemplate>(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedElement, setSelectedElement] = useState<CertificateElementId | null>('title');

  useEffect(() => {
    fetchCertificateTemplate()
      .then((response) => {
        if (response.template) {
          setForm({
            ...initial,
            ...response.template,
            layoutConfig: { ...initial.layoutConfig, ...response.template.layoutConfig },
          });
        }
      })
      .catch((error) => setNotice(error.message));
  }, []);

  const updateLayout = (patch: Partial<CertificateTemplate['layoutConfig']>) => {
    setForm((current) => ({ ...current, layoutConfig: { ...current.layoutConfig, ...patch } }));
  };

  const customFields = Array.isArray(form.layoutConfig.extraSignatureFields)
    ? form.layoutConfig.extraSignatureFields
    : [];

  const updateCustomField = (index: number, patch: { label?: string; value?: string }) => {
    const next = customFields.map((field, fieldIndex) => (
      fieldIndex === index ? { ...field, ...patch } : field
    ));
    updateLayout({ extraSignatureFields: next });
  };

  const addCustomField = () => {
    updateLayout({
      extraSignatureFields: [
        ...customFields,
        { value: 'New detail', label: 'New label' },
      ],
    });
  };

  const removeCustomField = (index: number) => {
    updateLayout({ extraSignatureFields: customFields.filter((_, fieldIndex) => fieldIndex !== index) });
  };

  const uploadBackgroundImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice('Please choose an image file for the certificate background.');
      return;
    }
    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = () => {
        updateLayout({ backgroundImageUrl: String(reader.result || ''), contentBackdropOpacity: form.layoutConfig.contentBackdropOpacity ?? 0 });
        setNotice('Background image added to the draft. Save or publish to keep it.');
      };
      reader.onerror = () => setNotice('Could not read the selected image.');
      reader.readAsDataURL(file);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const maxWidth = 1800;
      const maxHeight = 1275;
      const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        setNotice('Could not prepare the selected image.');
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      updateLayout({ backgroundImageUrl: canvas.toDataURL('image/jpeg', 0.88), contentBackdropOpacity: form.layoutConfig.contentBackdropOpacity ?? 0 });
      URL.revokeObjectURL(objectUrl);
      setNotice('Background image added to the draft. Save or publish to keep it.');
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setNotice('Could not read the selected image.');
    };
    image.src = objectUrl;
  };

  const visibilityConfig: Partial<Record<CertificateElementId, keyof CertificateTemplate['layoutConfig']>> = {
    logo: 'showLogo',
    qr: 'showQr',
    instructor: 'showInstructor',
    awardDate: 'showAwardDate',
    certificateNumber: 'showCertificateNumber',
    progress: 'showProgress',
    footer: 'showFooter',
    website: 'showWebsite',
  };

  const sizeConfig: Partial<Record<CertificateElementId, keyof CertificateTemplate['layoutConfig']>> = {
    decoration: 'decorationSize',
    logo: 'logoSize',
    title: 'titleSize',
    subtitle: 'subtitleSize',
    certify: 'certifySize',
    learnerName: 'learnerNameSize',
    bodyText: 'bodySize',
    programmeName: 'bodySize',
    recognitionText: 'bodySize',
    progress: 'bodySize',
    qr: 'qrSize',
    instructor: 'signatureSize',
    awardDate: 'signatureSize',
    certificateNumber: 'signatureSize',
    extraFields: 'signatureSize',
    footer: 'footerSize',
    website: 'footerSize',
  };

  const elementLabels: Record<CertificateElementId, string> = {
    decoration: 'Decoration',
    logo: 'Logo',
    title: 'Certificate title',
    subtitle: 'Title subtitle',
    certify: 'Certify line',
    learnerName: 'Learner name',
    bodyText: 'Certificate text',
    programmeName: 'Programme name',
    recognitionText: 'Recognition text',
    progress: 'Progress line',
    qr: 'Verification QR',
    instructor: 'Instructor',
    awardDate: 'Award date',
    certificateNumber: 'Certificate code',
    extraFields: 'Additional fields',
    footer: 'Footer text',
    website: 'Website',
  };

  const renderSelectedEditor = () => {
    if (!selectedElement) return null;
    const sizeKey = sizeConfig[selectedElement];
    const visibleKey = visibilityConfig[selectedElement];
    const selectedLabel = elementLabels[selectedElement];

    return (
      <section className="rounded-2xl border border-primary-200 bg-primary-50/60 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary-700">Selected element</p>
            <h3 className="mt-1 text-lg font-black text-foreground-900">{selectedLabel}</h3>
          </div>
          {visibleKey ? (
            <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-foreground-700 shadow-sm">
              <input
                type="checkbox"
                checked={form.layoutConfig[visibleKey] !== false}
                onChange={(event) => updateLayout({ [visibleKey]: event.target.checked } as Partial<CertificateTemplate['layoutConfig']>)}
              />
              Visible
            </label>
          ) : null}
        </div>

        <div className="space-y-3">
          {selectedElement === 'decoration' ? (
            <SelectField
              label="Decoration style"
              value={form.layoutConfig.decorationStyle || 'waves'}
              onChange={(value) => updateLayout({ decorationStyle: value as CertificateTemplate['layoutConfig']['decorationStyle'] })}
              options={[
                { value: 'waves', label: 'Purple waves' },
                { value: 'executive', label: 'Executive corners' },
                { value: 'royal', label: 'Royal double frame' },
                { value: 'laurel', label: 'Laurel accents' },
                { value: 'geometric', label: 'Geometric facets' },
                { value: 'ribbon', label: 'Corner ribbon' },
                { value: 'flourish', label: 'Gold flourish' },
                { value: 'classic', label: 'Classic corners' },
                { value: 'minimal', label: 'Minimal gold' },
                { value: 'none', label: 'No decoration' },
              ]}
            />
          ) : null}

          {selectedElement === 'logo' ? (
            <Field label="Logo URL" value={form.layoutConfig.logoUrl || '/kbc-logo.png'} onChange={(value) => updateLayout({ logoUrl: value })} />
          ) : null}

          {selectedElement === 'title' || selectedElement === 'subtitle' ? (
            <Field label="Certificate title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
          ) : null}

          {selectedElement === 'certify' ? (
            <Field label="Certify line" value={form.layoutConfig.certifyText || 'This is to certify that'} onChange={(value) => updateLayout({ certifyText: value })} />
          ) : null}

          {selectedElement === 'bodyText' ? (
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground-600">Certificate text</span>
              <textarea
                value={form.bodyText}
                onChange={(event) => setForm({ ...form, bodyText: event.target.value })}
                className="min-h-20 w-full rounded-xl border border-foreground-200 p-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>
          ) : null}

          {selectedElement === 'recognitionText' ? (
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground-600">Recognition text</span>
              <textarea
                value={form.layoutConfig.recognitionText || initial.layoutConfig.recognitionText || ''}
                onChange={(event) => updateLayout({ recognitionText: event.target.value })}
                className="min-h-20 w-full rounded-xl border border-foreground-200 p-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>
          ) : null}

          {selectedElement === 'progress' ? (
            <Field label="Progress prefix" value={form.layoutConfig.progressPrefix || 'with progress'} onChange={(value) => updateLayout({ progressPrefix: value })} />
          ) : null}

          {selectedElement === 'instructor' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Instructor name" value={form.layoutConfig.instructorName || 'Instructor'} onChange={(value) => updateLayout({ instructorName: value })} />
              <Field label="Instructor label" value={form.layoutConfig.instructorLabel || 'Instructor'} onChange={(value) => updateLayout({ instructorLabel: value })} />
            </div>
          ) : null}

          {selectedElement === 'awardDate' ? (
            <Field label="Date label" value={form.layoutConfig.awardedLabel || 'Awarded on'} onChange={(value) => updateLayout({ awardedLabel: value })} />
          ) : null}

          {selectedElement === 'certificateNumber' ? (
            <Field label="Code label" value={form.layoutConfig.certificateNumberLabel || 'Certificate Number'} onChange={(value) => updateLayout({ certificateNumberLabel: value })} />
          ) : null}

          {selectedElement === 'footer' ? (
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground-600">Footer text</span>
              <textarea
                value={form.layoutConfig.providerBlurb || initial.layoutConfig.providerBlurb || ''}
                onChange={(event) => updateLayout({ providerBlurb: event.target.value })}
                className="min-h-20 w-full rounded-xl border border-foreground-200 p-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>
          ) : null}

          {selectedElement === 'website' ? (
            <Field label="Website" value={form.layoutConfig.website || form.layoutConfig.footerText || 'www.kentbusinesscollege.com'} onChange={(value) => updateLayout({ website: value, footerText: value })} />
          ) : null}

          {selectedElement === 'learnerName' || selectedElement === 'programmeName' ? (
            <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              This value is filled from the learner record. You can edit its size here, not the sample text.
            </p>
          ) : null}

          {selectedElement === 'extraFields' ? (
            <p className="rounded-xl border border-foreground-100 bg-white p-3 text-xs font-semibold text-foreground-600">
              Use Additional fields below to add, edit, or remove custom certificate fields.
            </p>
          ) : null}

          {sizeKey ? (
            <Field
              label={`${selectedLabel} size (%)`}
              value={(form.layoutConfig[sizeKey] as number | undefined) ?? (sizeKey === 'decorationSize' ? 82 : sizeKey === 'bodySize' ? 92 : 100)}
              onChange={(value) => updateLayout({ [sizeKey]: Number(value) } as Partial<CertificateTemplate['layoutConfig']>)}
              type="number"
            />
          ) : null}
        </div>
      </section>
    );
  };

  const save = async (publish: boolean) => {
    setBusy(true);
    setNotice('');
    try {
      const response = await saveCertificateTemplate(form, publish);
      if (response.template) {
        setForm({
          ...initial,
          ...response.template,
          layoutConfig: { ...initial.layoutConfig, ...response.template.layoutConfig },
        });
      }
      setNotice(publish ? 'Certificate template published.' : 'Draft saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save template.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkspaceShell
      role="admin"
      roleLabel="Super Admin"
      navItems={roleNavMap.admin.items}
      workspaceLabel="Super Admin Workspace"
      pageTitle="Certificate Builder"
      pageSubtitle="Design and publish learner certificates"
      userName="Super Admin"
      userRole="Super Admin"
    >
      <PageContainer>
        <PageHeader
          title="Certificate Builder"
          description="Configure the certificate unlocked when a learner reaches the eligibility threshold."
          icon="ri-award-line"
          actions={(
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => void save(false)} className="h-10 rounded-xl border border-primary-200 bg-white px-4 text-xs font-bold text-primary-700">
                Save draft
              </button>
              <button disabled={busy} onClick={() => void save(true)} className="primary-action h-10 rounded-xl bg-primary-700 px-4 text-xs font-bold text-white">
                Publish
              </button>
            </div>
          )}
        />

        {notice ? <div className="rounded-xl border border-primary-100 bg-primary-50 p-3 text-sm font-semibold text-primary-800">{notice}</div> : null}

        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <section className="space-y-4 rounded-2xl border border-foreground-200 bg-white p-5">
            {renderSelectedEditor()}
            <Field label="Template name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <Field label="Certificate title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground-600">Certificate text</span>
              <textarea
                value={form.bodyText}
                onChange={(event) => setForm({ ...form, bodyText: event.target.value })}
                className="min-h-24 w-full rounded-xl border border-foreground-200 p-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>
            <Field label="Unlock progress (%)" value={form.minimumProgress} onChange={(value) => setForm({ ...form, minimumProgress: Number(value) })} type="number" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primary colour" value={form.layoutConfig.primaryColor || '#6d35d4'} onChange={(value) => updateLayout({ primaryColor: value })} type="color" />
              <Field label="Accent colour" value={form.layoutConfig.accentColor || '#c99a2e'} onChange={(value) => updateLayout({ accentColor: value })} type="color" />
            </div>
            <SelectField
              label="Decoration style"
              value={form.layoutConfig.decorationStyle || 'waves'}
              onChange={(value) => updateLayout({ decorationStyle: value as CertificateTemplate['layoutConfig']['decorationStyle'] })}
              options={[
                { value: 'waves', label: 'Purple waves' },
                { value: 'executive', label: 'Executive corners' },
                { value: 'royal', label: 'Royal double frame' },
                { value: 'laurel', label: 'Laurel accents' },
                { value: 'geometric', label: 'Geometric facets' },
                { value: 'ribbon', label: 'Corner ribbon' },
                { value: 'flourish', label: 'Gold flourish' },
                { value: 'classic', label: 'Classic corners' },
                { value: 'minimal', label: 'Minimal gold' },
                { value: 'none', label: 'No decoration' },
              ]}
            />
            <div className="rounded-2xl border border-foreground-100 bg-background-50 p-3">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-foreground-500">Background image</p>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => uploadBackgroundImage(event.target.files?.[0] || null)}
                className="w-full rounded-xl border border-foreground-200 bg-white p-2 text-xs font-semibold"
              />
              {form.layoutConfig.backgroundImageUrl ? (
                <button
                  type="button"
                  onClick={() => updateLayout({ backgroundImageUrl: '' })}
                  className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600"
                >
                  Remove background
                </button>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Opacity (%)" value={form.layoutConfig.backgroundOpacity ?? 100} onChange={(value) => updateLayout({ backgroundOpacity: Number(value) })} type="number" />
                <SelectField
                  label="Fit"
                  value={form.layoutConfig.backgroundFit || 'cover'}
                  onChange={(value) => updateLayout({ backgroundFit: value as CertificateTemplate['layoutConfig']['backgroundFit'] })}
                  options={[
                    { value: 'cover', label: 'Cover' },
                    { value: 'contain', label: 'Contain' },
                  ]}
                />
                <Field label="Scale (%)" value={form.layoutConfig.backgroundScale ?? 100} onChange={(value) => updateLayout({ backgroundScale: Number(value) })} type="number" />
                <Field label="Text backing (%)" value={form.layoutConfig.contentBackdropOpacity ?? (form.layoutConfig.backgroundImageUrl ? 0 : 90)} onChange={(value) => updateLayout({ contentBackdropOpacity: Number(value) })} type="number" />
                <Field label="Position X (%)" value={form.layoutConfig.backgroundPositionX ?? 50} onChange={(value) => updateLayout({ backgroundPositionX: Number(value) })} type="number" />
                <Field label="Position Y (%)" value={form.layoutConfig.backgroundPositionY ?? 50} onChange={(value) => updateLayout({ backgroundPositionY: Number(value) })} type="number" />
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.layoutConfig.showFrame !== false} onChange={(event) => updateLayout({ showFrame: event.target.checked })} />
                Show default frame
              </label>
              <p className="mt-2 text-[11px] font-semibold text-foreground-500">
                Tip: if the Canva image already includes border/decorations, set Decoration style to No decoration and turn off Show default frame.
              </p>
            </div>
            <div className="rounded-2xl border border-foreground-100 bg-background-50 p-3">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-foreground-500">Element sizes (%)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Decoration" value={form.layoutConfig.decorationSize ?? 82} onChange={(value) => updateLayout({ decorationSize: Number(value) })} type="number" />
                <Field label="Logo" value={form.layoutConfig.logoSize ?? 100} onChange={(value) => updateLayout({ logoSize: Number(value) })} type="number" />
                <Field label="Title" value={form.layoutConfig.titleSize ?? 100} onChange={(value) => updateLayout({ titleSize: Number(value) })} type="number" />
                <Field label="Subtitle" value={form.layoutConfig.subtitleSize ?? 100} onChange={(value) => updateLayout({ subtitleSize: Number(value) })} type="number" />
                <Field label="Certify line" value={form.layoutConfig.certifySize ?? 100} onChange={(value) => updateLayout({ certifySize: Number(value) })} type="number" />
                <Field label="Learner name" value={form.layoutConfig.learnerNameSize ?? 100} onChange={(value) => updateLayout({ learnerNameSize: Number(value) })} type="number" />
                <Field label="Body text" value={form.layoutConfig.bodySize ?? 92} onChange={(value) => updateLayout({ bodySize: Number(value) })} type="number" />
                <Field label="Signatures" value={form.layoutConfig.signatureSize ?? 100} onChange={(value) => updateLayout({ signatureSize: Number(value) })} type="number" />
                <Field label="Footer" value={form.layoutConfig.footerSize ?? 100} onChange={(value) => updateLayout({ footerSize: Number(value) })} type="number" />
                <Field label="QR" value={form.layoutConfig.qrSize ?? 100} onChange={(value) => updateLayout({ qrSize: Number(value) })} type="number" />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-foreground-500">Allowed range is safely clamped between 60% and 160%.</p>
            </div>
            <Field label="Logo URL" value={form.layoutConfig.logoUrl || '/kbc-logo.png'} onChange={(value) => updateLayout({ logoUrl: value })} />
            <Field label="Certify line" value={form.layoutConfig.certifyText || 'This is to certify that'} onChange={(value) => updateLayout({ certifyText: value })} />
            <Field label="Instructor name" value={form.layoutConfig.instructorName || 'Instructor'} onChange={(value) => updateLayout({ instructorName: value })} />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Instructor label" value={form.layoutConfig.instructorLabel || 'Instructor'} onChange={(value) => updateLayout({ instructorLabel: value })} />
              <Field label="Date label" value={form.layoutConfig.awardedLabel || 'Awarded on'} onChange={(value) => updateLayout({ awardedLabel: value })} />
              <Field label="Code label" value={form.layoutConfig.certificateNumberLabel || 'Certificate Number'} onChange={(value) => updateLayout({ certificateNumberLabel: value })} />
            </div>
            <Field label="Website" value={form.layoutConfig.website || form.layoutConfig.footerText || 'www.kentbusinesscollege.com'} onChange={(value) => updateLayout({ website: value, footerText: value })} />
            <Field label="Progress prefix" value={form.layoutConfig.progressPrefix || 'with progress'} onChange={(value) => updateLayout({ progressPrefix: value })} />
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground-600">Recognition text</span>
              <textarea
                value={form.layoutConfig.recognitionText || initial.layoutConfig.recognitionText || ''}
                onChange={(event) => updateLayout({ recognitionText: event.target.value })}
                className="min-h-20 w-full rounded-xl border border-foreground-200 p-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-foreground-600">Footer text</span>
              <textarea
                value={form.layoutConfig.providerBlurb || initial.layoutConfig.providerBlurb || ''}
                onChange={(event) => updateLayout({ providerBlurb: event.target.value })}
                className="min-h-20 w-full rounded-xl border border-foreground-200 p-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={form.requireFinalTest} onChange={(event) => setForm({ ...form, requireFinalTest: event.target.checked })} />
              Require final test pass
            </label>
            <div className="rounded-2xl border border-foreground-100 bg-background-50 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-foreground-500">Additional fields</p>
                  <p className="mt-1 text-xs text-foreground-500">Add extra details to the bottom official row.</p>
                </div>
                <button
                  type="button"
                  onClick={addCustomField}
                  className="rounded-lg border border-primary-200 bg-white px-3 py-2 text-xs font-bold text-primary-700"
                >
                  + Add
                </button>
              </div>
              {customFields.length ? (
                <div className="space-y-3">
                  {customFields.map((field, index) => (
                    <div key={`${index}-${field.label || field.value || 'field'}`} className="rounded-xl border border-foreground-100 bg-white p-3">
                      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <Field label="Value" value={field.value || ''} onChange={(value) => updateCustomField(index, { value })} />
                        <Field label="Label" value={field.label || ''} onChange={(value) => updateCustomField(index, { label: value })} />
                        <button
                          type="button"
                          onClick={() => removeCustomField(index)}
                          className="mt-6 h-11 rounded-xl border border-red-100 bg-red-50 px-3 text-xs font-bold text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-foreground-200 bg-white p-3 text-xs font-semibold text-foreground-500">
                  No additional fields yet.
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-foreground-100 bg-background-50 p-3">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-foreground-500">Visible sections</p>
              <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showLogo !== false} onChange={(event) => updateLayout({ showLogo: event.target.checked })} />
                  Logo
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showFrame !== false} onChange={(event) => updateLayout({ showFrame: event.target.checked })} />
                  Default frame
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showQr !== false} onChange={(event) => updateLayout({ showQr: event.target.checked })} />
                  Verification QR
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showInstructor !== false} onChange={(event) => updateLayout({ showInstructor: event.target.checked })} />
                  Instructor
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showAwardDate !== false} onChange={(event) => updateLayout({ showAwardDate: event.target.checked })} />
                  Award date
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showCertificateNumber !== false} onChange={(event) => updateLayout({ showCertificateNumber: event.target.checked })} />
                  Certificate code
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showProgress !== false} onChange={(event) => updateLayout({ showProgress: event.target.checked })} />
                  Progress
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showFooter !== false} onChange={(event) => updateLayout({ showFooter: event.target.checked })} />
                  Footer text
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.layoutConfig.showWebsite !== false} onChange={(event) => updateLayout({ showWebsite: event.target.checked })} />
                  Website
                </label>
              </div>
            </div>
          </section>

          <section
            className="rounded-2xl border border-foreground-200 bg-background-100 p-6"
            onClick={() => setSelectedElement(null)}
          >
            <CertificateDocument
              title={form.title}
              bodyText={form.bodyText}
              learnerName="Student name"
              programmeName="Course name"
              progressLabel="Progress"
              certificateNumber="Certificate code"
              awardedOn="End Date"
              verificationUrl="https://kentbusinesscollege.com/verify/demo"
              layoutConfig={form.layoutConfig}
              editable
              selectedElement={selectedElement}
              onSelectElement={setSelectedElement}
            />
            <p className="mt-3 text-center text-xs font-semibold text-foreground-500">
              Click any element on the certificate to edit it from the selected-element panel.
            </p>
          </section>
        </div>
      </PageContainer>
    </WorkspaceShell>
  );
}
