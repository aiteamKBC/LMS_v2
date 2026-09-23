import { formatSystemTimestamp } from '@/lib/format';
import { jsPDF } from 'jspdf';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** Canvas text preserves browser font fallback and Arabic shaping in the PDF. */
export async function createAssignmentPdf(html: string) {
  const logo = await loadImage('/kbc-logo.png');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const canvas = document.createElement('canvas');
  canvas.width = 1240; canvas.height = 1754;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not prepare the PDF.');
  let y = 200;
  let pages = 0;
  const begin = () => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1240, 1754);
    const width = Math.min(210, 95 * logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, 85, 50, width, width * logo.naturalHeight / logo.naturalWidth);
    ctx.font = 'bold 22px Arial'; ctx.fillStyle = '#17324d';
    ctx.textAlign = 'right'; ctx.fillText('ASSIGNMENT & FEEDBACK', 1155, 100);
    ctx.textAlign = 'left'; ctx.fillStyle = '#dce5ef'; ctx.fillRect(85, 160, 1070, 2); ctx.fillStyle = '#c99744'; ctx.fillRect(85, 160, 210, 3);
    y = 210;
  };
  const flush = () => {
    ctx.font = '18px Arial'; ctx.fillStyle = '#60758a'; ctx.textAlign = 'left';
    ctx.fillText('Kent Business College | Assignment evidence report', 85, 1700);
    ctx.textAlign = 'right'; ctx.fillText(`Page ${pages + 1}`, 1155, 1700); ctx.textAlign = 'left';
    if (pages++) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  };
  begin();
  const text = (value: string, heading = false) => {
    if (heading && y > 1490) { flush(); begin(); }
    const size = heading ? 27 : 23;
    const font = `${heading ? 'bold ' : ''}${size}px Arial`;
    const draw = (line: string) => {
      if (y > 1600) { flush(); begin(); }
      ctx.font = font; ctx.fillStyle = heading ? '#163e68' : '#243746';
      const rtl = /^[\s\d\p{P}]*[\u0590-\u08ff]/u.test(line);
      ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
      ctx.fillText(line, rtl ? 1155 : 85, y); y += size * 1.5;
      ctx.direction = 'ltr'; ctx.textAlign = 'left';
    };
    ctx.font = font;
    for (const paragraph of value.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        ctx.font = font;
        if (ctx.measureText(candidate).width <= 1070) { line = candidate; continue; }
        if (line) draw(line);
        line = '';
        for (const char of word) {
          ctx.font = font;
          if (ctx.measureText(line + char).width > 1070) { draw(line); line = ''; }
          line += char;
        }
      }
      draw(line);
    }
    y += heading ? 8 : 18;
  };
  const table = (element: Element) => {
    const rows = [...element.querySelectorAll('tr')];
    const columns = rows[0]?.children.length || 1;
    const widths = columns === 3 ? [650, 160, 260] : [650, 420];
    const wrap = (value: string, width: number) => {
      const lines: string[] = []; let line = '';
      for (const char of value) {
        if (char === '\n' || ctx.measureText(line + char).width > width - 24) { lines.push(line); line = ''; }
        if (char !== '\n') line += char;
      }
      lines.push(line); return lines;
    };
    const drawRow = (cells: string[][], start: number, count: number, header: boolean) => {
      const height = count * 30 + 20;
      let x = 85;
      cells.forEach((lines, index) => {
        const width = widths[index];
        ctx.fillStyle = header ? '#17324d' : '#f8fafc'; ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = '#d4dfeb'; ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = header ? '#ffffff' : '#243746'; ctx.font = `${header ? 'bold ' : ''}21px Arial`;
        lines.slice(start, start + count).forEach((line, i) => ctx.fillText(line, x + 12, y + 30 + i * 30));
        x += width;
      });
      y += height;
    };
    const headers = [...rows[0].children].map(cell => [cell.textContent || '']);
    rows.forEach((row, rowIndex) => {
      ctx.font = '21px Arial';
      const cells = [...row.children].map((cell, index) => wrap(cell.textContent || '', widths[index]));
      const length = Math.max(...cells.map(lines => lines.length));
      let start = 0;
      while (start < length) {
        if (y > 1510) { flush(); begin(); if (rowIndex > 0) drawRow(headers, 0, 1, true); }
        const count = Math.min(length - start, Math.max(1, Math.floor((1590 - y - 20) / 30)));
        drawRow(cells, start, count, rowIndex === 0); start += count;
      }
    });
    y += 28;
  };
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  // Fixed KBC template, populated exclusively from this submission's fields.
  const nodes = [...parsed.body.children];
  const fields = new Map<string, string>();
  nodes.filter(node => node.tagName === 'H3').forEach(node => fields.set(node.textContent || '', node.nextElementSibling?.textContent || ''));
  const value = (label: string) => {
    const raw = fields.get(label) || 'Not recorded';
    return label === 'Reviewed at' && raw !== 'Not recorded'
      ? (formatSystemTimestamp(raw, { dateStyle: 'medium', timeStyle: 'short' }) || raw) + ' (UK time)' : raw;
  };
  const rejected = ['rejected', 'changes requested', 'returned', 'referred'].includes(value('Result').toLowerCase());
  const wrapCard = (value: string, width: number, size = 23) => {
    ctx.font = `${size}px Arial`;
    const lines: string[] = [];
    for (const paragraph of value.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (line && ctx.measureText(`${line} ${word}`).width > width) { lines.push(line); line = ''; }
        for (const char of (line ? ` ${word}` : word)) {
          if (ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const cardRow = (cards: Array<{ label: string; value: string; positive?: boolean; negative?: boolean }>) => {
    const width = (1070 - (cards.length - 1) * 22) / cards.length;
    const prepared = cards.map(card => ({ ...card, lines: wrapCard(card.value, width - 48) }));
    let offset = 0;
    const length = Math.max(...prepared.map(card => card.lines.length));
    while (offset < length) {
      if (y > 1460) { flush(); begin(); }
      const count = Math.min(length - offset, Math.floor((1580 - y - 85) / 32));
      const height = 75 + count * 32;
      prepared.forEach((card, index) => {
        const x = 85 + index * (width + 22);
        ctx.fillStyle = card.positive ? '#edf8f1' : card.negative ? '#fff1f2' : '#f8fafc'; ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = '#dce5ef'; ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = card.positive ? '#278454' : card.negative ? '#b42338' : '#45627e'; ctx.fillRect(x, y, 5, height);
        ctx.font = 'bold 22px Arial'; ctx.fillText(card.label + (offset ? ' (continued)' : ''), x + 24, y + 34);
        ctx.font = '23px Arial'; ctx.fillStyle = '#303443';
        card.lines.slice(offset, offset + count).forEach((line, i) => {
          const rtl = /^[\s\d\p{P}]*[\u0590-\u08ff]/u.test(line);
          ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
          ctx.fillText(line, rtl ? x + width - 24 : x + 24, y + 75 + i * 32);
        });
        ctx.direction = 'ltr'; ctx.textAlign = 'left';
      });
      offset += count; y += height + 22;
    }
  };
  const band = (number: string, title: string, newPage = false) => {
    if ((newPage && y > 210) || y > 1430) { flush(); begin(); }
    ctx.fillStyle = '#edf3f9'; ctx.fillRect(85, y, 1070, 62);
    ctx.fillStyle = '#147d78'; ctx.fillRect(85, y, 62, 62);
    ctx.font = 'bold 25px Arial'; ctx.fillStyle = '#ffffff'; ctx.fillText(number, 107, y + 40);
    ctx.fillStyle = '#17324d'; ctx.fillText(title, 164, y + 40); y += 84;
  };
  const groups = new Map<string, Element[]>();
  let current = '';
  for (const node of nodes) {
    if (node.tagName === 'H2') { current = (node.textContent || '').slice(3); groups.set(current, []); }
    else if (current) groups.get(current)!.push(node);
  }
  const renderFields = (group: string, excluded: string[] = []) => {
    const elements = groups.get(group) || [];
    for (let i = 0; i < elements.length; i++) {
      const node = elements[i];
      if (node.tagName === 'TABLE') table(node);
      else if (node.tagName === 'H3') {
        const label = node.textContent || '';
        const next = elements[i + 1];
        if (!excluded.includes(label)) cardRow([{ label, value: next?.textContent || 'Not recorded' }]);
        if (next?.tagName === 'P') i++;
      } else if (node.tagName === 'P') text(node.textContent || '');
    }
  };
  // Compact first-page overview, rather than the previous mostly empty cover.
  const titleLines = wrapCard(parsed.body.querySelector('h1')?.textContent || 'Assignment', 970, 40);
  const titleHeight = 115 + titleLines.length * 52;
  ctx.fillStyle = '#17324d'; ctx.fillRect(85, 205, 1070, titleHeight);
  ctx.fillStyle = '#c99744'; ctx.fillRect(85, 205, 7, titleHeight);
  ctx.font = 'bold 40px Arial'; ctx.fillStyle = '#ffffff';
  titleLines.forEach((line, index) => ctx.fillText(line, 120, 270 + index * 52));
  ctx.font = '23px Arial'; ctx.fillStyle = '#d4e3ef';
  ctx.fillText(value('Assignment month'), 120, 285 + titleLines.length * 52);
  y = 235 + titleHeight;
  cardRow([
    { label: 'LEARNER & PROGRAMME', value: `${value('Learner')}\n${value('Programme')}\n${value('Assignment month')}` },
    { label: 'ASSESSMENT RESULT', value: `${value('Result')}\nReviewed by: ${value('Reviewed by')}\n${value('Reviewed at')}`, positive: value('Result').toLowerCase() === 'accepted', negative: rejected },
  ]);
  band('1', 'Hours, KSBs & learning status');
  const ksbNodes = groups.get('KSBs & hours claimed') || [];
  const codes = ksbNodes.filter(node => node.tagName === 'H3' && /^[KSB]\d/i.test(node.textContent || '')).map(node => node.textContent || '');
  cardRow([{ label: 'Planned hours', value: value('Planned hours') }, { label: 'Total hours claimed', value: value('Total hours claimed') }, { label: 'KSBs included', value: codes.join(', ') || 'None recorded' }]);
  cardRow([{ label: 'Paid working hours', value: value('Completed during paid working hours') }, { label: 'KSBs & hours reviewed', value: value('Planned hours and KSBs reviewed') }]);
  cardRow([{ label: 'New knowledge', value: value('New knowledge') }, { label: 'New skills', value: value('New skills') }]);
  band('2', 'Evidence & cross-referencing');
  renderFields('Evidence & cross-referencing');
  text('Learning time breakdown', true);
  const timeTable = ksbNodes.find(node => node.tagName === 'TABLE');
  if (timeTable) table(timeTable); else text('No entries recorded.');
  band('3', 'Assignment answer', true);
  cardRow([{ label: 'Assignment answer', value: value('Assignment answer') }]);
  cardRow([{ label: 'What I learned', value: value('What I learned') }, { label: 'What I understood', value: value('What I understood') }]);
  cardRow([{ label: 'Skills I gained', value: value('Skills I gained') }]);
  band('4', 'KSB evidence', true);
  for (let i = 0; i < ksbNodes.length; i++) {
    const node = ksbNodes[i];
    if (node.tagName === 'H3' && codes.includes(node.textContent || '')) {
      let description = ksbNodes[i + 1]?.textContent || 'Not recorded';
      if (ksbNodes[i + 2]?.textContent === 'Supporting evidence') description += '\nSupporting evidence: ' + (ksbNodes[i + 3]?.textContent || '');
      cardRow([{ label: node.textContent || '', value: description }]);
    }
  }
  if (!codes.length) text('No KSB claims recorded.');
  band('5', 'Impact & employer benefit');
  cardRow([{ label: 'Business impact', value: value('Business impact') }, { label: 'Career impact', value: value('Career impact') }]);
  cardRow([{ label: 'Job impact', value: value('Job impact') }, { label: 'Employer impact', value: value('Employer impact') }]);
  cardRow([{ label: 'Employer benefit confirmed', value: value('Employer benefit confirmed'), positive: value('Employer benefit confirmed') === 'Yes' }]);
  band('6', 'Action plan & EPA preparedness', true);
  renderFields('Action plan & EPA');
  cardRow([{ label: 'Submission snapshot', value: `Result: ${value('Result')}\nKSBs: ${codes.join(', ') || 'None recorded'}\nPlanned hours: ${value('Planned hours')}\nTotal hours claimed: ${value('Total hours claimed')}\nPaid working hours: ${value('Completed during paid working hours')}\nEvidence-sharing consent: ${value('Evidence-sharing consent')}` }]);
  band('7', 'Coach assessment & feedback');
  cardRow([{ label: 'Result', value: value('Result'), positive: value('Result').toLowerCase() === 'accepted', negative: rejected }, { label: 'Reviewed by', value: value('Reviewed by') }]);
  cardRow([{ label: 'Reviewed at', value: value('Reviewed at') }]);
  cardRow([{ label: 'Coach feedback', value: value('Coach feedback') }]);

  const imagePage = (image: globalThis.CanvasImageSource, width: number, height: number) => {
    if (y > 210) flush();
    begin();
    const scale = Math.min(1070 / width, 1390 / height);
    ctx.drawImage(image, 85 + (1070 - width * scale) / 2, 200, width * scale, height * scale);
    flush(); begin();
  };
  return {
    async attachment(name: string, bytes: ArrayBuffer, contentType: string) {
      text(`Submitted file: ${name}`, true);
      if (/\.pdf$/i.test(name) || contentType.includes('application/pdf')) {
        const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
        GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const task = getDocument({ data: new Uint8Array(bytes) });
        const source = await task.promise;
        try {
          for (let i = 1; i <= source.numPages; i++) {
            const page = await source.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });
            const sheet = document.createElement('canvas');
            sheet.width = Math.ceil(viewport.width); sheet.height = Math.ceil(viewport.height);
            await page.render({ canvas: sheet, canvasContext: sheet.getContext('2d')!, viewport }).promise;
            imagePage(sheet, sheet.width, sheet.height);
            page.cleanup();
          }
        } finally { await task.destroy(); }
      } else if (/\.(png|jpe?g|webp)$/i.test(name) || /^image\/(png|jpeg|webp)/.test(contentType)) {
        const url = URL.createObjectURL(new Blob([bytes]));
        try { const image = await loadImage(url); imagePage(image, image.naturalWidth, image.naturalHeight); }
        finally { URL.revokeObjectURL(url); }
      } else if (/\.docx$/i.test(name)) {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ arrayBuffer: bytes });
        text('Text extracted from the submitted Word document. Original layout and images are available in the original file.');
        text(result.value || 'No readable text was found in this document.');
      } else if (/\.(txt|csv|md)$/i.test(name) || contentType.startsWith('text/')) {
        text(new TextDecoder().decode(bytes));
      } else {
        text('This file format cannot be reproduced in this PDF. Open the original file from your assignment submission.');
      }
    },
    finish() {
      if (y > 210 || pages === 0) flush();
      return pdf.output('blob');
    },
  };
}
