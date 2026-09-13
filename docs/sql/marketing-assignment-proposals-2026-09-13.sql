-- DRAFT QUESTIONS FOR CURRICULUM REVIEW. OWNER-EXECUTED ONLY; NOT EXECUTED BY CODEX.
-- Review docs/marketing-assignment-proposals.md before choosing these questions.
-- New proposals based on the module title, not recovered/approved week content.
-- Changes only the proposed title, both brief keys and updated_at for six exact empty targets.
-- Uses the learner reader's parent-deletion visibility rule. Weeks 13 and 15 assignments
-- carry parent-deletion flags; week 13 also has a parent-deleted week. Review these two targets.
-- No deletion flag is cleared; no assignment, week, module or account is restored or created.
-- Renamed targets, genuinely deleted targets and any newly authored content/resources are skipped.
-- KSBs, dates, hours, programme status, other settings and student work are unchanged.
-- SELECT using the same eligibility predicate matched exactly 6 rows on 2026-09-13.
-- Expected RETURNING count: 6 if those rows remain unchanged. Re-running skips renamed targets.

WITH proposed(component_id, week_number, expected_title, proposed_title, brief) AS (
VALUES
    ('COMP-2026091211110201218WHAP', 4, 'Assignment 22', 'Marketing opportunity, audience and objectives', 'Choose one marketing opportunity in your organisation, or a case approved by your tutor. Explain the business problem and why marketing could help.

1. Describe the product or service, the current situation and the evidence you used to identify the opportunity. Distinguish facts from assumptions.
2. Compare two possible audience segments. Select one priority segment and explain its needs, the benefit your organisation offers and why you selected it.
3. Write one measurable marketing objective. State the starting position, target, measurement period and how you would obtain the data. If a baseline is unavailable, explain how you will establish it.
4. Identify one practical constraint and one risk that your plan must address.

Support your answer with an appropriate research note, anonymised data extract or approved case evidence. Use at least 120 words and put each main point on a separate line. Complete the remaining learning, evidence, KSB, reflection and presentation sections of the assignment form. Label any case figures as simulated; do not present them as achieved workplace results.'),
    ('COMP-20260912111115422G79JFL', 8, 'Assignment 22', 'Campaign plan and channel choices', 'Develop a practical campaign plan for the opportunity you selected earlier, or a different tutor-approved case. Explain how the planned activity will reach the audience and support the business objective.

1. State the objective, priority audience and central message. Explain how the message addresses that audience''s needs.
2. Compare at least two suitable marketing channels. Explain your choices, the role of each channel and how the messages will work together.
3. Set out the activities, sequence, responsibilities, resources and proposed budget. Identify which costs and timings are confirmed and which are estimates.
4. Choose success measures for the campaign. State each measure''s target, data source, review date and the action you would take if performance falls behind.

Attach a campaign plan, schedule or equivalent evidence that supports your answer. Use at least 120 words, with one main point per line, and complete the other sections of the assignment form. Describe planned benefits as expected outcomes and explain how you will measure them.'),
    ('COMP-202609121258295664CJ6R0', 12, 'Assignment 22', 'Campaign performance and evidence', 'Review the performance of a marketing campaign or a tutor-approved case using a consistent set of evidence. You may use your earlier plan if results are available.

1. Identify the campaign objective, intended audience, reporting period and data sources. Explain whether you are using actual results or a supplied case dataset.
2. Compare the results with the baseline and target for at least two relevant measures. Show how you calculated any rates or changes, using comparable periods and clear units.
3. Explain two findings that matter to the business. Separate what the evidence demonstrates from possible explanations that still need checking.
4. Identify a limitation in the data and recommend one specific action, stating who should take it and how its effect could be measured.

Include an anonymised results table, report extract or other appropriate evidence. Use at least 120 words, with one main point per line, and complete the other sections of the assignment form. If live results are unavailable, agree a case dataset with your tutor and label it clearly. Do not invent achieved results or assume that all business changes were caused by the campaign.'),
    ('COMP-20260912111137924UHC32Z', 13, 'Assignment 2', 'Reading review applied to a marketing decision', 'Use two learning resources from this module, or two resources agreed with your tutor, to examine one marketing planning decision. If no reading has been supplied, ask your tutor to identify the resources before beginning.

1. Identify both resources with enough reference information for your tutor to locate them, including the relevant page or section where possible.
2. Explain one useful idea from each resource in your own words. Compare where the ideas agree, differ or apply in different circumstances.
3. Evaluate the relevance and limitations of the resources for your chosen organisation or case. Consider their evidence, context and currency.
4. Apply the reading to one specific decision in your marketing plan. Explain what you would change or retain, why, and what evidence would help you evaluate the decision.

Provide your reading notes or a referenced comparison as evidence. Use at least 120 words, with one main point per line, and complete the other sections of the assignment form. Refer to the sources without copying extended passages. Explain your own reasoning rather than supplying a general summary of marketing theory.'),
    ('COMP-20260912111200108XJWHN7', 15, 'Assignment 22', 'Marketing improvement and test plan', 'Propose an improvement to a marketing activity using evidence from your performance review or an approved case. Design a test that could show whether the improvement helps.

1. Describe the problem or opportunity, the supporting evidence and the audience affected. Explain why this issue is a priority.
2. State your proposed change and the result you expect. Explain the reasoning that connects the change to that result.
3. Describe a practical comparison or test. Identify what will change, what should stay consistent, the people involved, the required resources and the planned timing.
4. Define the measures, baseline, success criteria and review point. Explain what you would do if the test succeeds, fails or produces inconclusive results.

Include an improvement proposal, test outline or equivalent evidence. Use at least 120 words and one main point per line, then complete the other assignment sections. Distinguish expected results from measured outcomes. State who should review the proposal and who would be responsible for implementing the test.'),
    ('COMP-20260912125906134SJ3342', 16, 'Assignment 22', 'Marketing impact review and next actions', 'Prepare a concise review connecting your marketing objective, plan, activity and results. Use the project developed through the module or a tutor-approved case, and make your own contribution clear.

1. Restate the objective and explain the main planning decisions, including the audience, channels and resources. Note any changes made during the work.
2. Review what was delivered and compare the available results with the original success measures. Distinguish activity outputs from business outcomes and identify anything that is not yet measurable.
3. Explain your personal contribution, what you learned and one decision you would approach differently. Link the claims in your answer to appropriate evidence.
4. Recommend the next actions, naming an owner or role, a timeframe and a measure of success for each. Explain how your proposal follows from the evidence.

Use at least 120 words, with one main point per line, and support the review with an evidence summary. Complete the remaining assignment sections and prepare a presentation consistent with your written account. Label case data and expected benefits clearly; do not claim workplace achievements that have not happened.')
)
UPDATE curriculum.components c
SET title=p.proposed_title,
    settings_json=COALESCE(c.settings_json,'{}'::jsonb)
      || jsonb_build_object('assignmentBrief',p.brief,'assignmentContent',p.brief),
    updated_at=now()
FROM proposed p
WHERE c.id=p.component_id
  AND c.module_catalogue_id='MOD-20260912105734147219'
  AND lower(c.type)='assignment' AND c.title=p.expected_title
  AND (c.deleted_at IS NULL OR c.deleted_via_parent IS NOT NULL)
  AND COALESCE(btrim(c.description),'')=''
  AND EXISTS (
    SELECT 1 FROM curriculum.weeks w JOIN curriculum.modules m ON m.module_catalogue_id=w.module_catalogue_id
    WHERE w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
      AND w.week_number=p.week_number
      AND (w.deleted_at IS NULL OR w.deleted_via_parent IS NOT NULL)
      AND m.deleted_at IS NULL
  )
  AND COALESCE(btrim(c.settings_json->>'assignmentBrief'),'')=''
  AND COALESCE(btrim(c.settings_json->>'assignmentContent'),'')=''
  AND COALESCE(btrim(c.settings_json->>'assignmentFileUrl'),'')=''
  AND COALESCE(btrim(c.settings_json->>'uploadedFileUrl'),'')=''
  AND COALESCE(btrim(c.settings_json->>'resourceUrl'),'')=''
  AND COALESCE(btrim(c.settings_json->>'readingContent'),'')=''
  AND COALESCE(btrim(c.settings_json->>'learnerGuidance'),'')=''
  AND COALESCE(btrim(c."Reflection_Question"),'') IN ('','What did you learn? How will you apply this at work? Which KSBs did this develop?')
  AND COALESCE(btrim(c.settings_json->>'reflectionPrompt'),'') IN ('','What did you learn? How will you apply this at work? Which KSBs did this develop?')
RETURNING c.id,c.week_id,c.title;
