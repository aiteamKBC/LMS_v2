"""OOXML theme, colour, typography and contrast projection."""
from __future__ import annotations

from lxml import etree
from pptx.enum.dml import MSO_COLOR_TYPE
from pptx.enum.dml import MSO_FILL
from pptx.enum.dml import MSO_THEME_COLOR
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import qn
from pptx.text.text import _Run
from pptx.util import Length
from .presentation_values import (
    ALIGN_NAMES,
    ANCHOR_NAMES,
    DARK_TEXT,
    LIGHT_TEXT,
    MAPPED_TOKENS,
    PT_TO_PX,
    THEME_TOKENS,
)


def _clamp_byte(value):
    return max(0, min(255, int(round(value))))


def _apply_brightness(hex_color, brightness):
    """PowerPoint's lighten (>0, toward white) / darken (<0, toward black)."""
    if not brightness:
        return hex_color
    channels = [int(hex_color[index:index + 2], 16) for index in (1, 3, 5)]
    if brightness > 0:
        channels = [channel + (255 - channel) * brightness for channel in channels]
    else:
        channels = [channel * (1 + brightness) for channel in channels]
    return '#%02x%02x%02x' % tuple(_clamp_byte(channel) for channel in channels)


def _theme_colors(master):
    """The colour context for a master: theme slot hexes plus its colour map.

    A slide never names a theme slot directly — it names a token (tx1, bg1,
    accent1 …) that the master's p:clrMap points at a slot. A dark template
    inverts tx1/bg1, so ignoring the map renders its light body text as the
    near-black dk1 and its slides come out unreadable.
    """
    slots = {}
    try:
        root = etree.fromstring(master.part.part_related_by(RT.THEME).blob)
        scheme = root.find('.//' + qn('a:clrScheme'))
    except Exception:  # pragma: no cover - a deck without a readable theme
        scheme = None
    if scheme is not None:
        for slot in scheme:
            literal = _xml_color_hex(slot, {})
            if literal:
                slots[slot.tag.split('}')[-1]] = literal
    color_map = dict(MAPPED_TOKENS)
    mapping = master._element.find(qn('p:clrMap'))
    if mapping is not None:
        for token in MAPPED_TOKENS:
            if mapping.get(token):
                color_map[token] = str(mapping.get(token))
    return {'slots': slots, 'map': color_map}


def _scheme_hex(theme, token):
    """Hex for an a:schemeClr token, resolved through the master's colour map."""
    slots = (theme or {}).get('slots', {})
    color_map = (theme or {}).get('map', MAPPED_TOKENS)
    return slots.get(color_map.get(token, token))


def _xml_color_hex(element, theme):
    """First literal (or theme) colour found under an OOXML colour element."""
    if element is None:
        return None
    srgb = element.find('.//' + qn('a:srgbClr'))
    if srgb is not None and srgb.get('val'):
        return '#' + str(srgb.get('val')).lower()
    system = element.find('.//' + qn('a:sysClr'))
    if system is not None and system.get('lastClr'):
        return '#' + str(system.get('lastClr')).lower()
    scheme = element.find('.//' + qn('a:schemeClr'))
    if scheme is not None and scheme.get('val'):
        return _scheme_hex(theme, str(scheme.get('val')))
    return None


def _alpha_of(element):
    """Opacity 0-1 declared on an OOXML colour, or None when it is opaque."""
    if element is None:
        return None
    alpha = element.find('.//' + qn('a:alpha'))
    if alpha is None or not alpha.get('val'):
        return None
    try:
        value = int(alpha.get('val')) / 100000
    except (TypeError, ValueError):
        return None
    return value if 0 <= value < 1 else None


def _with_alpha(hex_color, alpha):
    """A CSS colour: plain hex when opaque, rgba() when not."""
    if alpha is None:
        return hex_color
    channels = tuple(int(hex_color[index:index + 2], 16) for index in (1, 3, 5))
    return 'rgba(%d, %d, %d, %s)' % (channels + (round(alpha, 3),))


def opaque_hex(css_color):
    """The '#rrggbb' behind a CSS colour, or None if it is translucent.

    Contrast decisions need something solid to measure; a translucent fill lets
    the slide behind it show through, so the caller falls back to that instead.
    """
    return css_color if css_color and len(css_color) == 7 and css_color[0] == '#' else None


