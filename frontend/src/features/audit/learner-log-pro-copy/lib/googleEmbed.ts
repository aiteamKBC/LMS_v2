// Google Drive / Docs URLs need their embeddable form inside an <iframe>:
// folder links and file "/view" pages send X-Frame-Options and render a
// blank/refused frame, while "/preview" (files) and "embeddedfolderview"
// (folders) are built for embedding. Non-Google URLs pass through unchanged —
// keep the ORIGINAL url for "Open in new tab" links.
export function toGoogleEmbedUrl(url: string): string {
  const folder = url.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/);
  if (folder) return `https://drive.google.com/embeddedfolderview?id=${folder[1]}#list`;
  const file = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (file) return `https://drive.google.com/file/d/${file[1]}/preview`;
  const open = url.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/);
  if (open) return `https://drive.google.com/file/d/${open[1]}/preview`;
  const docs = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
  if (docs) return `https://docs.google.com/${docs[1]}/d/${docs[2]}/preview`;
  return url;
}
