import { ANDROID_CLIENT_CONTEXT, InnertubeApi } from "./innertube.js";
import { Transport } from "./transport.js";
import { InnertubeError } from "./types.js";
import type {
  CaptionTrackInfo,
  Transcript,
  TranscriptSegment,
  TimedTranscriptSegment,
  TranscriptSlices,
} from "./types.js";
import { decodeHtmlEntities, wordCount } from "./utils.js";

// ---------------------------------------------------------------------------
// Defaults (inlined from app-specific config)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_WORDS = 5_000;
const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_SLICE_WORDS = 500;

// ---------------------------------------------------------------------------
// Public transcript fetch
// ---------------------------------------------------------------------------

/** @internal */
export async function getFullTranscript(
  innertube: InnertubeApi,
  transport: Transport,
  videoId: string,
  captionTracks?: CaptionTrackInfo[],
  preferredLanguage?: string,
): Promise<Transcript> {
  let tracks = captionTracks;

  if (!tracks || tracks.length === 0) {
    const result = await getCaptionTracks(innertube, videoId);
    tracks = result.tracks;
  }

  const typedTracks = tracks as CaptionTrackInfo[];

  // If a specific language was requested, be strict — don't silently fall back
  if (preferredLanguage) {
    const track = pickTrackByLanguage(typedTracks, preferredLanguage);
    if (!track) {
      const available = typedTracks.map((t) => t.languageCode).join(", ") || "none";
      throw new InnertubeError(
        "NO_CAPTIONS",
        `No "${preferredLanguage}" captions available. Available languages: ${available}`,
      );
    }
    return buildTranscriptResult(transport, track, videoId);
  }

  const track = pickBestTrack(typedTracks);
  if (!track) {
    throw new InnertubeError("NO_CAPTIONS", "No captions available for this video");
  }

  return buildTranscriptResult(transport, track, videoId);
}

async function buildTranscriptResult(
  transport: Transport,
  track: CaptionTrackInfo,
  videoId: string,
): Promise<Transcript> {
  const segments = await fetchCaptionXml(transport, track.baseUrl);
  if (segments.length === 0) {
    throw new InnertubeError("NO_CAPTIONS", "Transcript returned empty content");
  }

  const text = segments.map((s) => s.text).join(" ");
  const timedSegments: TimedTranscriptSegment[] = segments.map((s) => ({
    text: s.text,
    startMs: Math.round(s.start * 1000),
    endMs: Math.round((s.start + s.duration) * 1000),
  }));

  const language = track.languageCode ?? "unknown";
  return { videoId, language, text, segments: timedSegments };
}

// ---------------------------------------------------------------------------
// Transcript text utilities (pure functions, no I/O)
// ---------------------------------------------------------------------------

/**
 * Sanitize raw transcript text for downstream processing.
 *
 * 11-step pipeline: character cap, HTML strip, entity decode, invisible
 * Unicode removal, NFKC normalization, SRT timestamp strip, URL strip,
 * newline collapse, whitespace collapse, final trim.
 */
export function sanitizeTranscript(raw: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  let text = raw;

  // 1. Enforce hard character cap
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }

  // 2. Strip HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // 3. Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 4. Remove zero-width and invisible Unicode characters
  text = text.replace(/[\p{Default_Ignorable_Code_Point}]/gu, "");

  // 5. Normalize Unicode (curly quotes -> straight, special spaces -> regular)
  text = text.normalize("NFKC");

  // 6. Strip subtitle/SRT timestamps and markers
  text = text.replace(/\[?\d{0,2}:?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?/g, "");
  text = text.replace(/-->/g, "");
  text = text.replace(/^\d+\s*$/gm, "");

  // 7. Strip URLs
  text = text.replace(/https?:\/\/[^\s)]+/gi, "");

  // 8. Collapse single newlines into spaces (preserve paragraph breaks)
  text = text.replace(/\n{2,}/g, "\n\n");
  text = text.replace(/(?<!\n)\n(?!\n)/g, " ");

  // 9. Collapse multiple spaces/tabs into one
  text = text.replace(/[^\S\n]+/g, " ");

  // 10. Collapse 3+ newlines into double
  text = text.replace(/\n{3,}/g, "\n\n");

  // 11. Trim
  text = text.trim();

  return text;
}

