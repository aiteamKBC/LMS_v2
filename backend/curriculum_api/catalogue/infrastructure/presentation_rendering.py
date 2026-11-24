"""PowerPoint and PDF sources rendered into the existing slide/page model."""
from __future__ import annotations

from pathlib import Path
from pptx import Presentation
from .presentation_geometry import (
    Frame,
)
from .presentation_shapes import (
    _background,
    _image_source,
    _inherited_shapes,
    _shape_models,
)
from .presentation_style import (
    _theme_colors,
)
from .presentation_values import (
    DEFAULT_SLIDE_HEIGHT_PX,
    DEFAULT_SLIDE_WIDTH_PX,
    EMU_PER_PX,
    PDF_MAX_PAGES,
    PDF_RENDER_ZOOM,
    UnsupportedDeck,
)


def _deck_model(source, asset_dir, url_prefix):
    presentation = Presentation(str(source))
    assets = {}
    slides = []
    for number, slide in enumerate(presentation.slides, start=1):
        layout = slide.slide_layout
        master = layout.slide_master
        context = {
            'theme': _theme_colors(master),
            'assets': assets,
            'asset_dir': asset_dir,
            'url_prefix': url_prefix,
            'background_hex': '#ffffff',
            # SmartArt's laid-out drawing is a related part of the slide.
            'slide_part': slide.part,
        }
        theme = context['theme']
        background = (
            _background(slide._element, slide.part, theme, context)
            or _background(layout._element, layout.part, theme, context)
            or _background(master._element, master.part, theme, context)
        )
        context['background_hex'] = (background or {}).get('color') or '#ffffff'
        shapes = _inherited_shapes(slide, context)
        for shape in slide.shapes:
            shapes.extend(_shape_models(shape, Frame(), context))
        try:
            notes = (slide.notes_slide.notes_text_frame.text or '').strip() if slide.has_notes_slide else ''
        except Exception:
            notes = ''
        slides.append({
            'number': number,
            'layout': layout.name or '',
            'background': background,
            'shapes': shapes,
            'notes': notes,
        })
    return {
        'slideWidthPx': round((presentation.slide_width or 0) / EMU_PER_PX) or DEFAULT_SLIDE_WIDTH_PX,
        'slideHeightPx': round((presentation.slide_height or 0) / EMU_PER_PX) or DEFAULT_SLIDE_HEIGHT_PX,
        'slideCount': len(slides),
        'slides': slides,
    }


class _RenderedPage:
    """The shape _image_source expects, wrapping one rendered page."""

    ext = 'png'

    def __init__(self, blob):
        self.blob = blob


def _pdf_model(source, asset_dir, url_prefix):
    """A PDF as the same model a deck produces: one full-page image per page.

    Reusing the deck viewer means paging, scaling and the page strip all work
    without the viewer knowing which kind of document it has.
    """
    import fitz  # PyMuPDF, already in requirements.txt

    # Opened from memory rather than by path: PyMuPDF can keep a handle on a
    # file it failed to parse, and on Windows that blocks deleting the temporary
    # copy this render is usually working from.
    document = fitz.open(stream=Path(source).read_bytes(), filetype='pdf')
    # Read anything needed for the result before the document is closed below —
    # PyMuPDF raises "document closed" on attribute access afterwards.
    total_pages = document.page_count
    try:
        if document.needs_pass:
            raise UnsupportedDeck(
                'This PDF is password-protected, so it cannot be shown here. '
                'Open or download it instead.'
            )
        if not total_pages:
            raise UnsupportedDeck('This PDF has no pages to show.')

        context = {'assets': {}, 'asset_dir': asset_dir, 'url_prefix': url_prefix}
        matrix = fitz.Matrix(PDF_RENDER_ZOOM, PDF_RENDER_ZOOM)
        pages = []
        width_px = height_px = 0
        for number, page in enumerate(document, start=1):
            if number > PDF_MAX_PAGES:
                break
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            # The stage takes the first page's size; a document with mixed page
            # sizes still renders, each image scaled into that stage.
            width_px = width_px or pixmap.width
            height_px = height_px or pixmap.height
            source_url = _image_source(_RenderedPage(pixmap.tobytes('png')), context)
            pages.append({
                'number': number,
                'layout': 'Page',
                'background': {'color': '#ffffff'},
                'shapes': [{
                    'kind': 'image', 'x': 0, 'y': 0,
                    'w': pixmap.width, 'h': pixmap.height,
                    'src': source_url, 'alt': 'Page %d' % number, 'rotation': None,
                }],
                'notes': '',
            })
    finally:
        document.close()

    return {
        'slideWidthPx': width_px or DEFAULT_SLIDE_WIDTH_PX,
        'slideHeightPx': height_px or DEFAULT_SLIDE_HEIGHT_PX,
        'slideCount': len(pages),
        'slides': pages,
        # Lets the viewer say "Page 3 of 12" for a document and "Slide 3 of 12"
        # for a deck, from the same component.
        'unit': 'page',
        'truncated': total_pages > PDF_MAX_PAGES,
        'totalPages': total_pages,
    }
