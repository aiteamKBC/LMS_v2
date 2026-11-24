"""OOXML coordinate transforms, paths and rounded geometry."""
from __future__ import annotations

from pptx.oxml.ns import qn
import math
from .presentation_values import (
    DEFAULT_ROUND_ADJ,
    EMU_PER_PX,
    ROUNDED_PRESETS,
)


class Frame:
    """Maps a shape's EMU coordinates onto the slide, scaled for group nesting."""

    def __init__(self, offset_x=0.0, offset_y=0.0, scale_x=1.0, scale_y=1.0):
        self.offset_x, self.offset_y = offset_x, offset_y
        self.scale_x, self.scale_y = scale_x, scale_y

    def px(self, left, top, width, height):
        return {
            'x': round((self.offset_x + (left or 0) * self.scale_x) / EMU_PER_PX, 2),
            'y': round((self.offset_y + (top or 0) * self.scale_y) / EMU_PER_PX, 2),
            'w': round((width or 0) * self.scale_x / EMU_PER_PX, 2),
            'h': round((height or 0) * self.scale_y / EMU_PER_PX, 2),
        }

    @property
    def text_scale(self):
        """Groups scale their text along with their geometry."""
        return (abs(self.scale_x) + abs(self.scale_y)) / 2 or 1.0

    def nested(self, group):
        """The frame a group's children are laid out in.

        A group defines its own coordinate space (chOff/chExt); children are
        placed in that space and stretched into the group's on-slide box.
        """
        fallback = Frame(
            self.offset_x + (group.left or 0) * self.scale_x,
            self.offset_y + (group.top or 0) * self.scale_y,
            self.scale_x, self.scale_y,
        )
        try:
            transform = group.element.find(qn('p:grpSpPr')).find(qn('a:xfrm'))
            child_x = int(transform.find(qn('a:chOff')).get('x'))
            child_y = int(transform.find(qn('a:chOff')).get('y'))
            child_cx = int(transform.find(qn('a:chExt')).get('cx')) or 1
            child_cy = int(transform.find(qn('a:chExt')).get('cy')) or 1
        except Exception:
            return fallback
        scale_x = self.scale_x * ((group.width or child_cx) / child_cx)
        scale_y = self.scale_y * ((group.height or child_cy) / child_cy)
        return Frame(
            self.offset_x + (group.left or 0) * self.scale_x - child_x * scale_x,
            self.offset_y + (group.top or 0) * self.scale_y - child_y * scale_y,
            scale_x, scale_y,
        )


def _svg_number(value):
    """A path coordinate SVG will accept.

    Path coordinates are raw EMU-scale integers, and "%g" would render those in
    scientific notation ("1.28e+07"), which SVG path data rejects outright.
    """
    rounded = round(float(value), 2)
    return '%d' % rounded if rounded == int(rounded) else '%.2f' % rounded


def _points_d(command, *points):
    return command + ' ' + ' '.join(
        _svg_number(coordinate) for point in points for coordinate in point
    )


def _point(element):
    """An a:pt as (x, y), or None when it is formula-driven rather than literal."""
    try:
        return float(element.get('x')), float(element.get('y'))
    except (TypeError, ValueError):
        return None


def _arc_segment(current, element):
    """An a:arcTo as an SVG elliptical-arc command, from the current point.

    OOXML gives the radii and a start/swing angle rather than an end point, so
    the end point has to be derived: the arc's centre sits one radius-vector
    back from where the pen already is.
    """
    try:
        radius_x, radius_y = float(element.get('wR')), float(element.get('hR'))
        start = math.radians(float(element.get('stAng')) / 60000)
        swing = math.radians(float(element.get('swAng')) / 60000)
    except (TypeError, ValueError):
        return None, current
    center = (current[0] - radius_x * math.cos(start), current[1] - radius_y * math.sin(start))
    end = (
        center[0] + radius_x * math.cos(start + swing),
        center[1] + radius_y * math.sin(start + swing),
    )
    command = 'A %s %s 0 %d %d %s %s' % (
        _svg_number(radius_x), _svg_number(radius_y),
        1 if abs(swing) > math.pi else 0, 1 if swing > 0 else 0,
        _svg_number(end[0]), _svg_number(end[1]),
    )
    return command, end


def _custom_path(shape):
    """A shape's a:custGeom as an SVG path, or None if it has none (or is odd).

    Freeform shapes carry the deck's design furniture — angled panels, cut
    corners, blobs — and drawing them as rectangles is what makes a rendered
    deck look nothing like the original.
    """
    try:
        geometry = shape._element.spPr.find(qn('a:custGeom'))
    except Exception:
        return None
    if geometry is None:
        return None
    path_list = geometry.find(qn('a:pathLst'))
    if path_list is None:
        return None
    commands = []
    view_w = view_h = 0
    for sub_path in path_list.findall(qn('a:path')):
        try:
            view_w = max(view_w, int(sub_path.get('w') or 0))
            view_h = max(view_h, int(sub_path.get('h') or 0))
        except (TypeError, ValueError):
            pass
        current = (0.0, 0.0)
        for step in sub_path:
            tag = step.tag.split('}')[-1]
            points = [_point(pt) for pt in step.findall(qn('a:pt'))]
            if any(point is None for point in points):
                return None  # formula-driven geometry: fall back to the box
            if tag == 'moveTo' and len(points) == 1:
                commands.append(_points_d('M', points[0]))
                current = points[0]
            elif tag == 'lnTo' and len(points) == 1:
                commands.append(_points_d('L', points[0]))
                current = points[0]
            elif tag == 'cubicBezTo' and len(points) == 3:
                commands.append(_points_d('C', *points))
                current = points[2]
            elif tag == 'quadBezTo' and len(points) == 2:
                commands.append(_points_d('Q', *points))
                current = points[1]
            elif tag == 'arcTo':
                command, current = _arc_segment(current, step)
                if command is None:
                    return None
                commands.append(command)
            elif tag == 'close':
                commands.append('Z')
    if not commands or not view_w or not view_h:
        return None
    return {'d': ' '.join(commands), 'vbW': view_w, 'vbH': view_h}


def _preset_radius(shape, box):
    """CSS corner radius for a rounded preset shape, or None."""
    try:
        preset = shape._element.spPr.find(qn('a:prstGeom'))
    except Exception:
        return None
    if preset is None:
        return None
    name = str(preset.get('prst') or '')
    if name == 'ellipse':
        return '50%'
    if name not in ROUNDED_PRESETS:
        return None
    adjust = DEFAULT_ROUND_ADJ
    guide = preset.find('.//' + qn('a:gd'))
    if guide is not None and str(guide.get('fmla') or '').startswith('val '):
        try:
            adjust = int(str(guide.get('fmla'))[4:]) / 100000
        except (TypeError, ValueError):
            adjust = DEFAULT_ROUND_ADJ
    return '%gpx' % round(min(box['w'], box['h']) * min(max(adjust, 0), 0.5), 2)
