"""OOXML shape, image, table, SmartArt and inherited-artwork projection."""
from __future__ import annotations

from lxml import etree
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml import parse_xml
from pptx.oxml.ns import qn
from pptx.shapes.autoshape import Shape as _AutoShape
import copy
import hashlib
from .presentation_geometry import (
    Frame,
    _custom_path,
    _preset_radius,
)
from .presentation_style import (
    _color_hex,
    _default_text_color,
    _fill_hex,
    _placeholder_type,
    _rotation,
    _text_model,
    _xml_color_hex,
)
from .presentation_values import (
    BULLETED_PLACEHOLDERS,
    DIAGRAM_DRAWING_RT_SUFFIX,
    DIAGRAM_URI,
    DSP,
    FALLBACK_SIZE_PT,
    PLACEHOLDER_SIZE_PT,
    PT_TO_PX,
    P_NS,
    UNSUPPORTED_LABELS,
)


def _blip_fill_source(shape, context):
    """The image a shape is *filled* with, or None.

    A picture on a slide is not always a <p:pic>. PowerPoint also fills an
    ordinary shape with one — <a:blipFill> inside the shape's <p:spPr> — which
    is what "Picture fill" and most pasted diagrams and logos produce. Those
    shapes have no solid fill, no line and no text, so without this they resolve
    to nothing at all and are dropped, taking the artwork with them.
    """
    blip_fill = shape._element.find('.//' + qn('p:spPr') + '/' + qn('a:blipFill'))
    if blip_fill is None:
        return None
    blip = blip_fill.find(qn('a:blip'))
    if blip is None:
        return None
    rel_id = blip.get(qn('r:embed'))
    if not rel_id:
        return None
    try:
        part = context['slide_part'].rels[rel_id].target_part
    except Exception:
        return None
    return _image_source(part, context)


def _image_source(image, context):
    """Write an embedded image out once and return the URL it is served from."""
    try:
        blob = image.blob
    except Exception:
        return None
    digest = hashlib.sha1(blob).hexdigest()[:16]
    assets = context['assets']
    if digest in assets:
        return assets[digest]
    extension = (getattr(image, 'ext', None) or 'png').lower().lstrip('.')
    name = 'img-%s.%s' % (digest, extension)
    target = context['asset_dir'] / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(blob)
    assets[digest] = '%s/%s' % (context['url_prefix'], name)
    return assets[digest]


def _table_model(shape, box, theme, scale):
    table = shape.table
    total_width = sum(column.width or 0 for column in table.columns) or 1
    total_height = sum(row.height or 0 for row in table.rows) or 1
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            if getattr(cell, 'is_spanned', False):
                continue
            cells.append({
                'colSpan': int(getattr(cell, 'span_width', 1) or 1),
                'rowSpan': int(getattr(cell, 'span_height', 1) or 1),
                'fill': _fill_hex(cell.fill, theme),
                **_text_model(cell.text_frame, theme, 12.0, False, scale),
            })
        rows.append(cells)
    return {
        'kind': 'table',
        **box,
        'colFractions': [round((column.width or 0) / total_width, 4) for column in table.columns],
        'rowFractions': [round((row.height or 0) / total_height, 4) for row in table.rows],
        'rows': rows,
    }


def _is_smartart(shape):
    """Is this graphicFrame a SmartArt graphic?

    Checked by graphicData URI rather than shape_type: python-pptx reports
    `shape_type` as None for a SmartArt frame (it has no MSO type for the
    diagram graphicData), so MSO_SHAPE_TYPE.DIAGRAM never matches and the frame
    would otherwise fall through every branch below and be dropped silently.
    """
    graphic_data = shape._element.find('.//' + qn('a:graphicData'))
    return graphic_data is not None and graphic_data.get('uri') == DIAGRAM_URI


