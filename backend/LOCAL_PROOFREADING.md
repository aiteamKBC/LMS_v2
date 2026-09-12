# Local proofreading trial

The existing proofreading button can use Ollama on the Django machine. Other
AI features, including the server-side recorded-audio transcription fallback,
retain their existing providers.

Install Ollama, then download the trial model:

```powershell
ollama pull qwen2.5:1.5b
```

Set these in `backend/.env`, then restart Django:

```dotenv
PROOFREAD_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_PROOFREAD_MODEL=qwen2.5:1.5b
OLLAMA_PROOFREAD_TIMEOUT=120
```

Ollama must be running on the same machine. Only loopback HTTP URLs and
downloaded models are supported for this trial. No OpenAI key, moderation
request or paid fallback is used in local mode. Content suitability is judged
by the local model's proofreading prompt, rather than a separate moderation
model; that is not equivalent to the OpenAI moderation pipeline.

The model receives the existing minimum-word, formatting and fidelity rules.
The frontend still counts the returned words and prevents accepting an
undersized suggestion. Small-model quality and CPU latency need evaluation
before using this for a production learner population. Downloads require an
internet connection; inference uses the local Ollama service.

To revert proofreading only, set `PROOFREAD_PROVIDER=openai` and restart Django.
The existing OpenAI key and model settings are preserved.

References: https://docs.ollama.com/api/chat and https://ollama.com/library/qwen2.5:1.5b