/**
 * Smart-sample a transcript to fit within a word budget.
 *
 * - At or under budget: returns as-is.
 * - Up to 1.5x budget: trims from the middle (keeps strong opening + closing).
 * - Over 1.5x budget: samples 3 evenly-spaced chunks.
 */
export function truncateTranscript(text: string, maxWords: number = DEFAULT_MAX_WORDS): string {
  const words = text.split(/\s+/).filter(Boolean);
  return sampleTranscript(words, maxWords);
}

/**
 * Extract 3 targeted transcript slices at sentence boundaries.
 *
 * Returns opening, body (from middle), and closing slices of approximately
 * `sliceWords` words each. Never cuts mid-sentence.
 */
export function sliceTranscript(
  text: string,
  sliceWords: number = DEFAULT_SLICE_WORDS,
): TranscriptSlices {
  const totalWords = wordCount(text);

  if (totalWords <= sliceWords * 3) {
    return { opening: text, body: "", closing: "" };
  }

  const sentences = splitSentences(text);

  if (sentences.length <= 3) {
    return { opening: text, body: "", closing: "" };
  }

  // Opening: accumulate sentences from start
  let openingEnd = 0;
  let openingWords = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sw = wordCount(sentences[i]);
    if (openingWords + sw > sliceWords && openingWords > 0) break;
    openingWords += sw;
    openingEnd = i + 1;
  }

  // Closing: accumulate sentences from end
  let closingStart = sentences.length;
  let closingWords = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const sw = wordCount(sentences[i]);
    if (closingWords + sw > sliceWords && closingWords > 0) break;
    closingWords += sw;
    closingStart = i;
  }

  // Body: expand outward from midpoint
  const midSentenceIdx = Math.floor(sentences.length / 2);
  let bodyStart = midSentenceIdx;
  let bodyEnd = midSentenceIdx + 1;
  let bodyWords = wordCount(sentences[midSentenceIdx]);

  while (bodyWords < sliceWords) {
    const canGoForward = bodyEnd < sentences.length;
    const canGoBack = bodyStart > 0;
    if (!canGoForward && !canGoBack) break;

    if (canGoForward) {
      const sw = wordCount(sentences[bodyEnd]);
      if (bodyWords + sw > sliceWords) break;
      bodyWords += sw;
      bodyEnd++;
    }
    if (bodyWords >= sliceWords) break;
    if (canGoBack) {
      const sw = wordCount(sentences[bodyStart - 1]);
      if (bodyWords + sw > sliceWords) break;
      bodyWords += sw;
      bodyStart--;
    }
  }

  // Avoid overlap
  bodyStart = Math.max(bodyStart, openingEnd);
  bodyEnd = Math.min(bodyEnd, closingStart);

  const opening = sentences.slice(0, openingEnd).join(" ");
  const body = bodyStart < bodyEnd ? sentences.slice(bodyStart, bodyEnd).join(" ") : "";
  const closing = sentences.slice(closingStart).join(" ");

  return { opening, body, closing };
}

// ===========================================================================
// Private helpers
// ===========================================================================

interface InnertubeTrack {
  baseUrl: string;
  name?: { simpleText?: string };
  languageCode: string;
  kind?: string;
  vssId?: string;
}

