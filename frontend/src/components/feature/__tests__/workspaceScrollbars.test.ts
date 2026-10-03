/**
 * Regression guard for LMS issue #14 ("scroll bar should be implemented in
 * LMS, it's important for the learners"). The workspace shell used to hide
 * every scrollbar in all workspaces, so learners had no cue that a page or
 * panel held more content. jsdom does not paint scrollbars, so these checks
 * read the shipped stylesheets and shell markup directly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('workspace scrollbars stay visible', () => {
  it('does not hide scrollbars across the whole workspace shell', () => {
    const shellCss = stripComments(read('../WorkspaceDesign.module.css'));

    expect(shellCss).not.toMatch(/\.shell\s*\*[^{]*\{[^}]*scrollbar-width:\s*none/);
    expect(shellCss).not.toMatch(/\.shell(?:\s*\*)?::-webkit-scrollbar\s*[,{][^}]*display:\s*none/);
    expect(shellCss).not.toMatch(/scrollbar-width:\s*none\s*!important/);
  });

  it('defines a visible themed scrollbar for WebKit and Firefox', () => {
    const css = stripComments(read('../../../index.css'));
    const webkit = css.match(/(?:^|\n)::-webkit-scrollbar\s*\{([^}]*)\}/);

    expect(webkit?.[1]).toMatch(/width:\s*[1-9]\d*px/);
    expect(webkit?.[1]).toMatch(/height:\s*[1-9]\d*px/);
    expect(css).toMatch(/(?:^|\n)::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--app-scrollbar-thumb\)/);
    expect(css).toMatch(/(?:^|\n)::-webkit-scrollbar-thumb:hover\s*\{[^}]*var\(--app-scrollbar-thumb-hover\)/);
    expect(css).toMatch(/@supports not selector\(::-webkit-scrollbar\)\s*\{\s*\*\s*\{[^}]*scrollbar-width:\s*thin[^}]*scrollbar-color:\s*var\(--app-scrollbar-thumb\) var\(--app-scrollbar-track\)/);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{[^}]*--app-scrollbar-thumb:/);
  });

  it('keeps the workspace sidebar navigation scrollbars visible', () => {
    const sidebar = read('../Sidebar.tsx');

    expect(sidebar).not.toContain('[scrollbar-width:none]');
  });
});
