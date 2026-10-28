"""Benchmark-only secret retrieval from Windows Credential Manager."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import os


DEFAULT_READER_CREDENTIAL_TARGET = "LMS_v2/phase4g2/lms_benchmark_reader"


class BenchmarkCredentialError(RuntimeError):
    pass


class _Credential(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


def read_benchmark_reader_url(environ=None):
    """Return the Reader URL without consulting `.env` or owner variables."""
    environ = os.environ if environ is None else environ
    injected = environ.get("LMS_BENCHMARK_READER_URL", "").strip()
    if injected:
        return injected
    if os.name != "nt":
        raise BenchmarkCredentialError(
            "Benchmark Reader URL is absent and Windows Credential Manager is unavailable."
        )
    target = environ.get(
        "LMS_BENCHMARK_READER_CREDENTIAL_TARGET",
        DEFAULT_READER_CREDENTIAL_TARGET,
    ).strip()
    if not target:
        raise BenchmarkCredentialError("Benchmark Reader credential target is empty.")
    advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    pointer = ctypes.POINTER(_Credential)()
    advapi32.CredReadW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(ctypes.POINTER(_Credential)),
    ]
    advapi32.CredReadW.restype = wintypes.BOOL
    advapi32.CredFree.argtypes = [ctypes.c_void_p]
    if not advapi32.CredReadW(target, 1, 0, ctypes.byref(pointer)):
        raise BenchmarkCredentialError(
            "Benchmark Reader credential is unavailable in Windows Credential Manager."
        )
    try:
        credential = pointer.contents
        blob = ctypes.string_at(
            credential.CredentialBlob, credential.CredentialBlobSize
        )
        value = blob.decode("utf-16-le").strip()
        if not value:
            raise BenchmarkCredentialError("Benchmark Reader credential is empty.")
        return value
    finally:
        advapi32.CredFree(pointer)
