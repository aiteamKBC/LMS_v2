"""KBC Progress Review visual identity — extracted, not invented.

Every value here was read directly out of the two supplied reference decks
(Bethanie_Taylor_Grenfell_Progress_Review_Spinnaker_v2.pptx and
Curtis_Cooper_Progress_Review_September_2026_Updated.pptx): colours via a
frequency scan of every `<a:srgbClr val="…">` across both files' slide XML,
fonts via `<a:latin typeface="…">` runs. The presentation theme's own
`<a:clrScheme>` is the generic Office default (unused by these decks — every
colour is a direct run/shape override), so it is deliberately not the source
here.

This module exists so a design refresh means editing these constants (or
re-running the extraction against a new pair of reference decks and updating
them), never touching pptx_generator.py's slide-population logic.
"""
from pptx.dml.color import RGBColor
from pptx.util import Pt

SLIDE_WIDTH_IN = 20.0
SLIDE_HEIGHT_IN = 11.25

FONT_BODY = "Aptos"
FONT_BOLD = "Aptos Bold"


def _c(hex_value: str) -> RGBColor:
    return RGBColor.from_string(hex_value)


class PptxTheme:
    # Primary accent
    primary = _c("5D49D8")
    primary_dark = _c("5C3291")

    # Heading / dark chrome
    heading = _c("083149")
    heading_alt = _c("002D40")

    # Body text
    text_body = _c("1F2937")
    text_body_alt = _c("23292F")
    text_muted = _c("626C7D")
    text_muted_2 = _c("60696C")

    # Backgrounds
    page_bg = _c("FAFAFF")
    card_bg = _c("FFFFFF")
    card_tint_purple = _c("E8E4FF")
    card_tint_purple_2 = _c("F4F1FF")
    info_bg = _c("F5F9FF")

    # Borders
    border = _c("E5E7EB")
    border_alt = _c("E1E4EB")

    # RAG — text-colour only in the reference decks (a metric's status is a
    # coloured WORD like "Amber-Green", never a coloured chip/icon; the
    # freeform icon colours on KPI cards are a decorative per-metric accent
    # rotation, unrelated to RAG — see progress_reviews_api/README.md).
    rag_green = _c("16A34A")
    rag_green_bg = _c("ECFDF5")
    rag_amber = _c("EF6925")
    rag_amber_bg = _c("FFF5E8")
    rag_amber_dark = _c("D97706")
    rag_red = _c("DC2626")

    # KPI-card top-accent-bar rotation (decorative only — see note above)
    kpi_accent_rotation = (_c("0096A5"), _c("EF6925"), _c("16A34A"), _c("5D49D8"))


THEME = PptxTheme()


def font_size(pt: float) -> Pt:
    return Pt(pt)
