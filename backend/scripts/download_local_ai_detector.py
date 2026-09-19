"""Explicit one-time download. Does not import Django or access a database."""
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api.local_ai_detector import MODEL_DIR, MODEL_ID, MODEL_REVISION


if __name__ == '__main__':
    from huggingface_hub import snapshot_download
    snapshot_download(
        MODEL_ID, revision=MODEL_REVISION, local_dir=str(MODEL_DIR),
        allow_patterns=['config.json', 'model.safetensors', 'tokenizer.json',
                        'tokenizer_config.json', 'special_tokens_map.json',
                        'added_tokens.json', 'spm.model', 'README.md'],
    )
    with (MODEL_DIR / 'model.safetensors').open('rb') as weights:
        digest = hashlib.file_digest(weights, 'sha256').hexdigest()
    expected = 'c024a1704c65f5a4bffeda58745c58fc0ed67d6ca07b158b068a257238815265'
    if digest != expected:
        raise RuntimeError('Downloaded model checksum does not match the pinned release.')
    print('Pinned local detector downloaded and checksum verified.')
