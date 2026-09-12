import JSZip from 'jszip';
import type {
  ProgressReviewSlide,
  ProgressReviewSlideListItem,
  ProgressReviewSlidesDeck,
} from '../components/ProgressReviewSlidesModal';

const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
const M = 420000;

type Shape = {
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  fill?: string;
  stroke?: string;
  radius?: boolean;
  align?: 'l' | 'ctr';
};

function esc(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeText(value: unknown, fallback = '--') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function inches(value: number) {
  return Math.round(value * 914400);
}

function shapeXml(shape: Shape, index: number) {
  const fill = shape.fill
    ? `<a:solidFill><a:srgbClr val="${shape.fill}"/></a:solidFill>`
    : '<a:noFill/>';
  const stroke = shape.stroke
    ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${shape.stroke}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  const text = safeText(shape.text, '');
  const body = text
    ? `<p:txBody><a:bodyPr wrap="square" anchor="t"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${text
        .split('\n')
        .map(line => (
          `<a:p><a:pPr algn="${shape.align || 'l'}"/><a:r><a:rPr lang="en-GB" sz="${(shape.fontSize || 14) * 100}" ${shape.bold ? 'b="1"' : ''}><a:solidFill><a:srgbClr val="${shape.color || '111827'}"/></a:solidFill></a:rPr><a:t>${esc(line)}</a:t></a:r><a:endParaRPr lang="en-GB"/></a:p>`
        ))
        .join('')}</p:txBody>`
    : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>';

  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${index + 10}" name="Shape ${index}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${shape.x}" y="${shape.y}"/><a:ext cx="${shape.w}" cy="${shape.h}"/></a:xfrm>
      <a:prstGeom prst="${shape.radius ? 'roundRect' : 'rect'}"><a:avLst/></a:prstGeom>
      ${fill}${stroke}
    </p:spPr>
    ${body}
  </p:sp>`;
}

function titleShapes(deck: ProgressReviewSlidesDeck, slide: ProgressReviewSlide): Shape[] {
  const programme = slide.type === 'cover'
    ? safeText(slide.details.find(detail => detail.label.toLowerCase() === 'programme')?.value, 'Marketing Executive Level 4 Apprenticeship')
    : 'Marketing Executive Level 4 Apprenticeship';
  const employer = slide.type === 'cover'
    ? safeText(slide.details.find(detail => detail.label.toLowerCase() === 'employer')?.value, 'KBC LearningOS')
    : 'KBC LearningOS';
  return [
    { x: 0, y: 0, w: SLIDE_W, h: inches(0.55), fill: '24103F' },
    { x: M, y: inches(0.18), w: inches(7.5), h: inches(0.2), text: programme.toUpperCase(), fontSize: 7, bold: true, color: 'EDE9FE' },
    { x: inches(9.7), y: inches(0.18), w: inches(2.8), h: inches(0.2), text: 'PROGRESS REVIEW', fontSize: 7, bold: true, color: 'EDE9FE', align: 'ctr' },
    { x: M, y: inches(0.82), w: inches(8.9), h: inches(0.32), text: slide.title.toUpperCase(), fontSize: 8, bold: true, color: '6D28D9' },
    { x: M, y: inches(1.15), w: inches(8.9), h: inches(0.38), text: 'heading' in slide ? slide.heading : slide.title, fontSize: 17, bold: true, color: '111827' },
    { x: M, y: inches(1.55), w: inches(8.9), h: inches(0.38), text: 'subheading' in slide ? slide.subheading : '', fontSize: 9, color: '4B5563' },
    { x: 0, y: inches(7.08), w: SLIDE_W, h: inches(0.42), fill: 'F8FAFC', stroke: 'E5E7EB' },
    { x: M, y: inches(7.22), w: inches(7.8), h: inches(0.16), text: employer.toUpperCase(), fontSize: 6, bold: true, color: '64748B' },
    { x: inches(10.2), y: inches(0.82), w: inches(2.55), h: inches(0.3), text: deck.learnerName, fontSize: 8, bold: true, color: '4C1D95', align: 'ctr', fill: 'F5F3FF', stroke: 'DDD6FE', radius: true },
  ];
}

function chip(text: string, x: number, y: number, tone: string = 'F5F3FF'): Shape {
  return { x, y, w: inches(1.45), h: inches(0.32), text, fontSize: 9, bold: true, color: '4C1D95', fill: tone, stroke: 'E5E7EB', radius: true, align: 'ctr' };
}

function card(title: string, detail: string, x: number, y: number, w: number, h: number): Shape[] {
  return [
    { x, y, w, h, fill: 'FFFFFF', stroke: 'E5E7EB', radius: true },
    { x: x + inches(0.16), y: y + inches(0.14), w: w - inches(0.32), h: inches(0.28), text: title, fontSize: 10, bold: true, color: '111827' },
    { x: x + inches(0.16), y: y + inches(0.48), w: w - inches(0.32), h: h - inches(0.58), text: detail, fontSize: 8, color: '4B5563' },
  ];
}

function metricCard(label: string, value: string, x: number, y: number, w: number, h: number): Shape[] {
  return [
    { x, y, w, h, fill: 'F9FAFB', stroke: 'E5E7EB', radius: true },
    { x: x + inches(0.15), y: y + inches(0.12), w: w - inches(0.3), h: inches(0.22), text: label.toUpperCase(), fontSize: 7, bold: true, color: '6B7280' },
    { x: x + inches(0.15), y: y + inches(0.42), w: w - inches(0.3), h: inches(0.42), text: value, fontSize: 18, bold: true, color: '111827' },
  ];
}

function listItemText(item: ProgressReviewSlideListItem) {
  return [safeText(item.title, ''), item.badge ? `[${item.badge}]` : '', item.detail || '', item.meta || '']
    .filter(Boolean)
    .join('\n');
}

function slideShapes(deck: ProgressReviewSlidesDeck, slide: ProgressReviewSlide): Shape[] {
  const shapes: Shape[] = [{ x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: 'FFFFFF' }, ...titleShapes(deck, slide)];

  if (slide.type === 'cover') {
    shapes.push(
      { x: M, y: inches(1.35), w: inches(8.9), h: inches(0.65), text: slide.heading, fontSize: 28, bold: true, color: '111827' },
      { x: M, y: inches(2.1), w: inches(8.4), h: inches(0.58), text: slide.subheading, fontSize: 12, color: '4B5563' },
    );
    slide.details.slice(0, 9).forEach((detail, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      shapes.push(...metricCard(detail.label, detail.value, inches(0.48 + col * 4.1), inches(3.15 + row * 1.08), inches(3.75), inches(0.84)));
    });
    return shapes;
  }

  if (slide.type === 'metrics') {
    slide.metrics.slice(0, 8).forEach((metric, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      shapes.push(...metricCard(metric.label, metric.value, inches(0.48 + col * 3.16), inches(2.15 + row * 1.06), inches(2.85), inches(0.86)));
    });
    slide.highlights?.slice(0, 4).forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      shapes.push(...card(item.title, [item.detail, item.meta].filter(Boolean).join('\n'), inches(0.48 + col * 6.35), inches(4.5 + row * 0.9), inches(5.95), inches(0.74)));
    });
    return shapes;
  }

  if (slide.type === 'table') {
    const y = inches(2.15);
    const colW = inches(12.35 / Math.max(1, slide.headers.length));
    slide.headers.forEach((header, index) => {
      shapes.push({ x: inches(0.48) + index * colW, y, w: colW, h: inches(0.34), text: header, fontSize: 8, bold: true, color: 'FFFFFF', fill: '4C1D95', stroke: 'E5E7EB', align: 'ctr' });
    });
    slide.rows.slice(0, 10).forEach((row, rowIndex) => {
      row.slice(0, slide.headers.length).forEach((cell, colIndex) => {
        shapes.push({ x: inches(0.48) + colIndex * colW, y: y + inches(0.34 + rowIndex * 0.36), w: colW, h: inches(0.36), text: cell, fontSize: 6, color: '374151', fill: rowIndex % 2 ? 'FFFFFF' : 'F9FAFB', stroke: 'E5E7EB' });
      });
    });
    if (slide.note) shapes.push({ x: inches(0.48), y: inches(6.05), w: inches(12.35), h: inches(0.42), text: slide.note, fontSize: 8, color: '4B5563', fill: 'F5F3FF', stroke: 'DDD6FE', radius: true });
    return shapes;
  }

  if (slide.type === 'lists') {
    slide.columns.slice(0, 2).forEach((column, colIndex) => {
      const x = inches(0.48 + colIndex * 6.35);
      shapes.push({ x, y: inches(2.12), w: inches(5.95), h: inches(0.34), text: column.title.toUpperCase(), fontSize: 8, bold: true, color: '6D28D9' });
      column.items.slice(0, 5).forEach((item, itemIndex) => {
        shapes.push(...card(item.title, listItemText(item).replace(item.title, '').trim(), x, inches(2.55 + itemIndex * 0.78), inches(5.95), inches(0.64)));
      });
      if (!column.items.length) {
        shapes.push(...card('No data available', 'This section can be completed by the coach during the review.', x, inches(2.55), inches(5.95), inches(0.75)));
      }
    });
  }

  return shapes;
}

function slideXml(shapes: Shape[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${shapes.map(shapeXml).join('')}
  </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function contentTypes(slideCount: number) {
  const slides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  ${slides}
</Types>`;
}

function presentationXml(slideCount: number) {
  const ids = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${ids}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRels(slideCount: number) {
  const slides = Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slides}
</Relationships>`;
}

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="KBC LearningOS">
  <a:themeElements><a:clrScheme name="KBC"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="4C1D95"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="6D28D9"/></a:accent1><a:accent2><a:srgbClr val="10B981"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="EF4444"/></a:accent4><a:accent5><a:srgbClr val="3B82F6"/></a:accent5><a:accent6><a:srgbClr val="14B8A6"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Arial"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="KBC"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements>
</a:theme>`;

const slideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;

const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;

const slideLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const emptyRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

export async function saveProgressReviewPptx(deck: ProgressReviewSlidesDeck) {
  const zip = new JSZip();
  const slides = deck.slides;

  zip.file('[Content_Types].xml', contentTypes(slides.length));
  zip.folder('_rels')?.file('.rels', rootRels);
  zip.folder('docProps')?.file('core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.learnerName)} Progress Review</dc:title><dc:creator>KBC LearningOS</dc:creator><cp:lastModifiedBy>KBC LearningOS</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`);
  zip.folder('docProps')?.file('app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>KBC LearningOS</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slides.length}</Slides></Properties>`);
  zip.folder('ppt')?.file('presentation.xml', presentationXml(slides.length));
  zip.folder('ppt')?.folder('_rels')?.file('presentation.xml.rels', presentationRels(slides.length));
  zip.folder('ppt')?.folder('theme')?.file('theme1.xml', theme);
  zip.folder('ppt')?.folder('slideMasters')?.file('slideMaster1.xml', slideMaster);
  zip.folder('ppt')?.folder('slideMasters')?.folder('_rels')?.file('slideMaster1.xml.rels', slideMasterRels);
  zip.folder('ppt')?.folder('slideLayouts')?.file('slideLayout1.xml', slideLayout);
  zip.folder('ppt')?.folder('slideLayouts')?.folder('_rels')?.file('slideLayout1.xml.rels', emptyRels);

  slides.forEach((slide, index) => {
    zip.folder('ppt')?.folder('slides')?.file(`slide${index + 1}.xml`, slideXml(slideShapes(deck, slide)));
    zip.folder('ppt')?.folder('slides')?.folder('_rels')?.file(`slide${index + 1}.xml.rels`, emptyRels);
  });

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const learnerSlug = deck.learnerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  a.href = url;
  a.download = `progress-review-${learnerSlug || 'learner'}.pptx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
