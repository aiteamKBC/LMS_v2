import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { EnrolmentHelpLauncher } from '@/pages/users/help/EnrolmentHelpLauncher';
import { EnrolmentTutorial } from '@/pages/users/help/EnrolmentTutorial';
import styles from '@/pages/users/help/EnrolmentTutorial.module.css';
import tutorials from './tutorials.json';
import recordedTimings from './tutorialTimings.json';

const timings: Record<string, number[]> = recordedTimings;
type GuideId = 'recordings-hub' | 'tutor-recordings' | 'coach-meetings';

export function RecordingsPageHelp({ guideId }: { guideId: GuideId }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  const tutorial = tutorials.find(item => item.id === guideId)!;
  // Kept-alive routes must not leave a launcher or modal on another page.
  if (pathname.replace(/\/$/, '') !== tutorial.path) return null;
  return <>
    <div className={styles.launcherSpacer} aria-hidden="true" />
    <EnrolmentHelpLauncher title={tutorial.title} hintStorageKey="recordings-help-hint-hidden" onOpen={() => setOpen(true)} />
    {open && <EnrolmentTutorial tutorial={tutorial} initialChapter={0} onClose={() => setOpen(false)}
      assetBase={`${import.meta.env.BASE_URL}help/recordings/v1`} chapterTimes={timings[tutorial.id]} />}
  </>;
}
