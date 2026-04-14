/**
 * SVG sanitization for buyer uploads.
 * Canonical: docs/core/svg-upload-safety.md
 *
 * MUST remove scripts, event handlers, and unsafe elements/attributes.
 * Uses DOMPurify + JSDOM server-side.
 */

import { JSDOM } from "jsdom";
import DOMPurifyFactory from "dompurify";

const window = new JSDOM("").window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DOMPurify = DOMPurifyFactory(window as any);

/**
 * Sanitize SVG string. Removes scripts, event handlers, and unsafe elements/attributes.
 * Rejects if SVG contains external references (remote URLs) after parsing.
 */
export function sanitizeSvg(svgString: string): string {
  const clean = DOMPurify.sanitize(svgString, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_ATTR: ["viewBox", "xmlns"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "use"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "href"], // href in SVG can load external; restrict if needed
  });

  if (typeof clean !== "string") {
    throw new Error("SVG sanitization produced non-string");
  }

  if (clean.length === 0) {
    throw new Error("SVG sanitization removed all content");
  }

  if (hasExternalReferences(clean)) {
    throw new Error("SVG contains external references (remote URLs) which are not allowed");
  }

  return clean;
}

function hasExternalReferences(svg: string): boolean {
  const dangerousUriPattern = /\b(?:xlink:)?href\s*=\s*["']?\s*(?:https?:\/\/|ftp:\/\/|\/\/|data:)/i;
  if (dangerousUriPattern.test(svg)) return true;

  const urlPattern = /url\s*\(\s*["']?\s*(?:https?:\/\/|ftp:\/\/|\/\/|data:)/i;
  if (urlPattern.test(svg)) return true;

  return false;
}
