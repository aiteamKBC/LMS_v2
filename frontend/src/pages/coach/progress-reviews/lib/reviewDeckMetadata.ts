import type { ProgressReviewSlidesDeck } from '../components/ProgressReviewSlidesModal';

/** Every slide describes the same learner and programme as the cover. */
export function reviewDeckMetadata(deck: ProgressReviewSlidesDeck) {
  const cover = deck.slides.find(slide => slide.type === 'cover');
  const value = (label: string) => cover?.details.find(detail => detail.label.toLowerCase() === label)
    ?.value?.trim() || '';
  return {
    programme: value('programme') || 'Programme not recorded',
    employer: value('employer') || 'Employer not recorded',
    manager: value('line manager'),
  };
}
