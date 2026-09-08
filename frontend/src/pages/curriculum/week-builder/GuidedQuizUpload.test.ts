import { describe, expect, it } from 'vitest';

import { XML_QUESTION_TEMPLATE, validateXml } from './GuidedQuizUpload';

describe('GuidedQuizUpload XML validation', () => {
  it('ships a valid downloadable template containing all eight question types', () => {
    const result = validateXml(XML_QUESTION_TEMPLATE);

    expect(result.level).toBe('ok');
    expect(result.stats).toContainEqual({ label: 'Questions', value: '8' });
  });

  it('accepts all supported question types using their native XML structures', () => {
    const result = validateXml(`
      <quiz><questions>
        <question type="single_choice"><text>Single?</text>
          <option correct="false">No</option><option correct="true">Yes</option>
        </question>
        <question type="multiple_choice"><text>Multiple?</text>
          <option correct="true">A</option><option correct="true">B</option>
        </question>
        <question type="true_false"><text>True?</text>
          <option correct="true">True</option><option correct="false">False</option>
        </question>
        <question type="matching"><text>Match?</text><pairs>
          <pair><left>200</left><right>OK</right></pair>
        </pairs></question>
        <question type="image_matching"><text>Images?</text><pairs>
          <pair><image>assets/circle.png</image><display>Image A</display><right>Circle</right></pair>
        </pairs></question>
        <question type="keywords"><text>Keywords?</text><acceptedKeywords>
          <keyword>red</keyword><keyword>amber</keyword>
        </acceptedKeywords></question>
        <question type="fill_gap"><text>Fill _____.</text><acceptedAnswers>
          <answer>answer</answer><answer>answer key</answer>
        </acceptedAnswers></question>
        <question type="ordering"><text>Order?</text><items>
          <item id="1">First</item><item id="2">Second</item>
        </items><correctOrder>1,2</correctOrder></question>
      </questions></quiz>
    `);

    expect(result.level).toBe('ok');
    expect(result.stats).toContainEqual({ label: 'Questions', value: '8' });
  });

  it('accepts answer elements for choice questions', () => {
    const result = validateXml(`
      <quiz><questions><question type="single_choice"><text>Choose</text><answers>
        <answer correct="false">Wrong</answer>
        <answer correct="true">Right</answer>
      </answers></question></questions></quiz>
    `);

    expect(result.level).toBe('ok');
  });
});
