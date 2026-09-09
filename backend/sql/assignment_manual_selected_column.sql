-- Run manually in Neon SQL Editor. NULL retains the classifier's decision.
ALTER TABLE fetching_evidence.assignment_classification_evaluations
    ADD COLUMN IF NOT EXISTS manual_selected boolean DEFAULT NULL;
