import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  advancedAdminComponentQuizReview, advancedAdminLegacyQuizReview, advancedAdminMaterial,
} from '@/api/advancedAdmin';
import { AdminLegacyActivityContent, AdminNativeQuizReview } from './AdminActivityContent';

vi.mock('@/api/advancedAdmin', () => ({
  advancedAdminMaterial: vi.fn(),
  advancedAdminLegacyQuizReview: vi.fn(),
  advancedAdminComponentQuizReview: vi.fn(),
}));
vi.mock('@/pages/learner/my-learning/StudentMaterial', () => ({
  Media: ({ value, kind }: { value: string; kind: string }) =>
    <output data-testid="saved-media" data-kind={kind} data-value={value} />,
}));

beforeEach(() => {
  vi.mocked(advancedAdminMaterial).mockReset();
  vi.mocked(advancedAdminLegacyQuizReview).mockReset();
  vi.mocked(advancedAdminComponentQuizReview).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('shows a structured skeleton while the activity content is loading', () => {
  vi.mocked(advancedAdminMaterial).mockReturnValue(new Promise(() => {}));
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  const skeleton = screen.getByRole('status', { name: 'Loading activity content' });
  expect(skeleton).toHaveAttribute('aria-busy', 'true');
  expect(skeleton.querySelectorAll('.kbc-skeleton')).toHaveLength(6);
});

it('opens saved media and formatted text while displaying the quiz key and recorded selection read only', async () => {
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [
      { kind: 'pdf', url: 'https://example.test/lesson.pdf', title: 'Slides' },
      { kind: 'document', url: 'https://example.test/slides.pptx', title: 'Presentation' },
      { kind: 'audio', url: 'https://example.test/audio.mp3', title: 'Audio' },
      { kind: 'embed', url: 'https://open.spotify.com/embed/episode/example', title: 'Podcast' },
      { kind: 'video', url: 'https://www.youtube.com/embed/example', title: 'Video' },
    ],
    reading_html: '<h2>Chapter one</h2><p>Formatted text</p><iframe src="https://example.test/deck"></iframe><script>window.bad = true</script>',
    unavailable_attachments: [], quiz: null, has_quiz_review: true, historical: { answers: [] }, history: [],
  } as never);
  vi.mocked(advancedAdminLegacyQuizReview).mockResolvedValue({ quiz: {
    body: '<p>Choose the answer</p>', questions: [{
      id: '1', text: 'Sample question', options: ['Wrong', 'Right'],
      correctAnswers: ['Right'], learnerAnswers: ['Wrong'],
    }],
  } });

  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);

  expect(await screen.findByRole('heading', { name: 'Chapter one' })).toBeVisible();
  const media = await screen.findAllByTestId('saved-media');
  expect(media.map(item => item.getAttribute('data-kind'))).toEqual(['pdf', 'document', 'audio', 'embed', 'video', 'document']);
  expect(media[5]).toHaveAttribute('data-value', 'https://example.test/deck');
  expect(screen.queryByText('window.bad = true')).not.toBeInTheDocument();
  const review = await screen.findByRole('region', { name: 'Quiz review' });
  expect(within(review).getByText('Correct answer')).toBeVisible();
  expect(within(review).getByText('Learner selected')).toBeVisible();
  expect(within(review).getAllByText('Wrong')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /submit|start quiz/i })).not.toBeInTheDocument();
  expect(advancedAdminMaterial).toHaveBeenCalledWith(42, 8, 12, expect.any(AbortSignal));
});

it('opens a media activity without requesting an unrelated quiz review', async () => {
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [{ kind: 'audio', url: 'https://example.test/audio.mp3', title: 'Audio lesson' }],
    reading_html: '', unavailable_attachments: [], quiz: null, has_quiz_review: false,
    historical: { answers: [] }, history: [],
  } as never);
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  expect(await screen.findByTestId('saved-media')).toHaveAttribute('data-kind', 'audio');
  expect(screen.queryByText('Preparing activity content...')).not.toBeInTheDocument();
  expect(advancedAdminLegacyQuizReview).not.toHaveBeenCalled();
});