async function getCaptionTracks(
  innertube: InnertubeApi,
  videoId: string,
): Promise<{ tracks: InnertubeTrack[]; title: string | undefined }> {
  const res = await innertube.post("player", {
    context: ANDROID_CLIENT_CONTEXT,
    videoId,
  });

  if (!res.ok) {
    throw new InnertubeError("PARSE_ERROR", `InnerTube player error: ${res.status}`);
  }

  const data: any = await res.json();

  const status = data?.playabilityStatus?.status;
  if (status === "ERROR" || status === "UNPLAYABLE") {
    throw new InnertubeError(
      "VIDEO_UNAVAILABLE",
      data?.playabilityStatus?.reason ?? "Video is unavailable or unplayable",
    );
  }

  const tracks =
    (data?.captions?.playerCaptionsTracklistRenderer?.captionTracks as InnertubeTrack[]) ?? [];
  const title: string | undefined = data?.videoDetails?.title || undefined;

  return { tracks, title };
}

/** Strict language match — returns null if not found (no fallback). */
function pickTrackByLanguage<T extends CaptionTrackInfo>(tracks: T[], lang: string): T | null {
  const normalized = lang.toLowerCase();
  const manual = tracks.find(
    (t) => t.languageCode?.toLowerCase().startsWith(normalized) && t.kind !== "asr",
  );
  if (manual) return manual;
  const asr = tracks.find(
    (t) => t.languageCode?.toLowerCase().startsWith(normalized) && t.kind === "asr",
  );
  return asr ?? null;
}

/** Default track selection: English manual > English ASR > first available. */
function pickBestTrack<T extends CaptionTrackInfo>(tracks: T[]): T | null {
  // Default: prefer English manual > English ASR > first available
  const englishManual: T[] = [];
  const englishAsr: T[] = [];

  for (const track of tracks) {
    const lang = track.languageCode?.toLowerCase() ?? "";
    if (!lang.startsWith("en")) continue;

    if (track.kind === "asr") {
      englishAsr.push(track);
    } else {
      englishManual.push(track);
    }
  }

  if (englishManual.length > 0) return englishManual[0];
  if (englishAsr.length > 0) return englishAsr[0];

  // No English tracks — fall back to first available
  return tracks[0] ?? null;
}

async function fetchCaptionXml(
  transport: Transport,
  baseUrl: string,
): Promise<TranscriptSegment[]> {
  let url: string;
  if (/[?&]fmt=/.test(baseUrl)) {
    url = baseUrl.replace(/([?&])fmt=[^&]*/, "$1fmt=srv1");
  } else {
    const separator = baseUrl.includes("?") ? "&" : "?";
    url = `${baseUrl}${separator}fmt=srv1`;
  }

  const res = await transport.fetch(url);
  if (!res.ok) {
    throw new InnertubeError("PARSE_ERROR", `Failed to fetch caption XML: ${res.status}`);
  }

  const xml = await res.text();
  return parseTranscriptXml(xml);
}

function parseTranscriptXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;

  let match;
  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1]) || 0;
    const duration = parseFloat(match[2]) || 0;
    const rawText = match[3];

    const text = decodeHtmlEntities(rawText.replace(/<[^>]*>/g, "")).trim();

    if (text) {
      segments.push({ text, start, duration });
    }
  }

  return segments;
}

function sampleTranscript(words: string[], budget: number): string {
  if (words.length <= budget) return words.join(" ");

  // Mildly over budget: keep opening + closing, trim the middle
  if (words.length <= budget * 1.5) {
    const head = Math.ceil(budget * 0.6);
    const tail = budget - head;
    return words.slice(0, head).join(" ") + " " + words.slice(-tail).join(" ");
  }

  // Well over budget: sample 3 evenly-spaced chunks
  const chunkSize = Math.floor(budget / 3);
  const midStart = Math.floor((words.length - chunkSize) / 2);

  return (
    words.slice(0, chunkSize).join(" ") +
    " " +
    words.slice(midStart, midStart + chunkSize).join(" ") +
    " " +
    words.slice(-chunkSize).join(" ")
  );
}

function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return raw.filter((s) => s.trim().length > 0);
}
