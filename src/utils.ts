// ---------------------------------------------------------------------------
// Internal utilities — not exported from the public API
// ---------------------------------------------------------------------------

/** Parse abbreviated numbers: "26.4M" → 26400000, "1.2K" → 1200, "456" → 456. */
export function parseAbbreviatedNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  const match = cleaned.match(/^([\d.]+)\s*([KMBkmb])?/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  const suffix = (match[2] || "").toUpperCase();
  const multipliers: Record<string, number> = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
  };
  return Math.round(num * (multipliers[suffix] || 1));
}

/** Count words in a string. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Decode common HTML entities found in YouTube responses. */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

// ---------------------------------------------------------------------------
// YouTube response parsing helpers
// ---------------------------------------------------------------------------

/** Parse view count text by stripping "views" suffix and parsing abbreviated number. */
export function parseViewCountText(text: string): number | null {
  if (!text) return null;
  return parseAbbreviatedNumber(text.replace(/\s*views?\s*$/i, "").trim());
}

/** Extract text from the first element of a YouTube `runs` array. */
export function extractFirstRunText(obj: unknown): string {
  return (
    (
      (obj as Record<string, unknown>)?.runs as Array<{ text: string }> | undefined
    )?.[0]?.text ?? ""
  );
}

/** Extract text from a YouTube `runs` array (joins all run texts). */
export function extractRunsText(obj: unknown): string {
  const runs = (obj as Record<string, unknown>)?.runs as
    | Array<{ text: string }>
    | undefined;
  return runs?.map((r) => r.text).join("") ?? "";
}

/** Extract flat list of items from InnerTube search response sections. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractSearchItems(data: any): any[] {
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sections.flatMap((s: any) => s?.itemSectionRenderer?.contents ?? []);
}

/** Extract mutations array from InnerTube frameworkUpdates response. */
export function extractMutations(
  data: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return (
    (
      (
        (data.frameworkUpdates as Record<string, unknown>)?.entityBatchUpdate as Record<
          string,
          unknown
        >
      )?.mutations as Array<Record<string, unknown>>
    ) ?? []
  );
}