it('frames a saved audio player page instead of passing HTML to an audio element', async () => {
  const player = 'https://kentbusinesscollege.org/wp-json/kbc-lms/v1/material/12/view?attachment_id=34&token=synthetic';
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [{ kind: 'audio', url: player, title: 'Recorded audio' }],
    reading_html: '', unavailable_attachments: [], quiz: null, has_quiz_review: false,
    historical: { answers: [] }, history: [],
  } as never);
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  expect(await screen.findByTitle('Recorded audio')).toHaveAttribute('src', player);
  expect(screen.queryByTestId('saved-media')).not.toBeInTheDocument();
  expect(advancedAdminLegacyQuizReview).not.toHaveBeenCalled();
});

it('uses a saved Office Online iframe directly instead of wrapping it again', async () => {
  const office = 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent('https://files.example.test/slides.pptx');
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [{ kind: 'document', url: office, title: 'Presentation' }], reading_html: '',
    unavailable_attachments: [], quiz: null, historical: { answers: [] }, history: [],
  } as never);
  vi.mocked(advancedAdminLegacyQuizReview).mockResolvedValue({ quiz: null });
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  expect(await screen.findByTitle('Presentation')).toHaveAttribute('src', office);
  expect(screen.queryByTestId('saved-media')).not.toBeInTheDocument();
});

it('loads an authorised PDF into a temporary in-page frame without PDF.js', async () => {
  const file = '/login_api/advanced-admin/learners/393/learning/material/115277/116470/files/116469/';
  const fetchFile = vi.fn().mockResolvedValue({
    ok: true, headers: { get: () => 'application/pdf' },
    blob: async () => new Blob(['%PDF-test'], { type: 'application/pdf' }),
  });
  vi.stubGlobal('fetch', fetchFile);
  const NativeURL = URL;
  const createObjectURL = vi.fn(() => 'blob:http://localhost/admin-pdf');
  const revokeObjectURL = vi.fn();
  class PreviewURL extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('URL', PreviewURL);
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [{ kind: 'pdf', url: file, title: 'Course presentation', can_embed: true }], reading_html: '',
    unavailable_attachments: [], quiz: null, historical: { answers: [] }, history: [],
  } as never);
  vi.mocked(advancedAdminLegacyQuizReview).mockResolvedValue({ quiz: null });
  const { unmount } = render(<AdminLegacyActivityContent learnerId={393} groupId={115277} activityId={116470} kind="material" completed />);
  expect(await screen.findByTitle('Course presentation')).toHaveAttribute('src', 'blob:http://localhost/admin-pdf');
  expect(fetchFile).toHaveBeenCalledWith(`${window.location.origin}${file}`, {
    credentials: 'same-origin', signal: expect.any(AbortSignal),
  });
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(screen.queryByTestId('saved-media')).not.toBeInTheDocument();
  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/admin-pdf');
});

it('shows a file error instead of a blank PDF frame', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [{ kind: 'pdf', url: '/login_api/advanced-admin/learners/42/learning/material/8/12/files/34/', title: 'Course book' }],
    reading_html: '', unavailable_attachments: [], quiz: null, historical: { answers: [] }, history: [],
  } as never);
  vi.mocked(advancedAdminLegacyQuizReview).mockResolvedValue({ quiz: null });
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  expect(await screen.findByRole('alert')).toHaveTextContent('File request failed (404).');
  expect(screen.queryByTitle('Course book')).not.toBeInTheDocument();
});

it('embeds a saved YouTube playlist through the player instead of framing its web page', async () => {
  const playlist = 'https://www.youtube.com/playlist?list=PL1234567890abcdef&si=share';
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [{ kind: 'video', url: playlist, title: 'Safeguarding lessons' }], reading_html: '',
    unavailable_attachments: [], quiz: null, historical: { answers: [] }, history: [],
  } as never);
  vi.mocked(advancedAdminLegacyQuizReview).mockResolvedValue({ quiz: null });
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  expect(await screen.findByTitle('Safeguarding lessons')).toHaveAttribute('src',
    'https://www.youtube.com/embed?listType=playlist&list=PL1234567890abcdef');
  expect(screen.getByRole('link', { name: 'Open material in a new tab' })).toHaveAttribute('href', playlist);
  expect(screen.queryByTestId('saved-media')).not.toBeInTheDocument();
});