def _color_hex(color, theme):
    """A CSS colour for a python-pptx ColorFormat, or None when it is unset."""
    if color is None:
        return None
    try:
        color_type = color.type
    except Exception:
        return None
    if color_type is None:
        return None
    resolved = None
    if color_type == MSO_COLOR_TYPE.RGB:
        try:
            resolved = '#' + str(color.rgb).lower()
        except Exception:
            resolved = None
    elif color_type == MSO_COLOR_TYPE.SCHEME:
        try:
            theme_color = color.theme_color
        except Exception:
            theme_color = None
        if isinstance(theme_color, MSO_THEME_COLOR):
            resolved = _scheme_hex(theme, THEME_TOKENS.get(theme_color.name, ''))
    if resolved is None:
        # Anything else (system, preset, HSL) still carries a literal value in
        # the XML often enough to be worth a look.
        resolved = _xml_color_hex(getattr(color, '_xFill', None), theme)
    if resolved is None:
        return None
    try:
        resolved = _apply_brightness(resolved, float(color.brightness or 0))
    except Exception:
        pass
    return _with_alpha(resolved, _alpha_of(getattr(color, '_xFill', None)))


def _fill_hex(fill, theme):
    """Solid colour for a shape/cell fill. Gradients collapse to their first stop."""
    if fill is None:
        return None
    try:
        fill_type = fill.type
    except Exception:
        return None
    if fill_type in (MSO_FILL.SOLID, MSO_FILL.PATTERNED):
        try:
            return _color_hex(fill.fore_color, theme)
        except Exception:
            return None
    if fill_type == MSO_FILL.GRADIENT:
        try:
            return _color_hex(fill.gradient_stops[0].color, theme)
        except Exception:
            return None
    return None


def _bullet_for(paragraph, default_bulleted):
    """The bullet glyph for a paragraph, or None when it has no bullet.

    Only the paragraph's own properties are read: resolving inherited bullets
    would mean walking the master's list styles, so a deck that leaves bullets
    entirely to its master renders as clean text rather than wrong text.
    """
    properties = paragraph._pPr
    if properties is not None:
        if properties.find(qn('a:buNone')) is not None:
            return None
        char = properties.find(qn('a:buChar'))
        if char is not None:
            return str(char.get('char') or '•')
        if properties.find(qn('a:buAutoNum')) is not None:
            return '•'
    return '•' if default_bulleted else None


def _font_scale(text_frame):
    """PowerPoint's "shrink text on overflow" factor, as stored in the file."""
    try:
        body = text_frame._txBody.find(qn('a:bodyPr'))
        autofit = body.find(qn('a:normAutofit')) if body is not None else None
        if autofit is not None and autofit.get('fontScale'):
            return int(autofit.get('fontScale')) / 100000
    except Exception:
        pass
    return 1.0


def _run_size_pt(run, paragraph, fallback_pt):
    for font in (run.font, paragraph.font):
        try:
            if font.size is not None:
                return font.size.pt
        except Exception:
            continue
    return fallback_pt


def _paragraph_pieces(paragraph):
    """Runs in document order, with soft line breaks and field text kept.

    `paragraph.runs` sees only <a:r>, so a line break inside a title (<a:br/>)
    and an auto-numbered slide number (<a:fld>) would both vanish. Walking the
    children keeps them.
    """
    for child in paragraph._p:
        tag = child.tag.split('}')[-1]
        if tag == 'r':
            yield _Run(child, paragraph)
        elif tag == 'br':
            yield '\n'
        elif tag == 'fld':
            text_element = child.find(qn('a:t'))
            if text_element is not None and text_element.text:
                yield text_element.text


def _normalise_run_text(text):
    """Soft breaks and stray carriage returns become plain newlines.

    The viewer renders run text with `white-space: pre-wrap`, so a newline
    here is the line break the author typed.
    """
    return str(text).replace('\x0b', '\n').replace('\r\n', '\n').replace('\r', '\n')


