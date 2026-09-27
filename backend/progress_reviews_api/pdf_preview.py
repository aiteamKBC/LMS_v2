"""PDF rendering of a generated deck, for the in-page "View slides" viewer.

Browsers cannot render a .pptx, and handing the file's storage link to an
online viewer would send learner data outside the platform. So the server
converts the deck to PDF itself and the page shows it in the browser's own
PDF viewer.

Converter, in order:
  LibreOffice   KBC_LIBREOFFICE_BINARY, or `soffice` / `libreoffice` on PATH
                (install it on the server: `apt install libreoffice-impress`)
  PowerPoint    Windows development machines only, through its COM automation

The PDF is cached next to the deck in blob storage, so each deck is converted
once. A generated deck never changes in place (regenerating creates a new
run), so the cache can never go stale.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

CONVERT_TIMEOUT_SECONDS = 120
_WINDOWS_LIBREOFFICE = Path(r"C:\Program Files\LibreOffice\program\soffice.exe")


class PreviewUnavailable(Exception):
    """No PPTX-to-PDF converter is installed on this server."""


def _libreoffice() -> Optional[str]:
    configured = os.environ.get("KBC_LIBREOFFICE_BINARY", "").strip()
    if configured:
        return configured
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    if sys.platform == "win32" and _WINDOWS_LIBREOFFICE.exists():
        return str(_WINDOWS_LIBREOFFICE)
    return None


def _convert_with_libreoffice(binary: str, source: Path, out_dir: Path) -> Path:
    # A private profile directory lets conversions run concurrently and never
    # touch a desktop user's LibreOffice settings.
    profile = out_dir / "profile"
    subprocess.run(
        [binary, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore",
         "--convert-to", "pdf", "--outdir", str(out_dir), str(source)],
        check=True, capture_output=True, timeout=CONVERT_TIMEOUT_SECONDS,
    )
    return out_dir / f"{source.stem}.pdf"


def _convert_with_powerpoint(source: Path, out_dir: Path) -> Path:
    target = out_dir / f"{source.stem}.pdf"
    script = (
        "$ErrorActionPreference='Stop';"
        "$app=New-Object -ComObject PowerPoint.Application;"
        f"$deck=$app.Presentations.Open('{source}',$true,$false,$false);"
        f"try {{ $deck.SaveAs('{target}',32) }} finally {{ $deck.Close(); $app.Quit() }}"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        check=True, capture_output=True, timeout=CONVERT_TIMEOUT_SECONDS,
    )
    return target


def convert_pptx_to_pdf(pptx_bytes: bytes) -> bytes:
    binary = _libreoffice()
    if binary is None and sys.platform != "win32":
        raise PreviewUnavailable("PDF preview needs LibreOffice installed on the server.")
    with tempfile.TemporaryDirectory(prefix="kbc-deck-") as tmp:
        out_dir = Path(tmp)
        source = out_dir / "deck.pptx"
        source.write_bytes(pptx_bytes)
        try:
            pdf = (
                _convert_with_libreoffice(binary, source, out_dir) if binary
                else _convert_with_powerpoint(source, out_dir)
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise PreviewUnavailable("The slides could not be converted for preview.") from exc
        if not pdf.exists():
            raise PreviewUnavailable("The slides could not be converted for preview.")
        return pdf.read_bytes()
