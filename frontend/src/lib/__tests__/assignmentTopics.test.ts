import { describe, expect, it } from 'vitest';
import { assignmentTopics, configuredAssignmentTopics, presentTopic, splitLegacyMaterials, topicHasContent } from '../assignmentTopics';

// Exactly what import_mba_curriculum.extra_materials_html writes.
const item = (url: string, label: string) => `<li><a href="${url}" target="_blank" rel="noreferrer">${label}</a></li>`;
const imported = (...items: string[]) => `<p><strong>Additional materials</strong></p><ul>${items.join('')}</ul>`;
const LEGACY = imported(item('https://old.example.test/brief.docx', 'Brief &amp; template'), item('https://www.example.test/reading', 'https://www.example.test/reading'));

describe('topics offered to learners', () => {
  it('keeps the three slots for the builder but offers learners only the ones an author filled in', () => {
    const stored = JSON.stringify([
      { id: '1', name: 'Unused', question: '<p>&nbsp;</p>', instructions: '', resources: [] },
      { id: '2', name: 'Planning', question: 'Explain your plan', instructions: '', resources: [] },
      { id: '3', name: '', question: '', instructions: 'Use the template', resources: [] },
    ]);
    expect(assignmentTopics(stored).map(topic => topic.id)).toEqual(['1', '2', '3']);
    expect(configuredAssignmentTopics(stored).map(topic => topic.id)).toEqual(['2', '3']);
    expect(configuredAssignmentTopics('')).toEqual([]);
  });

  it('counts a question, instructions or a resource as content, but not a name alone', () => {
    const [topic] = assignmentTopics([{ id: '1', name: 'Named only' }]);
    expect(topicHasContent(topic)).toBe(false);
    expect(topicHasContent({ ...topic, instructions: '<p>Read the guide</p>' })).toBe(true);
    expect(topicHasContent({ ...topic, resources: [{ fileName: 'a.pdf', url: '/curriculum_api/curriculum/uploads/a.pdf', size: 1, contentType: 'application/pdf' }] })).toBe(true);
  });
});

describe('imported "Additional materials" link list', () => {
  it('is split out of the instructions with decoded labels', () => {
    expect(splitLegacyMaterials(LEGACY)).toEqual({ instructions: '', links: [
      { label: 'Brief & template', url: 'https://old.example.test/brief.docx' },
      { label: 'https://www.example.test/reading', url: 'https://www.example.test/reading' },
    ] });
  });

  it('keeps authored text written before the list', () => {
    const result = splitLegacyMaterials(`<p>Submit one report.</p>${LEGACY}`);
    expect(result.instructions).toBe('<p>Submit one report.</p>');
    expect(result.links).toHaveLength(2);
  });

  it('leaves any other markup untouched, including authored text that mentions the heading', () => {
    for (const html of ['', '<p>Use the template.</p>',
      '<p><strong>Additional materials</strong></p><p>See your coach.</p>',
      `${LEGACY}<p>Then submit.</p>`, LEGACY.replace(' target="_blank"', '')]) {
      expect(splitLegacyMaterials(html)).toEqual({ instructions: html, links: [] });
    }
    expect(splitLegacyMaterials(null)).toEqual({ instructions: '', links: [] });
  });

  it('drops links a learner page must not open', () => {
    expect(splitLegacyMaterials(imported(item('javascript:alert(1)', 'Bad'), item('https://example.test/ok', 'Good'))).links)
      .toEqual([{ label: 'Good', url: 'https://example.test/ok' }]);
  });
});

describe('what a learner is shown for a topic', () => {
  const file = { fileName: 'guide.pdf', url: '/curriculum_api/curriculum/uploads/guide.pdf', size: 3, contentType: 'application/pdf' };

  it('shows the question and instructions separately and moves an imported list under resources', () => {
    const [topic] = assignmentTopics([{ id: '1', question: 'Analyse the campaign.', instructions: LEGACY, resources: [file] }]);
    const shown = presentTopic(topic);
    expect(shown.question).toBe('Analyse the campaign.');
    expect(shown.instructions).toBe('');
    expect(shown.files).toEqual([file]);
    expect(shown.links.map(link => link.label)).toEqual(['Brief & template', 'https://www.example.test/reading']);
  });

  it('lists link resources once and previews only real files', () => {
    const link = { fileName: 'Reading', url: 'https://www.example.test/reading', size: 0, contentType: '', link: true };
    const topic = assignmentTopics([{ id: '2', question: 'Q', instructions: `<p>Read first.</p>${LEGACY}`, resources: [file, link] }])[1];
    const shown = presentTopic(topic);
    expect(shown.instructions).toBe('<p>Read first.</p>');
    expect(shown.files).toEqual([file]);
    expect(shown.links).toEqual([
      { label: 'Reading', url: 'https://www.example.test/reading' },
      { label: 'Brief & template', url: 'https://old.example.test/brief.docx' },
    ]);
  });
});
