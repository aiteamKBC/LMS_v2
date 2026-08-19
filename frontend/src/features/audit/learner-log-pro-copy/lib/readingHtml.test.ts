import { describe, expect, it } from "vitest";

import { sanitizeReadingHtml } from "./readingHtml";

describe("sanitizeReadingHtml", () => {
  it("keeps rich reading structure while removing source-owned styles", () => {
    const clean = sanitizeReadingHtml(
      '<table style="width:100%"><tr><td><strong>Time bound</strong></td></tr></table>',
    );

    expect(clean).toContain("<table>");
    expect(clean).toContain("<strong>Time bound</strong>");
    expect(clean).not.toContain("style=");
  });

  it("removes executable markup and unsafe URLs", () => {
    const clean = sanitizeReadingHtml(
      '<img src="x" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">Open</a>',
    );

    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("Open");
  });
});
