/** Downloads a 2D array of values as a CSV file. */
export function downloadCsv(
  filename: string,
  rows: (string | number)[][]
): void {
  const escapeCell = (value: string | number): string => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const content = rows
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");

  const blob = new Blob([`\ufeff${content}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

