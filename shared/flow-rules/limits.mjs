// Single source of truth for WhatsApp Cloud API limits and builder limits.
// Imported by the server (require(esm)) and by the web editor (Vite), so counters in the UI
// and publish-time validation always agree. Re-check against Meta docs when bumping GRAPH_API_VERSION.

export const LIMITS = {
  textBody: 4096,
  imageCaption: 1024,

  buttonHeader: 60,
  buttonBody: 1024,
  buttonFooter: 60,
  buttonTitle: 20,
  maxButtons: 3,

  listHeader: 60,
  listBody: 4096,
  listFooter: 60,
  listButton: 20,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  maxRows: 10,
  maxSections: 10,

  locationBody: 1024,
  ctaBody: 1024,
  ctaButton: 20,
  minLinkMinutes: 1,
  maxLinkMinutes: 1440,

  keyword: 30,
  maxKeywords: 20,
  label: 40,
  varName: 40,
  maxAttempts: 10,
  maxRules: 10,

  // Call-and-return nesting (A calls B calls C = depth 2).
  maxCallDepth: 3,
  historySteps: 50,
};

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

// Meta counts user-perceived characters, so emoji and Tamil conjuncts count once.
export function textLength(value) {
  const text = String(value ?? "");
  if (!segmenter) return [...text].length;
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

export function truncateText(value, max) {
  const text = String(value ?? "");
  if (textLength(text) <= max) return text;
  const parts = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text];
  return `${parts.slice(0, max - 1).join("")}…`;
}
