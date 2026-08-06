import { useState } from 'react';
import { KSB_PRESENTATION } from '@/mocks/monthly-coaching';
import PresentationSlidesModal from './PresentationSlidesModal';
import PresentationPreview from './PresentationPreview';

export default function KSBPresentationSection() {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const p = KSB_PRESENTATION;

  const statusMap = {
    green: { text: 'text-green-700', bg: 'bg-green-100', border: 'border-green-200' },
    amber: { text: 'text-amber-700', bg: 'bg-amber-100', border: 'border-amber-200' },
    red: { text: 'text-red-700', bg: 'bg-red-100', border: 'border-red-200' },
  };

  const handlePreparePresentation = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setShowModal(true);
    }, 1800);
  };

  return (
    <>
      <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
        <div className="p-6 md:p-8">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                <AppIcon className="ri-presentation-line text-primary-700" />
              </div>
              <h2 className="text-lg font-heading font-semibold text-foreground-900">My KSB Progression Presentation</h2>
            </div>
            <p className="text-sm text-foreground-500 max-w-2xl">{p.subtitle}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-primary-600">
              <AppIcon className="ri-magic-line" />
              <span className="font-medium">AI-powered — auto-generated from your platform data</span>
            </div>
          </div>

          {/* What's inside */}
          <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-3">What the presentation covers</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {p.sections.map((section) => {
              const s = statusMap[section.statusColor];
              const isActive = activeSection === section.id;
              return (
                <div
                  key={section.id}
                  className={`rounded-xl border transition-smooth cursor-pointer ${
                    isActive ? 'border-primary-300 bg-primary-50/30' : 'border-background-200/50 bg-background-100/30 hover:bg-background-100/60'
                  }`}
                  onClick={() => setActiveSection(isActive ? null : section.id)}
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
                        {section.completionStatus}
                      </span>
                      <span className="text-xs text-foreground-400">{section.progress}%</span>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground-900 mb-1">{section.title}</h3>
                    <p className="text-xs text-foreground-500 mb-3">{section.description}</p>
                    <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden mb-3">
                      <div
                        className={`h-full rounded-full ${section.progress >= 60 ? 'bg-primary-500' : 'bg-amber-400'}`}
                        style={{ width: `${section.progress}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-foreground-400">
                      <span className="flex items-center gap-1">
                        <AppIcon className="ri-folder-upload-line" /> {section.evidenceLinked} evidence
                      </span>
                      <span className="flex items-center gap-1">
                        <AppIcon className="ri-chat-quote-line" /> {section.reflectionLinked} reflection
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-3">
                      {section.ksbCodes.map((code) => (
                        <span key={code} className="text-xs font-medium bg-secondary-100 text-secondary-700 px-1.5 py-0.5 rounded">
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                  {isActive && (
                    <div className="px-4 pb-4 pt-2 border-t border-background-200/30">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground-500">Evidence Linked</span>
                          <span className="font-medium text-foreground-700">{section.evidenceLinked} items</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground-500">Reflection Linked</span>
                          <span className="font-medium text-foreground-700">{section.reflectionLinked} items</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground-500">KSB Coverage</span>
                          <span className="font-medium text-foreground-700">{section.ksbCodes.join(', ')}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handlePreparePresentation}
              disabled={isGenerating}
              className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                isGenerating
                  ? 'bg-primary-100 text-primary-500 cursor-wait'
                  : 'bg-foreground-900 text-white hover:bg-foreground-700'
              }`}
            >
              {isGenerating ? (
                <>
                  <AppIcon className="ri-loader-4-line animate-spin" />
                  Generating from your data...
                </>
              ) : (
                <>
                  <AppIcon className="ri-magic-line" />
                  Generate Presentation
                </>
              )}
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-background-100 text-foreground-700 rounded-lg text-sm font-semibold border border-background-200/50 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-play-circle-line" />
              Preview Presentation
            </button>
          </div>

          {/* Generation tip */}
          {!isGenerating && (
            <p className="text-xs text-foreground-400 mt-3 flex items-center gap-1">
              <AppIcon className="ri-information-line" />
              The presentation is auto-generated from your platform data. You can edit Workplace Examples, Challenges, Support Needed, and Goals before your coaching meeting.
            </p>
          )}
        </div>
      </section>

      {/* Presentation modal */}
      <PresentationSlidesModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onPreview={() => {
          setShowModal(false);
          setTimeout(() => setShowPreview(true), 100);
        }}
      />

      {/* Full-screen presentation preview */}
      <PresentationPreview
        open={showPreview}
        onClose={() => setShowPreview(false)}
      />
    </>
  );
}