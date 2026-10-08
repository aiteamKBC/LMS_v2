"""Presence of handwritten signatures in the original Aptem Progress Review PDF.

Aptem's PR export has three signature boxes in coach, employer, participant
order. Only raster marks inside those boxes count; the header logo does not.
An unfamiliar layout is unknown rather than an unsigned review.
"""

import pymupdf


def progress_review_pdf_signatures(content):
    unknown = {'coach': None, 'manager': None, 'student': None}
    try:
        with pymupdf.open(stream=content, filetype='pdf') as document:
            boxes = []
            for page in document:
                words = page.get_text('words')
                image_rects = [rect for image in page.get_images(full=True)
                               for rect in page.get_image_rects(image[0])]
                for word in words:
                    if word[4].strip(':').lower() != 'signature':
                        continue
                    label = pymupdf.Rect(word[:4])
                    field = pymupdf.Rect(label.x1 + 15, label.y0 - 30,
                                          min(page.rect.width - 60, label.x1 + 510),
                                          label.y1 + 30)
                    boxes.append(any(rect.intersects(field) and
                                     30 < rect.get_area() < page.rect.get_area() * 0.15
                                     for rect in image_rects))
            if len(boxes) != 3:
                return unknown
            return dict(zip(('coach', 'manager', 'student'), boxes))
    except (ValueError, RuntimeError, TypeError, pymupdf.FileDataError):
        return unknown