def _paragraph_model(paragraph, theme, fallback_pt, default_bulleted, scale):
    runs = []
    for piece in _paragraph_pieces(paragraph):
        if isinstance(piece, str):
            # A break or field belongs to the run it follows, so it inherits its
            # styling instead of introducing a differently-sized fragment.
            if runs:
                runs[-1]['text'] += _normalise_run_text(piece)
            continue
        if not piece.text:
            continue
        runs.append({
            'text': _normalise_run_text(piece.text),
            'sizePx': round(_run_size_pt(piece, paragraph, fallback_pt) * PT_TO_PX * scale, 2),
            'bold': bool(piece.font.bold),
            'italic': bool(piece.font.italic),
            'underline': bool(piece.font.underline),
            'color': _color_hex(piece.font.color, theme),
            'font': piece.font.name or None,
        })
    if not runs:
        return None
    line_spacing, line_height_px = None, None
    try:
        spacing = paragraph.line_spacing
        if isinstance(spacing, Length):
            line_height_px = round(spacing.pt * PT_TO_PX * scale, 2)
        elif isinstance(spacing, (int, float)):
            line_spacing = round(float(spacing), 3)
    except Exception:
        line_spacing, line_height_px = None, None
    return {
        'align': ALIGN_NAMES.get(paragraph.alignment),
        'level': int(paragraph.level or 0),
        'bullet': _bullet_for(paragraph, default_bulleted),
        'lineSpacing': line_spacing,
        'lineHeightPx': line_height_px,
        'runs': runs,
    }


def _text_model(text_frame, theme, fallback_pt, default_bulleted, scale):
    font_scale = _font_scale(text_frame) * scale
    paragraphs = [
        model for model in (
            _paragraph_model(paragraph, theme, fallback_pt, default_bulleted, font_scale)
            for paragraph in text_frame.paragraphs
        ) if model
    ]
    try:
        anchor = ANCHOR_NAMES.get(text_frame.vertical_anchor, 'top')
    except Exception:
        anchor = 'top'
    return {'valign': anchor, 'paragraphs': paragraphs}


def _relative_luminance(hex_color):
    """0 (black) to 1 (white), the sRGB luminance used for contrast decisions."""
    channels = []
    for index in (1, 3, 5):
        channel = int(hex_color[index:index + 2], 16) / 255
        channels.append(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def _contrast_text(background_hex):
    """Readable text colour for whatever the text is drawn on."""
    if not background_hex or len(background_hex) != 7:
        return DARK_TEXT
    try:
        return DARK_TEXT if _relative_luminance(background_hex) > 0.4 else LIGHT_TEXT
    except ValueError:
        return DARK_TEXT


def _is_readable_on(text_hex, surface_hex):
    """Rough "can this be read" test, used only to reject invisible text."""
    if not text_hex or not surface_hex or len(text_hex) != 7 or len(surface_hex) != 7:
        return True
    try:
        return abs(_relative_luminance(text_hex) - _relative_luminance(surface_hex)) > 0.12
    except ValueError:
        return True


def _style_font_color(shape, theme):
    """The colour a styled shape gives its text (p:style/a:fontRef).

    This is PowerPoint's own answer for a shape drawn from a theme style — a
    dark chip whose caption is white, say — and it beats any guess of ours.
    """
    try:
        style = shape._element.find(qn('p:style'))
        font_ref = style.find(qn('a:fontRef')) if style is not None else None
    except Exception:
        return None
    return _xml_color_hex(font_ref, theme) if font_ref is not None else None


def _default_text_color(shape, fill, theme, background_hex):
    """Colour for runs that name none of their own.

    PowerPoint resolves this through the master's list styles, which this
    renderer does not walk. The next-best sources are the shape's own style and
    the theme's body-text slot; either is used only if the result can actually
    be read against what it sits on, so no deck renders as invisible text.
    """
    surface = opaque_hex(fill) or background_hex
    for candidate in (_style_font_color(shape, theme), _scheme_hex(theme, 'tx1')):
        if candidate and _is_readable_on(candidate, surface):
            return candidate
    return _contrast_text(surface)


def _placeholder_type(shape):
    try:
        return shape.placeholder_format.type if shape.is_placeholder else None
    except Exception:
        return None


def _rotation(shape):
    try:
        rotation = float(shape.rotation or 0)
    except Exception:
        return None
    return round(rotation, 2) if rotation else None