def _smartart_drawing_root(shape, context):
    """The <dsp:drawing> holding this SmartArt's laid-out shapes, or None.

    The frame's <dgm:relIds> names the data/layout/style parts but NOT the
    drawing, so the drawing is found by walking the slide's own relationships
    for the diagramDrawing type. Where a slide holds several SmartArt graphics
    the data part's number pairs them up (data3.xml <-> drawing3.xml), which is
    how the right drawing is picked for the right frame.
    """
    try:
        rels = context['slide_part'].rels
        drawings = [
            rel.target_part for rel in rels.values()
            if rel.reltype.endswith(DIAGRAM_DRAWING_RT_SUFFIX)
        ]
        if not drawings:
            return None
        chosen = drawings[0]
        if len(drawings) > 1:
            # Pair by the trailing number on the data part this frame points at.
            rel_ids = shape._element.find('.//{%s}relIds' % DIAGRAM_URI)
            data_rid = rel_ids.get(qn('r:dm')) if rel_ids is not None else None
            data_name = rels[data_rid].target_part.partname if data_rid else ''
            suffix = ''.join(ch for ch in str(data_name).rsplit('/', 1)[-1] if ch.isdigit())
            for part in drawings:
                name = str(part.partname).rsplit('/', 1)[-1]
                if ''.join(ch for ch in name if ch.isdigit()) == suffix:
                    chosen = part
                    break
        return etree.fromstring(chosen.blob)
    except Exception:
        return None


def _as_pptx_shape(element):
    """A dsp: SmartArt element re-tagged as its p: equivalent, python-pptx-parsed.

    Re-tagging alone is not enough: lxml has already bound the tree to plain
    elements, so it is serialised and re-parsed through python-pptx's own parser
    to pick up the oxml classes that Shape/Picture depend on.
    """
    converted = copy.deepcopy(element)
    for node in converted.iter():
        if isinstance(node.tag, str) and node.tag.startswith(DSP):
            node.tag = '{%s}%s' % (P_NS, node.tag[len(DSP):])
    # python-pptx requires a non-visual properties id/name; SmartArt omits both.
    props = converted.find('.//' + qn('p:cNvPr'))
    if props is not None:
        props.set('id', props.get('id') or '1')
        props.set('name', props.get('name') or 'SmartArt shape')
    return parse_xml(etree.tostring(converted))


def _smartart_models(shape, frame, context):
    """A SmartArt graphic as the shapes PowerPoint already laid out for it.

    Rendering SmartArt from its data + layout definition is a project in itself,
    but PowerPoint caches the finished geometry in the drawing part, so the
    diagram can be drawn from that with the ordinary shape path — which is why
    this returns real boxes and text rather than a "Diagram" placeholder.
    """
    root = _smartart_drawing_root(shape, context)
    if root is None:
        return None
    # The drawing's coordinates are relative to the frame's own origin.
    nested = frame.nested(shape) if hasattr(frame, 'nested') else frame
    models = []
    for element in root.findall('.//' + DSP + 'sp'):
        try:
            converted = _as_pptx_shape(element)
            models.extend(_shape_models(_AutoShape(converted, None), nested, context))
        except Exception:
            continue
    return models or None


