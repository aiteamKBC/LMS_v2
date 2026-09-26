"""Embedding providers.

``FakeEmbeddingProvider`` is deterministic and offline: the same text always
yields the same unit vector, so tests and local runs exercise the full pipeline
at zero cost. ``OpenAIEmbeddingProvider`` refuses to run unless paid calls are
explicitly allowed (see config.paid_calls_allowed) -- it can never be reached
by accident from a development machine.
"""
from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass

from . import config
from .tokens import count_tokens

DEFAULT_DIMS = 1536
MAX_BATCH_INPUTS = 100


class PaidCallsDisabled(RuntimeError):
    pass


@dataclass
class EmbeddingResult:
    vectors: list[list[float]]
    total_tokens: int
    model: str


class FakeEmbeddingProvider:
    provider = "fake"
    model = "fake-embedding"

    def __init__(self, dims=DEFAULT_DIMS):
        self.dims = dims
        self.calls = 0

    def _vector(self, text):
        seed = int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")
        rng = random.Random(seed)
        raw = [rng.gauss(0.0, 1.0) for _ in range(self.dims)]
        norm = math.sqrt(sum(v * v for v in raw)) or 1.0
        return [v / norm for v in raw]

    def embed(self, texts):
        if len(texts) > MAX_BATCH_INPUTS:
            raise ValueError(f"At most {MAX_BATCH_INPUTS} inputs per batch.")
        self.calls += 1
        return EmbeddingResult([self._vector(t) for t in texts], sum(count_tokens(t) for t in texts), self.model)


class OpenAIEmbeddingProvider:
    provider = "openai"

    def __init__(self, model="text-embedding-3-small", dims=DEFAULT_DIMS):
        if not config.paid_calls_allowed():
            raise PaidCallsDisabled(
                "Paid embedding calls are disabled. Set KNOWLEDGE_BASE_PROVIDERS=openai and "
                "KNOWLEDGE_BASE_ALLOW_PAID=true only for an approved run."
            )
        self.model = model
        self.dims = dims

    def embed(self, texts):  # pragma: no cover - never runs without approval
        if len(texts) > MAX_BATCH_INPUTS:
            raise ValueError(f"At most {MAX_BATCH_INPUTS} inputs per batch.")
        from django.conf import settings
        from openai import OpenAI

        client = OpenAI(api_key=settings.OPENAI_API_KEY, timeout=60, max_retries=0)
        response = client.embeddings.create(model=self.model, input=texts, dimensions=self.dims)
        return EmbeddingResult([item.embedding for item in response.data], response.usage.total_tokens, self.model)


def get_embedding_provider():
    if config.providers() == "openai":
        return OpenAIEmbeddingProvider()
    return FakeEmbeddingProvider()
