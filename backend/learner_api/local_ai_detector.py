"""Offline, advisory text classification. No Django, database, or network imports.

Model weights are provisioned separately. Scores are not proof of authorship.
"""
import math
import re
import sys
import threading
from pathlib import Path

MODEL_ID = 'desklib/ai-text-detector-v1.01'
MODEL_REVISION = '5fdea974cd4287c61674951ec78803aa274e2fb7'
MODEL_DIR = Path(sys.prefix) / 'models' / 'desklib-ai-text-detector-v1.01'
MIN_WORDS = 80
MAX_CHARACTERS = 24000
_lock = threading.Lock()
_runtime = None


class DetectorUnavailable(Exception):
    pass


class DetectorBusy(Exception):
    pass


def text_windows(text):
    words = list(re.finditer(r'\S+', text))
    if len(words) < MIN_WORDS:
        return []
    windows = []
    for start in range(0, len(words), 180):
        end = min(start + 180, len(words))
        if end - start < MIN_WORDS and windows:
            windows[-1] = (windows[-1][0], len(text))
        else:
            windows.append((0 if start == 0 else words[start].start(),
                            len(text) if end == len(words) else words[end].start()))
    return windows


def _load_runtime():
    global _runtime
    if _runtime is not None:
        return _runtime
    if not (MODEL_DIR / 'model.safetensors').is_file():
        raise DetectorUnavailable('The local detector model has not been installed.')
    try:
        import torch
        from transformers import AutoConfig, AutoModel, AutoTokenizer
        from safetensors.torch import load_file
    except ImportError as exc:
        raise DetectorUnavailable('The local detector dependencies are not installed.') from exc
    # Reconstruct the publisher's mean-pooling classifier; never execute Hub code.
    config = AutoConfig.from_pretrained(str(MODEL_DIR), local_files_only=True, trust_remote_code=False)
    class Detector(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.model = AutoModel.from_config(config, trust_remote_code=False)
            self.classifier = torch.nn.Linear(config.hidden_size, 1)

        def forward(self, input_ids, attention_mask):
            hidden = self.model(input_ids=input_ids, attention_mask=attention_mask)[0]
            mask = attention_mask.unsqueeze(-1).expand(hidden.size()).float()
            pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
            return self.classifier(pooled)

    model = Detector()
    model.load_state_dict(load_file(str(MODEL_DIR / 'model.safetensors')), strict=True)
    model.eval()
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True, trust_remote_code=False)
    _runtime = (torch, model, tokenizer)
    return _runtime


def _predict(text):
    torch, model, tokenizer = _load_runtime()
    encoded = tokenizer(text, return_tensors='pt', truncation=False)
    if encoded['input_ids'].shape[1] > 768:
        return None  # Never silently truncate text and report it as fully checked.
    with torch.inference_mode():
        return torch.sigmoid(model(encoded['input_ids'], encoded['attention_mask'])).item()


def screen_text(text, base):
    """Return (windows, early result); the early result is set when the text cannot be assessed."""
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_CHARACTERS:
        raise ValueError(f'Enter text up to {MAX_CHARACTERS:,} characters.')
    windows = text_windows(text)
    if not windows:
        return windows, {**base, 'status': 'insufficient_text', 'message': 'At least 80 words are required. Short answers cannot be assessed by this checker.'}
    letters = [c for c in text if c.isalpha()]
    if letters and sum('a' <= c.lower() <= 'z' for c in letters) / len(letters) < .9:
        return windows, {**base, 'status': 'unsupported_text', 'message': 'This check is intended for English text only.'}
    return windows, None


def segment(text, start, end, flagged):
    # JavaScript indexes UTF-16, unlike Python's Unicode code-point indexes.
    return {'start': len(text[:start].encode('utf-16-le')) // 2,
            'end': len(text[:end].encode('utf-16-le')) // 2,
            'flagged': flagged}


def check_text(text, *, predict=None):
    base = {'model': MODEL_ID, 'revision': MODEL_REVISION, 'advisoryOnly': True, 'segments': []}
    windows, early = screen_text(text, base)
    if early:
        return early
    if not _lock.acquire(blocking=False):
        raise DetectorBusy('The local checker is busy. Please retry shortly.')
    try:
        segments = []
        for start, end in windows:
            score = (predict or _predict)(text[start:end])
            if score is None:
                return {**base, 'status': 'unsupported_text', 'message': 'This text cannot be assessed without truncation. No result has been issued.'}
            if not math.isfinite(score) or not 0 <= score <= 1:
                raise DetectorUnavailable('The local checker returned an invalid result.')
            segments.append(segment(text, start, end, score >= .5))
        return {**base, 'status': 'review_suggested' if any(s['flagged'] for s in segments) else 'no_signal',
                'segments': segments,
                'message': 'Highlighted passages are model estimates, not proof of AI use. A tutor must review any concern. No signal does not prove human authorship.'}
    finally:
        _lock.release()