def _shape_models(shape, frame, context):
    """One shape — recursively, for groups — as zero or more model entries."""
    theme = context['theme']
    box = frame.px(shape.left, shape.top, shape.width, shape.height)
    shape_type = getattr(shape, 'shape_type', None)

    if shape_type == MSO_SHAPE_TYPE.GROUP:
        nested = frame.nested(shape)
        models = []
        for child in shape.shapes:
            models.extend(_shape_models(child, nested, context))
        return models

    if shape_type in (MSO_SHAPE_TYPE.PICTURE, MSO_SHAPE_TYPE.LINKED_PICTURE):
        source = _image_source(shape.image, context)
        if not source:
            return []
        return [{
            'kind': 'image', **box, 'src': source,
            'alt': shape.name or 'Slide image', 'rotation': _rotation(shape),
        }]

    if getattr(shape, 'has_table', False):
        return [_table_model(shape, box, theme, frame.text_scale)]

    if _is_smartart(shape):
        drawn = _smartart_models(shape, frame, context)
        # Only when the cached layout is missing does the learner get a label
        # instead of the diagram itself.
        return drawn if drawn is not None else [
            {'kind': 'note', **box, 'label': UNSUPPORTED_LABELS[MSO_SHAPE_TYPE.DIAGRAM]}
        ]

    if shape_type in UNSUPPORTED_LABELS:
        return [{'kind': 'note', **box, 'label': UNSUPPORTED_LABELS[shape_type]}]

    # Anything else the parser cannot model — an embedded object, a chart in a
    # frame python-pptx types as None — is still *something* the author put on
    # the slide. Marking its place says "there is content here the viewer
    # cannot draw"; dropping it silently leaves a blank gap that reads as a
    # broken deck, which is what SmartArt used to do.
    if shape._element.tag == qn('p:graphicFrame'):
        return [{'kind': 'note', **box, 'label': 'Embedded content'}]

    fill = _fill_hex(getattr(shape, 'fill', None), theme)
    line, line_width_pt = None, None
    try:
        line = _color_hex(shape.line.color, theme)
        line_width_pt = shape.line.width.pt if shape.line.width else None
    except Exception:
        line, line_width_pt = None, None
    has_text = bool(getattr(shape, 'has_text_frame', False))

    # A shape filled with a picture rather than a colour: drawn as the image it
    # is filled with. Checked before the drop below, because such a shape has no
    # solid fill and no line, so it would otherwise be discarded — silently
    # losing pasted diagrams, logos and screenshots, which is most of the
    # artwork in a real deck.
    #
    # `has_text` is not part of this test: a freeform carries an empty text
    # frame, so requiring "no text" here skipped exactly the shapes that hold
    # the artwork. Any real text is emitted as its own model below.
    picture_fill = _blip_fill_source(shape, context)
    picture_model = [{
        'kind': 'image', **box, 'src': picture_fill,
        'alt': shape.name or 'Slide image', 'rotation': _rotation(shape),
    }] if picture_fill else []

    if not has_text and not fill and not line:
        return picture_model

    outline = _custom_path(shape)
    model = {
        'kind': 'text' if has_text else 'shape',
        **box,
        'path': outline,
        'radius': None if outline else _preset_radius(shape, box),
        'fill': fill,
        'line': line,
        'lineWidthPx': round(line_width_pt * PT_TO_PX, 2) if line_width_pt else None,
        'rotation': _rotation(shape),
        'valign': 'top',
        # Runs that name no colour of their own inherit this.
        'defaultTextColor': _default_text_color(shape, fill, theme, context['background_hex']),
        'paragraphs': [],
    }
    if has_text:
        placeholder = _placeholder_type(shape)
        model.update(_text_model(
            shape.text_frame, theme,
            PLACEHOLDER_SIZE_PT.get(placeholder, FALLBACK_SIZE_PT),
            placeholder in BULLETED_PLACEHOLDERS,
            frame.text_scale,
        ))
        if not model['paragraphs'] and not fill and not line:
            # Empty text frame — but if the shape is picture-filled, the picture
            # is the content and must still be drawn.
            return picture_model
    # Picture first so it sits behind the shape's own text, as PowerPoint draws
    # a fill behind the words on top of it.
    return picture_model + [model]


def _background(element, part, theme, context):
    """{'color': …} or {'image': …} for a slide/layout/master's own background."""
    common = element.find(qn('p:cSld'))
    background = common.find(qn('p:bg')) if common is not None else None
    if background is None:
        return None
    blip = background.find('.//' + qn('a:blip'))
    if blip is not None and blip.get(qn('r:embed')):
        try:
            image_part = part.related_part(blip.get(qn('r:embed')))
            source = _image_source(image_part, context)
            if source:
                return {'image': source}
        except Exception:
            pass
    color = _xml_color_hex(background, theme)
    return {'color': color} if color else None


def _follows_master_graphics(element):
    return element.get('showMasterSp') not in ('0', 'false')


def _inherited_shapes(slide, context):
    """The template's own graphics: master then layout, placeholders excluded.

    A designed deck keeps its furniture (background bars, logos, rules) on the
    master and its layouts, so skipping these renders every slide as bare text
    on white. Placeholders are skipped — on a master or layout they are empty
    prompts that the slide itself fills in.
    """
    layout = slide.slide_layout
    master = layout.slide_master
    models = []
    if not _follows_master_graphics(slide._element):
        return models
    if _follows_master_graphics(layout._element):
        for shape in master.shapes:
            if not shape.is_placeholder:
                models.extend(_shape_models(shape, Frame(), context))
    for shape in layout.shapes:
        if not shape.is_placeholder:
            models.extend(_shape_models(shape, Frame(), context))
    return models
