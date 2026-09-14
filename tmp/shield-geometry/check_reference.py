"""Render the repository's SVG geometry for comparison; this is not a browser test."""
import base64
import json
import math
import re
from pathlib import Path

import pymupdf
from PIL import Image

root = Path(__file__).resolve().parents[2]
out = Path(__file__).parent
page = (root / 'frontend/src/pages/learner/home/page.tsx').read_text(encoding='utf-8')
artwork = (root / 'frontend/src/pages/learner/home/ShieldArtwork.tsx').read_text(encoding='utf-8')
css = (root / 'frontend/src/pages/learner/home/studentHome.module.css').read_text(encoding='utf-8')
outline = re.search(r'id="learning-shield-outline" d="([^"]+)"', page)[1]
upper = re.search(r"const upperPanel = '([^']+)'", artwork)[1]
lower = re.search(r"const lowerPanel = '([^']+)'", artwork)[1]
stroke = float(re.search(r'strokeWidth="([\d.]+)" strokeLinejoin', page)[1])

def pct(name):
    return float(re.search(rf'--{name}: ([\d.]+)%', css)[1]) / 100

circle_d = pct('circle-size') * 1000
circle_y = pct('circle-y') * 1270
panel_w = pct('panel-width') * 1000
panel_x = pct('panel-margin') * 1000
upper_y = float(re.search(r'\.quadrant0 \{ top: ([\d.]+)%', css)[1]) / 100 * 1270
upper_h = float(re.search(r'\.shieldAction \{[^}]*height: ([\d.]+)%', css)[1]) / 100 * 1270
lower_rule = re.search(r'\.quadrant2 \{ top: ([\d.]+)%; height: ([\d.]+)%', css)
lower_y, lower_h = [float(n) / 100 * 1270 for n in lower_rule.groups()]

def geometry(overlay=False):
    parts = [f'<path d="{outline}" fill="{"none" if overlay else "#34203f"}" stroke="{"#00d5e8" if overlay else "#dab863"}" stroke-width="{2 if overlay else stroke}" stroke-linejoin="round"/>']
    if not overlay:
        parts.append(f'<path d="{outline}" transform="translate(500 635) scale(.95) translate(-500 -635)" fill="none" stroke="#91774b" stroke-opacity=".28" stroke-width="2"/>')
    for i in range(4):
        right = i % 2
        x = 1000 - panel_x - panel_w if right else panel_x
        y, h, d = (upper_y, upper_h, upper) if i < 2 else (lower_y, lower_h, lower)
        mirror = 'translate(1000 0) scale(-1 1)' if right else ''
        parts.append(f'<g transform="translate({x} {y}) scale({panel_w / 1000} {h / 1000})"><path transform="{mirror}" d="{d}" fill="{"none" if overlay else "#f9f6f3"}" stroke="{"#00d5e8" if overlay else "#d8cdd9"}" stroke-width="{3 if overlay else 6}"/></g>')
    parts.append(f'<circle cx="500" cy="{circle_y}" r="{circle_d / 2}" fill="{"none" if overlay else "#dfbc65"}" stroke="{"#00d5e8" if overlay else "#302039"}" stroke-width="{2 if overlay else 7.46}"/>')
    return ''.join(parts)

def render(svg, dest):
    document = pymupdf.open(stream=svg.encode(), filetype='svg')
    pdf = pymupdf.open(stream=document.convert_to_pdf(), filetype='pdf')
    pix = pdf[0].get_pixmap(alpha=True)
    pix.save(out / dest)

for name, width in [('desktop', 670), ('tablet', 468), ('mobile', 354), ('small-mobile', 284)]:
    render(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{width * 1.27}" viewBox="0 0 1000 1270">{geometry()}</svg>', f'reference-{name}.png')

ref = base64.b64encode((root / 'frontend/public/assets/student-home/approved-reference.png').read_bytes()).decode()
overlay = f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="740" height="925" viewBox="590 85 740 925"><image x="0" y="0" width="1920" height="1080" xlink:href="data:image/png;base64,{ref}"/><g transform="translate(625 110) scale(.67)">{geometry(True)}</g></svg>'
render(overlay, 'reference-overlay.png')

render(f'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1270" viewBox="0 0 1000 1270"><path d="{outline}" fill="black"/></svg>', 'reference-centre-contour.png')
contour = Image.open(out / 'reference-centre-contour.png').getchannel('A')
errors = []
for y, a, b in json.loads((out / 'reference-band.json').read_text()):
    if y % 5 or y > 950:
        continue
    row = round((y - 110) / .67)
    start = next(x for x in range(1000) if contour.getpixel((x, row)) > 127)
    errors.append(625 + start * .67 - (a + b) / 2)
max_symmetry = 0
for row in range(1, 1262):
    xs = [x for x in range(1000) if contour.getpixel((x, row)) > 127]
    if xs:
        max_symmetry = max(max_symmetry, abs((xs[0] + xs[-1] + 1) / 2 - 500))
results = {
    'canvas': [1000, 1270], 'circle_diameter': circle_d, 'circle_centre': [500, circle_y],
    'stroke_width': stroke, 'panel_boxes': {'upper': [panel_x, upper_y, panel_w, upper_h], 'lower': [panel_x, lower_y, panel_w, lower_h]},
    'reference_contour_mean_abs_error_px': sum(map(abs, errors)) / len(errors),
    'reference_contour_95th_error_px': sorted(map(abs, errors))[int(.95 * len(errors))],
    'max_symmetry_error_at_1000px': max_symmetry,
}
assert max_symmetry <= .5, results
assert results['reference_contour_95th_error_px'] < 4, results
assert circle_d == 380 and math.isclose(circle_y / 1270, .477), results
(out / 'reference-measurements.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
