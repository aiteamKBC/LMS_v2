# Local assignment AI-writing check

The assignment answer and learning fields offer an on-demand local model check.
Suspected passages are highlighted separately without changing the saved answer.
Results are estimates, not proof of AI use or copying from a particular service.
A tutor must review concerns; this feature does not automatically block Next or submission.
No result is saved to historical submissions. No database changes are required.

## Provisioning
Using the same Python environment as Django:
```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-local-ai.txt
.\backend\.venv\Scripts\python.exe backend/scripts/download_local_ai_detector.py
```
The explicit provisioning script downloads roughly 1.75 GB of model files and verifies
the pinned weights checksum. Weights live under the Python environment's models directory,
not in Git. Provision separately on each deployed server; local installation does not deploy it.
Inference uses local files only and sends no answer text to Hugging Face or OpenAI.

Model: https://huggingface.co/desklib/ai-text-detector-v1.01
Pinned revision: 5fdea974cd4287c61674951ec78803aa274e2fb7 (MIT).
The classifier uses the publisher's mean pooling and sigmoid threshold of 0.5.
Highlighted windows are passages selected by this classifier, not proven AI-generated words.
The 80-word minimum and 180-word windows are application limits, not validated accuracy guarantees.
English only; short or oversized-token passages report Not assessed. The Latin-character
screen is only a basic input check, not reliable language identification.
No signal does not establish human authorship. Built-in AI proofreading/generation may be flagged.

## Operations and security
Each server process lazily loads its own CPU model and allows one check at a time.
Allow several GB of available RAM per worker; measure real latency and memory before deployment.
Busy checks return 429; missing model/dependencies return 503, never a clean result.
The UI times out after 120 seconds. Disconnecting does not cancel CPU inference already running.
Normal Django CSRF protection and the existing learner ownership/admin gate apply to POST.
GET only issues a CSRF token. The response is not cached and text is not logged by this feature.
No real Teams, email, database, or paid API calls belong in regression tests.

## Verification
```powershell
.\backend\.venv\Scripts\python.exe -m unittest discover -s backend/learner_api -t backend -p test_local_ai_detector.py
npm.cmd --prefix frontend run test -- src/pages/learner/video-watch/LocalAiTextCheck.test.tsx
npm.cmd --prefix frontend run test:teams
```
Unit tests inject scores; they verify behavior, not detector accuracy.
Evaluate false positives and false negatives with consented, representative learner writing
before using results in an academic review. Uploaded documents and external-source plagiarism
matching are outside this implementation.
