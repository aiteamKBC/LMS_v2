import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentKsbMapping, LearnerKind, LearnerKsbItem } from '@/api/learnerDetail';
import { uploadEvidence } from '@/api/evidence';
import { proofreadLearningReflection, transcribeVoiceReflection } from '@/api/reflectionVoice';
import { saveLearningReflectionSubmission } from '@/api/reflectionSubmission';

export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const TABS = [
  { id: 'learning', label: 'Learning' },
  { id: 'ksbs', label: 'KSBs' },
  { id: 'apply', label: 'Apply' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'benefit', label: 'Benefit' },
  { id: 'otjh', label: 'OTJH' },
  { id: 'review', label: 'Review' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const BENEFITS = [
  'Improved productivity',
  'Better customer service',
  'Better marketing performance',
  'Better project planning or control',
  'Improved communication',
  'Better data use',
  'Reduced errors',
  'Better compliance',
  'Cost saving',
  'Improved quality',
  'Improved teamwork',
  'Stronger innovation',
];

interface ReflectionSubmission {
  ksbs: string[];
  feedback: string;
  reportedTime: string;
  confidenceBefore?: Record<string, number>;
  confidenceAfter?: Record<string, number>;
  ksbExplanations?: Record<string, string>;
  applicationType?: string;
  applicationText?: string;
  evidenceFiles?: string[];
  coachVisibilityConfirmed?: boolean;
  selectedBenefits?: string[];
  benefitExplanation?: string;
  completedDuringPaidHours?: string;
  dateCompleted?: string;
  signedDeclaration?: boolean;
}

export function ReflectionWindow({
  learnerKsbs,
  plannedTimeLabel,
  noun = 'quiz',
  submitting,
  submitError,
  onSubmit,
  autoKsbs,
  activityTitle = '',
  weekLabel = '',
  moduleLabel = '',
  learnerName = 'Learner',
  programmeName = 'Programme not set',
  learnerKind,
  learnerId,
  evidenceSectionRef,
  onClose,
}: {
  learnerKsbs: LearnerKsbItem[];
  elapsedSeconds: number;
  plannedTimeLabel: string;
  noun?: string;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (result: ReflectionSubmission) => void | Promise<void>;
  autoKsbs?: ComponentKsbMapping[];
  activityTitle?: string;
  weekLabel?: string;
  moduleLabel?: string;
  learnerName?: string;
  programmeName?: string;
  learnerKind?: LearnerKind;
  learnerId?: string;
  evidenceSectionRef?: string;
  onClose?: () => void;
}) {
  const plannedHours = plannedTimeLabel.match(/\d+(?:\.\d+)?/)?.[0] || '';
  const [tab, setTab] = useState<TabId>('learning');
  const [reflection, setReflection] = useState('');
  const [selectedKsbs, setSelectedKsbs] = useState<string[]>([]);
  const [ksbExplanations, setKsbExplanations] = useState<Record<string, string>>({});
  const [confidenceBefore, setConfidenceBefore] = useState<Record<string, number>>({});
  const [confidenceAfter, setConfidenceAfter] = useState<Record<string, number>>({});
  const [applicationType, setApplicationType] = useState('');
  const [applicationText, setApplicationText] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [coachVisibilityConfirmed, setCoachVisibilityConfirmed] = useState(false);
  const [selectedBenefits, setSelectedBenefits] = useState<string[]>([]);
  const [benefitExplanation, setBenefitExplanation] = useState('');
  const [actualTime, setActualTime] = useState(plannedHours);
  const [dateCompleted, setDateCompleted] = useState(new Date().toISOString().split('T')[0]);
  const [paidHours, setPaidHours] = useState('yes');
  const [otjhConfirmed, setOtjhConfirmed] = useState(false);
  const [signedDeclaration, setSignedDeclaration] = useState(false);
  const [aiChecked, setAiChecked] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [proofreading, setProofreading] = useState(false);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [evidenceUploadError, setEvidenceUploadError] = useState('');
  const [reflectionSaving, setReflectionSaving] = useState(false);
  const [reflectionSaveError, setReflectionSaveError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);

  const mappedKsbs = useMemo(() => {
    if (Array.isArray(autoKsbs)) return autoKsbs;
    return learnerKsbs
      .filter(item => selectedKsbs.includes(item.code))
      .map(item => ({ code: item.code, description: item.description, weight: 0, classification: 'possible' }));
  }, [autoKsbs, learnerKsbs, selectedKsbs]);

  const ksbCodes = Array.isArray(autoKsbs) ? autoKsbs.map(item => item.code) : selectedKsbs;
  const wordCount = reflection.trim().split(/\s+/).filter(Boolean).length;
  const learningReady = wordCount >= 100;
  const ksbReady = ksbCodes.length === 0 || ksbCodes.every(code =>
    Boolean(ksbExplanations[code]?.trim())
    && confidenceBefore[code] !== undefined
    && confidenceAfter[code] !== undefined
  );
  const applicationReady = Boolean(applicationType && applicationText.trim());
  const evidenceReady = evidenceFiles.length === 0 || coachVisibilityConfirmed;
  const benefitReady = selectedBenefits.length > 0 && Boolean(benefitExplanation.trim());
  const otjhReady = Boolean(actualTime.trim() && dateCompleted && paidHours && otjhConfirmed);
  const canSubmit = learningReady && ksbReady && applicationReady && evidenceReady
    && benefitReady && otjhReady && signedDeclaration;

  const readiness: Record<TabId, boolean> = {
    learning: learningReady,
    ksbs: ksbReady,
    apply: applicationReady,
    evidence: evidenceReady,
    benefit: benefitReady,
    otjh: otjhReady,
    review: canSubmit,
  };

  const checklist = [
    { label: 'Reflection (≥ 100 words)', complete: learningReady },
    { label: ksbCodes.length ? 'Mapped KSBs explained and rated' : 'No mapped KSBs to rate', complete: ksbReady },
    { label: 'Workplace application or support request', complete: applicationReady },
    { label: 'Consent confirmed (if evidence uploaded)', complete: evidenceReady },
    { label: 'Employer benefit selected and explained', complete: benefitReady },
    { label: 'OTJH confirmed', complete: otjhReady },
    { label: 'Signed declaration', complete: signedDeclaration },
  ];

  const qualityChecks = [
    learningReady,
    ksbReady,
    applicationReady,
    benefitReady,
    otjhReady,
    signedDeclaration,
  ];
  const qualityScore = Math.round(
    (qualityChecks.filter(Boolean).length / qualityChecks.length) * 100,
  );
  const qualitySuggestions = [
    ...(wordCount === 0
      ? ['No learning reflection has been provided']
      : !learningReady
        ? [`Increase the reflection to at least 100 words (currently ${wordCount})`]
        : []),
    ...(!ksbReady ? ['Explain and rate every mapped KSB'] : []),
    ...(!applicationReady ? ['Describe workplace application or the support you need'] : []),
    ...(!benefitReady ? ['Select and explain an employer or business benefit'] : []),
    ...(!otjhReady ? ['Complete and confirm the OTJH record'] : []),
    ...(evidenceFiles.length > 0 && !coachVisibilityConfirmed
      ? ['Confirm permission and consent for the uploaded evidence']
      : []),
    ...(!signedDeclaration ? ['Confirm the learner declaration and signature'] : []),
  ];
  const qualitySummary = qualityScore === 100
    ? 'Your reflection is complete and clearly demonstrates your learning, workplace application and employer benefit.'
    : wordCount === 0
      ? 'This reflection is currently empty and requires your input to demonstrate your learning and its application.'
      : 'Your reflection has a good start, but some areas still need attention before it is ready for tutor review.';

  const activeIndex = TABS.findIndex(item => item.id === tab);
  const completedSections = TABS.filter(item => readiness[item.id]).length;
  const progress = Math.round((completedSections / TABS.length) * 100);

  const handleNext = () => {
    const nextTab = TABS[activeIndex + 1];
    if (nextTab) setTab(nextTab.id);
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      const firstIncomplete = TABS.find(item => !readiness[item.id]);
      if (firstIncomplete && firstIncomplete.id !== 'review') setTab(firstIncomplete.id);
      return;
    }

    if (!learnerKind || !learnerId || !evidenceSectionRef) {
      setReflectionSaveError('This activity is missing the learner details required to save the submission.');
      return;
    }

    const result: ReflectionSubmission = {
      ksbs: ksbCodes,
      feedback: reflection.trim(),
      reportedTime: actualTime.trim(),
      confidenceBefore,
      confidenceAfter,
      ksbExplanations,
      applicationType,
      applicationText: applicationText.trim(),
      evidenceFiles: evidenceFiles.map(file => file.name),
      coachVisibilityConfirmed,
      selectedBenefits,
      benefitExplanation: benefitExplanation.trim(),
      completedDuringPaidHours: paidHours,
      dateCompleted,
      signedDeclaration,
    };

    setReflectionSaving(true);
    setReflectionSaveError('');
    try {
      await saveLearningReflectionSubmission({
        learnerKind,
        learnerId,
        learnerName,
        programmeName,
        activityType: noun,
        activityId: evidenceSectionRef,
        activityTitle,
        moduleTitle: moduleLabel,
        weekTitle: weekLabel,
        plannedOtjh: plannedTimeLabel,
        learningReflection: reflection.trim(),
        ksbCodes,
        ksbExplanations,
        confidenceBefore,
        confidenceAfter,
        applicationType,
        applicationText: applicationText.trim(),
        evidenceFiles: evidenceFiles.map(file => file.name),
        evidenceConsentConfirmed: coachVisibilityConfirmed,
        selectedBenefits,
        benefitExplanation: benefitExplanation.trim(),
        actualTimeHours: actualTime.trim(),
        completedDuringPaidHours: paidHours,
        dateCompleted,
        otjhConfirmed,
        signedDeclaration,
        qualityScore,
      });
      await onSubmit(result);
    } catch (error) {
      setReflectionSaveError(error instanceof Error ? error.message : 'Could not save the reflection for tutor review.');
    } finally {
      setReflectionSaving(false);
    }
  };

  const proofreadReflection = async () => {
    if (!reflection.trim()) return;
    setProofreading(true);
    setVoiceError('');
    try {
      const result = await proofreadLearningReflection(reflection, {
        activityTitle,
        moduleLabel,
        weekLabel,
      });
      setReflection(result.text);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'The reflection could not be proofread.');
    } finally {
      setProofreading(false);
    }
  };

  const releaseMicrophone = useCallback(() => {
    microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
    microphoneStreamRef.current = null;
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    releaseMicrophone();
  }, [releaseMicrophone]);

  const processVoiceRecording = async (audio: Blob) => {
    if (!audio.size) {
      setVoiceError('No audio was captured. Please try again.');
      return;
    }
    setVoiceProcessing(true);
    setVoiceError('');
    try {
      const result = await transcribeVoiceReflection(audio, {
        activityTitle,
        moduleLabel,
        weekLabel,
      });
      setReflection(previous => [previous.trim(), result.text.trim()].filter(Boolean).join('\n\n'));
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'The recording could not be processed.');
    } finally {
      setVoiceProcessing(false);
    }
  };

  const startRecording = async () => {
    setVoiceError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice recording is not supported by this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      microphoneStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setVoiceError('The microphone recording failed. Please try again.');
        setRecording(false);
        releaseMicrophone();
      };
      recorder.onstop = () => {
        const audio = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        audioChunksRef.current = [];
        setRecording(false);
        releaseMicrophone();
        void processVoiceRecording(audio);
      };
      recorder.start(1000);
      setRecording(true);
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 5 * 60 * 1000);
    } catch (error) {
      releaseMicrophone();
      setRecording(false);
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setVoiceError('Microphone access was blocked. Allow microphone access and try again.');
      } else {
        setVoiceError('The microphone could not be started. Please try again.');
      }
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
  };

  const handleEvidenceUpload = async (files: File[]) => {
    setEvidenceUploadError('');
    if (!learnerKind || !learnerId || !evidenceSectionRef) {
      setEvidenceUploadError('This activity is missing the learner details required for evidence upload.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setEvidenceUploading(true);
    try {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) {
          throw new Error(`${file.name} exceeds the 50 MB size limit.`);
        }
        await uploadEvidence(learnerKind, learnerId, file, evidenceSectionRef, {
          moduleTitle: moduleLabel || null,
          weekTitle: weekLabel || null,
          componentId: evidenceSectionRef,
          componentTitle: activityTitle || null,
          componentType: noun,
        });
        setEvidenceFiles(previous => [...previous, file]);
      }
    } catch (error) {
      setEvidenceUploadError(error instanceof Error ? error.message : 'Evidence upload failed.');
    } finally {
      setEvidenceUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full bg-[#f7fbff] rounded-2xl border border-[#bcc6d1] shadow-xl overflow-hidden">
      <div className="p-5 md:px-8 md:pt-7 md:pb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-[#607086]">
              {[weekLabel, moduleLabel, noun].filter(Boolean).join(' · ')}
            </p>
            <h1 className="mt-1 text-xl font-heading font-bold text-[#142033]">
              My Learning Evidence and Reflection
            </h1>
            <p className="mt-0.5 text-sm text-[#607086]">
              {activityTitle || `Complete your ${noun} reflection`}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close reflection"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#607086] transition-colors hover:bg-[#e7eef5] hover:text-[#142033]"
            >
              <i className="ri-close-line text-xl" />
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 rounded-xl border border-[#d4e0eb] bg-[#eef6fd] px-4 py-4 md:grid-cols-4 md:px-5">
          <MetaItem label="Learner" value={learnerName} />
          <MetaItem label="Programme" value={programmeName} />
          <MetaItem label="Planned OTJH" value={plannedTimeLabel || 'Not set'} />
          <MetaItem label="Mapped KSBs" value={ksbCodes.length ? ksbCodes.join(', ') : 'None'} />
        </div>

        <div className="mt-7 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#cbd3dc]">
            <div className="h-full rounded-full bg-[#102d52] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-sm text-[#607086]">{progress}%</span>
        </div>

        <div className="mt-6 overflow-x-auto">
          <div className="grid min-w-[680px] grid-cols-7 rounded-xl bg-[#e7eef5]">
            {TABS.map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  tab === item.id
                    ? 'bg-[#f7fbff] font-medium text-[#142033] shadow-sm ring-2 ring-inset ring-[#3191cf]'
                    : readiness[item.id]
                      ? 'text-emerald-700'
                      : 'text-[#607086] hover:text-[#142033]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-[#d7e0e8] px-5 py-5 md:px-8 md:py-6">
        {tab === 'learning' && (
          <section>
            <h2 className="text-base font-semibold text-[#142033]">What have you learnt from this activity?</h2>
            <p className="mt-1 text-sm text-[#607086]">
              Explain the key ideas, methods, models, tools, concepts or techniques you have understood. Aim for at least 100 words.
            </p>
            <textarea
              value={reflection}
              onChange={event => setReflection(event.target.value)}
              rows={8}
              placeholder="Type or use the microphone..."
              className="mt-4 w-full resize-none rounded-xl border border-[#d3dee8] bg-[#f8fcff] px-4 py-3 text-base text-[#142033] shadow-sm focus:border-[#3191cf] focus:outline-none focus:ring-2 focus:ring-[#3191cf]/20"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={voiceProcessing}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-sm ${
                  recording
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-[#d3dee8] bg-[#f8fcff] text-[#24354a] disabled:cursor-not-allowed disabled:opacity-60'
                }`}
              >
                <i className={`${voiceProcessing ? 'ri-loader-4-line animate-spin' : recording ? 'ri-stop-circle-line' : 'ri-mic-line'} text-lg`} />
                {voiceProcessing ? 'Processing recording...' : recording ? 'Stop recording' : 'Record my answer'}
              </button>
              <button
                onClick={proofreadReflection}
                disabled={!reflection.trim() || proofreading}
                className="inline-flex items-center gap-2 rounded-xl border border-[#d3dee8] bg-[#f8fcff] px-4 py-2.5 text-sm font-medium text-[#7a8797] shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i className={`${proofreading ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-line'} text-lg`} />
                {proofreading ? 'Improving wording...' : 'Proofread & improve my wording'}
              </button>
              <p className={`ml-auto text-sm ${learningReady ? 'text-emerald-600' : 'text-[#607086]'}`}>
                {wordCount} words
              </p>
            </div>
            <p className="mt-3 text-xs text-[#607086]">
              AI can help improve your wording, but the final answer must be based on your real learning and workplace experience.
            </p>
            {recording && (
              <p className="mt-2 text-xs font-medium text-red-600">
                <i className="ri-record-circle-line mr-1 animate-pulse" />
                Recording in English... select Stop recording when you finish.
              </p>
            )}
            {voiceError && (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {voiceError}
              </p>
            )}
          </section>
        )}

        {tab === 'ksbs' && (
          <section>
            <h2 className="text-sm font-semibold text-foreground-900">KSB confidence check</h2>
            <p className="mt-1 text-xs text-foreground-500">
              Explain each mapped KSB, then rate your confidence before and after this {noun}.
            </p>

            {!Array.isArray(autoKsbs) && (
              <div className="mt-4 rounded-xl border border-foreground-200 bg-white p-3">
                <p className="mb-2 text-xs font-semibold text-foreground-700">Select the KSBs this activity developed</p>
                <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                  {learnerKsbs.map(item => (
                    <button
                      key={item.code}
                      onClick={() => setSelectedKsbs(previous =>
                        previous.includes(item.code)
                          ? previous.filter(code => code !== item.code)
                          : [...previous, item.code]
                      )}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        selectedKsbs.includes(item.code)
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-foreground-200 text-foreground-600'
                      }`}
                    >
                      {item.code}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 space-y-3">
              {mappedKsbs.map(item => (
                <div key={item.code} className="rounded-xl border border-foreground-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start gap-2">
                    <span className="rounded-full bg-primary-100 px-2 py-1 text-xs font-semibold text-primary-700">{item.code}</span>
                    <p className="text-xs leading-relaxed text-foreground-600">{item.description}</p>
                  </div>
                  <textarea
                    value={ksbExplanations[item.code] || ''}
                    onChange={event => setKsbExplanations(previous => ({ ...previous, [item.code]: event.target.value }))}
                    rows={2}
                    placeholder={`Why is ${item.code} relevant to this activity? What did you do?`}
                    className="mt-3 w-full resize-none rounded-xl border border-foreground-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
                  />
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <ConfidenceRange
                      label="Confidence before"
                      value={confidenceBefore[item.code]}
                      onChange={value => setConfidenceBefore(previous => ({ ...previous, [item.code]: value }))}
                    />
                    <ConfidenceRange
                      label="Confidence after"
                      value={confidenceAfter[item.code]}
                      onChange={value => setConfidenceAfter(previous => ({ ...previous, [item.code]: value }))}
                    />
                  </div>
                </div>
              ))}
              {mappedKsbs.length === 0 && (
                <p className="rounded-xl bg-background-100 p-4 text-sm text-foreground-500">No KSBs are mapped to this activity.</p>
              )}
            </div>
          </section>
        )}

        {tab === 'apply' && (
          <section>
            <h2 className="text-sm font-semibold text-foreground-900">How can this learning be applied in your workplace?</h2>
            <div className="mt-3 space-y-2">
              {[
                ['already', 'I have already applied this learning'],
                ['plan', 'I plan to apply this learning'],
                ['unsure', "I'm not sure how to apply — I need support"],
              ].map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 rounded-xl border border-foreground-200 bg-white px-3 py-2.5 text-sm text-foreground-700">
                  <input
                    type="radio"
                    name="application"
                    checked={applicationType === value}
                    onChange={() => {
                      setApplicationType(value);
                      setApplicationText('');
                    }}
                    className="accent-primary-600"
                  />
                  {label}
                </label>
              ))}
            </div>
            {applicationType && (
              <>
                <textarea
                  value={applicationText}
                  onChange={event => setApplicationText(event.target.value)}
                  rows={6}
                  placeholder={applicationType === 'unsure'
                    ? 'Describe what support you need from your coach or employer.'
                    : 'Describe how you have applied or plan to apply this learning.'}
                  className="mt-3 w-full resize-none rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm focus:border-primary-400 focus:outline-none"
                />
                {applicationType === 'unsure' && (
                  <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    <i className="ri-alert-line mr-1" />
                    Submitting this will alert your coach to discuss the support you need in your next meeting.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'evidence' && (
          <section>
            <h2 className="text-sm font-semibold text-foreground-900">Upload evidence of workplace application (optional but recommended)</h2>
            <p className="mt-1 text-xs text-foreground-500">
              Word, PDF, PowerPoint, Excel, screenshot, photo, email, meeting notes, report, work product, link, audio or video.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,video/mp4"
              className="hidden"
              onChange={event => void handleEvidenceUpload(Array.from(event.target.files || []))}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={evidenceUploading}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-foreground-200 bg-white px-4 py-2.5 text-sm font-medium text-foreground-700 shadow-sm disabled:cursor-wait disabled:opacity-60"
            >
              <i className={evidenceUploading ? 'ri-loader-4-line animate-spin' : 'ri-upload-2-line'} />
              {evidenceUploading ? 'Uploading to Azure...' : 'Add evidence file'}
            </button>
            {evidenceUploadError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {evidenceUploadError}
              </p>
            )}
            {evidenceFiles.length > 0 && (
              <div className="mt-3 space-y-2">
                {evidenceFiles.map(file => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center justify-between rounded-lg bg-background-100 px-3 py-2 text-xs text-foreground-700">
                    <span className="truncate"><i className="ri-file-line mr-2" />{file.name}</span>
                    <span className="ml-3 inline-flex shrink-0 items-center gap-1 font-medium text-emerald-700">
                      <i className="ri-checkbox-circle-line" /> Uploaded
                    </span>
                  </div>
                ))}
              </div>
            )}
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-foreground-200 bg-white p-4">
              <input
                type="checkbox"
                checked={coachVisibilityConfirmed}
                onChange={event => setCoachVisibilityConfirmed(event.target.checked)}
                className="mt-0.5 accent-primary-600"
              />
              <span className="text-sm leading-relaxed text-foreground-700">
                I confirm I have permission to upload this evidence and have removed/hidden any confidential, personal or commercially sensitive information where necessary.
              </span>
            </label>
          </section>
        )}

        {tab === 'benefit' && (
          <section>
            <h2 className="text-sm font-semibold text-foreground-900">How could your employer or business benefit from this learning?</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {BENEFITS.map(benefit => (
                <button
                  key={benefit}
                  onClick={() => setSelectedBenefits(previous =>
                    previous.includes(benefit)
                      ? previous.filter(item => item !== benefit)
                      : [...previous, benefit]
                  )}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    selectedBenefits.includes(benefit)
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-[#d4e0eb] bg-[#eef6fd] text-foreground-600'
                  }`}
                >
                  {benefit}
                </button>
              ))}
            </div>
            <textarea
              value={benefitExplanation}
              onChange={event => setBenefitExplanation(event.target.value)}
              rows={4}
              placeholder="Explain how this could improve your team, employer or business outcomes."
              className="mt-4 w-full resize-none rounded-xl border border-foreground-200 bg-white px-4 py-3 text-sm focus:border-primary-400 focus:outline-none"
            />
          </section>
        )}

        {tab === 'otjh' && (
          <section>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Planned time">
                <div className="flex h-11 items-center rounded-xl border border-foreground-200 bg-background-100 px-3 text-sm text-foreground-500">
                  {plannedTimeLabel || 'Not set'}
                </div>
              </Field>
              <Field label="Actual time spent (hours)">
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={actualTime}
                  onChange={event => setActualTime(event.target.value)}
                  placeholder="e.g. 2"
                  className="h-11 w-full rounded-xl border border-foreground-200 bg-white px-3 text-sm focus:border-primary-400 focus:outline-none"
                />
              </Field>
              <Field label="Date completed">
                <input
                  type="date"
                  value={dateCompleted}
                  onChange={event => setDateCompleted(event.target.value)}
                  className="h-11 w-full rounded-xl border border-foreground-200 bg-white px-3 text-sm focus:border-primary-400 focus:outline-none"
                />
              </Field>
            </div>
            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-foreground-800">Completed during paid working hours?</legend>
              <div className="mt-2 flex gap-5">
                {[['yes', 'Yes'], ['no', 'No'], ['partly', 'Partly']].map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-foreground-700">
                    <input type="radio" name="paidHours" checked={paidHours === value} onChange={() => setPaidHours(value)} className="accent-primary-600" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 rounded-xl border border-foreground-200 bg-primary-50/30 p-4 text-xs leading-relaxed text-foreground-600">
              I confirm that the time recorded is accurate. I confirm that this activity supported development of my apprenticeship KSBs. I confirm it was completed during my normal paid working hours, unless I have explained an agreed exception.
            </div>
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-foreground-700">
              <input type="checkbox" checked={otjhConfirmed} onChange={event => setOtjhConfirmed(event.target.checked)} className="accent-primary-600" />
              I confirm this OTJH record is accurate.
            </label>
          </section>
        )}

        {tab === 'review' && (
          <section className="space-y-4">
            <div className="rounded-xl border border-foreground-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground-800">AI quality check</span>
                <button
                  onClick={() => setAiChecked(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-foreground-200 px-3 py-2 text-xs font-medium text-foreground-700 shadow-sm"
                >
                  <i className="ri-sparkling-line" /> {aiChecked ? 'Run again' : 'Run check'}
                </button>
              </div>
              {aiChecked && (
                <div className="mt-3 border-t border-foreground-100 pt-3">
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#cbd3dc]">
                      <div
                        className={`h-full rounded-full transition-all ${
                          qualityScore === 100 ? 'bg-emerald-500' : 'bg-[#102d52]'
                        }`}
                        style={{ width: `${qualityScore}%` }}
                      />
                    </div>
                    <strong className="min-w-12 text-right text-sm font-medium text-foreground-700">
                      {qualityScore}/100
                    </strong>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-foreground-600">{qualitySummary}</p>
                  {qualitySuggestions.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-foreground-800">Suggestions</p>
                      <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-foreground-700">
                        {qualitySuggestions.map(suggestion => (
                          <li key={suggestion}>{suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-primary-200 bg-primary-50/30 p-4">
              <h2 className="text-sm font-semibold text-foreground-900"><i className="ri-shield-check-line mr-2 text-primary-600" />Learner declaration &amp; signature</h2>
              <p className="mt-2 text-xs leading-relaxed text-foreground-500">
                Your stored signature is reused on every submission and saved with the document dated and time-stamped for legal and compliance reasons.
              </p>
              <div className="mt-3 rounded-xl border border-foreground-200 bg-white px-4 py-2.5 text-sm italic text-foreground-700">{learnerName}</div>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-foreground-700">
                <input type="checkbox" checked={signedDeclaration} onChange={event => setSignedDeclaration(event.target.checked)} className="accent-primary-600" />
                I confirm this evidence is accurate and electronically sign it.
              </label>
              <p className="mt-2 text-xs text-foreground-500">
                Will be stored as: <strong>{learnerName}</strong> · {new Date().toLocaleDateString('en-GB')} · {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <div className="rounded-xl border border-foreground-200 bg-white p-4">
              <h2 className="mb-2 text-xs font-semibold text-foreground-900">Submission checklist</h2>
              <div className="space-y-1.5">
                {checklist.map(item => (
                  <p key={item.label} className={`flex items-center gap-2 text-xs ${item.complete ? 'text-emerald-700' : 'text-foreground-500'}`}>
                    <i className={item.complete ? 'ri-checkbox-circle-line' : 'ri-alert-line'} /> {item.label}
                  </p>
                ))}
              </div>
            </div>
          </section>
        )}

        {(reflectionSaveError || submitError) && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {reflectionSaveError || submitError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 border-t border-[#bfc9d3] bg-[#f7fbff] px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-8 md:py-5">
        <p className="max-w-xl text-sm leading-relaxed text-[#607086]">
          Status on submit: <strong>Submitted for tutor review</strong> — KSBs &amp; OTJH stay pending until validated.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          <button
            onClick={() => setDraftSaved(true)}
            className="rounded-xl border border-[#cbd5df] bg-[#f8fcff] px-5 py-2.5 text-sm font-medium text-[#142033] shadow-sm"
          >
            {draftSaved ? 'Draft saved' : 'Save draft'}
          </button>
          {tab === 'review' ? (
            <button
              onClick={handleSubmit}
              disabled={submitting || reflectionSaving || !canSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-[#102d52] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#91a0b3]"
            >
              {submitting || reflectionSaving
                ? <><i className="ri-loader-4-line animate-spin" /> Saving...</>
                : <><i className="ri-edit-line" /> Submit for tutor review</>}
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="rounded-xl bg-[#102d52] px-6 py-2.5 text-sm font-semibold text-white"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfidenceRange({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="mb-1 flex items-center justify-between text-xs text-foreground-600">
        {label} <strong>{value ?? 1}/5</strong>
      </span>
      <input
        type="range"
        min="1"
        max="5"
        value={value ?? 1}
        onChange={event => onChange(Number(event.target.value))}
        className="w-full accent-primary-700"
      />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground-700">{label}</span>
      {children}
    </label>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[#607086]">{label}</p>
      <p className="mt-0.5 text-sm font-medium leading-snug text-[#142033]">{value}</p>
    </div>
  );
}