it('plays a scoped Drive video directly in Advanced Admin', async () => {
  const stream = '/login_api/advanced-admin/learners/42/learning/material/8/12/media/0/';
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [{ kind: 'video', url: stream, title: 'Recorded lesson' }], reading_html: '',
    unavailable_attachments: [], quiz: null, historical: { answers: [] }, history: [],
  } as never);
  vi.mocked(advancedAdminLegacyQuizReview).mockResolvedValue({ quiz: null });
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  const video = await screen.findByLabelText('Recorded lesson');
  expect(video.tagName).toBe('VIDEO');
  expect(video).toHaveAttribute('src', `${window.location.origin}${stream}`);
  expect(screen.queryByTestId('saved-media')).not.toBeInTheDocument();
});

it('infers returned media types from the URL or attachment filename extension', async () => {
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [
      { kind: 'document', url: 'https://files.example.test/lesson.MP4?token=synthetic', title: 'Video file' },
      { kind: 'embed', url: 'https://files.example.test/media', file_name: 'podcast.MP3', title: 'Audio file' },
      { kind: 'document', url: 'https://files.example.test/download', file_name: 'handout.PDF', title: 'PDF file' },
    ],
    reading_html: '', unavailable_attachments: [], quiz: null, has_quiz_review: false,
    historical: { answers: [] }, history: [],
  } as never);
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  const media = await screen.findAllByTestId('saved-media');
  expect(media.map(item => item.getAttribute('data-kind'))).toEqual(['video', 'audio', 'pdf']);
  expect(advancedAdminLegacyQuizReview).not.toHaveBeenCalled();
});

it('plays a scoped audio source in a native audio element', async () => {
  const stream = '/login_api/advanced-admin/learners/42/learning/material/8/12/media/0/';
  vi.mocked(advancedAdminMaterial).mockResolvedValue({
    media: [{ kind: 'document', url: stream, file_name: 'recording.mp3', title: 'Recorded audio' }],
    reading_html: '', unavailable_attachments: [], quiz: null, has_quiz_review: false,
    historical: { answers: [] }, history: [],
  } as never);
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="material" completed />);
  const audio = await screen.findByLabelText('Recorded audio');
  expect(audio.tagName).toBe('AUDIO');
  expect(audio).toHaveAttribute('src', `${window.location.origin}${stream}`);
  expect(screen.getByRole('status', { name: 'Loading audio' })).toHaveAttribute('aria-busy', 'true');
  fireEvent.loadedMetadata(audio);
  expect(screen.queryByRole('status', { name: 'Loading audio' })).not.toBeInTheDocument();
  expect(audio).toHaveClass('w-full');
  expect(screen.queryByTestId('saved-media')).not.toBeInTheDocument();
});

it('shows the saved quiz body without inventing a missing answer key', async () => {
  vi.mocked(advancedAdminLegacyQuizReview).mockResolvedValue({ quiz: {
    body: '<p>Quiz introduction</p>', questions: [{
      id: '1', text: 'Question', options: ['A', 'B'], correctAnswers: [], learnerAnswers: [],
    }],
  } });
  render(<AdminLegacyActivityContent learnerId={42} groupId={8} activityId={12} kind="quiz" completed={false} />);
  expect(await screen.findByText('Quiz introduction')).toBeVisible();
  expect(screen.getByText('Correct answer is unavailable in the saved source.')).toBeVisible();
  expect(advancedAdminMaterial).not.toHaveBeenCalled();
});

it('shows current LMS quiz answers through the admin-only component review', async () => {
  vi.mocked(advancedAdminComponentQuizReview).mockResolvedValue({ quiz: {
    body: 'Current quiz', questions: [{ id: '5', text: 'Question', options: ['A', 'B'],
      correctAnswers: ['B'], learnerAnswers: ['A'] }],
  } });
  render(<AdminNativeQuizReview learnerId={42} componentId="component-1" />);
  expect(await screen.findByText('Current quiz')).toBeVisible();
  expect(screen.getByText('Correct answer')).toBeVisible();
  expect(advancedAdminComponentQuizReview).toHaveBeenCalledWith(42, 'component-1', expect.any(AbortSignal));
});
