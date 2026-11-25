"""Shared renderer constants and the existing unsupported-document exception."""
from __future__ import annotations

from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.enum.shapes import PP_PLACEHOLDER
from pptx.enum.text import MSO_ANCHOR
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn


MODEL_VERSION = 8


RENDER_DIR_NAME = '_slide_renders'


OOXML_SUFFIXES = {'.pptx', '.ppsx', '.pptm', '.ppsm'}


LEGACY_SUFFIXES = {'.ppt', '.pps'}


PDF_SUFFIXES = {'.pdf'}


PDF_RENDER_ZOOM = 1.5


PDF_MAX_PAGES = 60


EMU_PER_PX = 9525


PT_TO_PX = 96 / 72


DEFAULT_SLIDE_WIDTH_PX = 960


DEFAULT_SLIDE_HEIGHT_PX = 540


FALLBACK_SIZE_PT = 18.0


PLACEHOLDER_SIZE_PT = {
    PP_PLACEHOLDER.TITLE: 40.0,
    PP_PLACEHOLDER.CENTER_TITLE: 40.0,
    PP_PLACEHOLDER.VERTICAL_TITLE: 40.0,
    PP_PLACEHOLDER.SUBTITLE: 22.0,
    PP_PLACEHOLDER.SLIDE_NUMBER: 12.0,
    PP_PLACEHOLDER.FOOTER: 12.0,
    PP_PLACEHOLDER.HEADER: 12.0,
    PP_PLACEHOLDER.DATE: 12.0,
}


BULLETED_PLACEHOLDERS = {
    PP_PLACEHOLDER.BODY, PP_PLACEHOLDER.OBJECT, PP_PLACEHOLDER.VERTICAL_BODY,
    PP_PLACEHOLDER.VERTICAL_OBJECT,
}


ALIGN_NAMES = {
    PP_ALIGN.LEFT: 'left', PP_ALIGN.CENTER: 'center', PP_ALIGN.RIGHT: 'right',
    PP_ALIGN.JUSTIFY: 'justify', PP_ALIGN.JUSTIFY_LOW: 'justify',
    PP_ALIGN.DISTRIBUTE: 'justify', PP_ALIGN.THAI_DISTRIBUTE: 'justify',
}


ANCHOR_NAMES = {
    MSO_ANCHOR.TOP: 'top', MSO_ANCHOR.MIDDLE: 'middle', MSO_ANCHOR.BOTTOM: 'bottom',
}


THEME_TOKENS = {
    'DARK_1': 'dk1', 'LIGHT_1': 'lt1', 'DARK_2': 'dk2', 'LIGHT_2': 'lt2',
    'TEXT_1': 'tx1', 'BACKGROUND_1': 'bg1', 'TEXT_2': 'tx2', 'BACKGROUND_2': 'bg2',
    'ACCENT_1': 'accent1', 'ACCENT_2': 'accent2', 'ACCENT_3': 'accent3',
    'ACCENT_4': 'accent4', 'ACCENT_5': 'accent5', 'ACCENT_6': 'accent6',
    'HYPERLINK': 'hlink', 'FOLLOWED_HYPERLINK': 'folHlink',
}


MAPPED_TOKENS = {'tx1': 'dk1', 'bg1': 'lt1', 'tx2': 'dk2', 'bg2': 'lt2'}


LIGHT_TEXT = '#f5f5f5'


DARK_TEXT = '#1f2937'


class UnsupportedDeck(Exception):
    """The file cannot be rendered; the message is shown to the learner."""


ROUNDED_PRESETS = {'roundRect', 'round1Rect', 'round2SameRect', 'round2DiagRect', 'snip1Rect'}


DEFAULT_ROUND_ADJ = 0.16667


UNSUPPORTED_LABELS = {
    MSO_SHAPE_TYPE.CHART: 'Chart',
    MSO_SHAPE_TYPE.DIAGRAM: 'Diagram',
    MSO_SHAPE_TYPE.EMBEDDED_OLE_OBJECT: 'Embedded object',
    MSO_SHAPE_TYPE.LINKED_OLE_OBJECT: 'Linked object',
    MSO_SHAPE_TYPE.MEDIA: 'Media clip',
}


DSP_NS = 'http://schemas.microsoft.com/office/drawing/2008/diagram'


DSP = '{%s}' % DSP_NS


P_NS = qn('p:sp').split('}')[0][1:]


DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'


DIAGRAM_DRAWING_RT_SUFFIX = '/diagramDrawing'
