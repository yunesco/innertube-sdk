// ---------------------------------------------------------------------------
// Public types — no runtime code, safe to import anywhere
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/** Complete video details from combined /player + /next data. */
export interface VideoDetails {
  id: string;
  title: string;
  description: string;
  /** Duration in seconds. */
  duration: number;
  views: number | null;
  likes: number | null;
  commentCount: number | null;
  /** ISO 8601 date string. */
  publishedAt: string;
  isLive: boolean;
  keywords: string[];
  channel: { id: string; name: string };
  thumbnailUrl: string;
  defaultLanguage: string | null;
  chapters: Chapter[];
  heatmap: HeatmapMarker[] | null;
  mostReplayed: MostReplayedSection | null;
  related: RelatedVideo[];
  endscreen: EndscreenElement[];
  captionTracks: CaptionTrackInfo[];
  /** Pass to getComments() to skip 1 API call. */
  commentsContinuationToken: string | null;
}

/** Lightweight video metadata for batch operations. */
export interface VideoSummary {
  id: string;
  title: string;
  /** Duration in seconds. */
  duration: number;
  views: number | null;
  /** ISO 8601 date string. */
  publishedAt: string;
  isLive: boolean;
  channel: { id: string; name: string };
  thumbnailUrl: string;
  defaultLanguage: string | null;
  captionTracks: CaptionTrackInfo[];
}

/** Caption track metadata from /player response. */
export interface CaptionTrackInfo {
  baseUrl: string;
  languageCode: string;
  /** "asr" indicates auto-generated captions. */
  kind?: string;
}

/** Video chapter marker. */
export interface Chapter {
  title: string;
  startMillis: number;
  thumbnailUrl?: string;
}

/** A top-level comment on a video. */
export interface Comment {
  author: string;
  text: string;
  likes: number;
  replies: number;
  /** Relative time string, e.g. "2 months ago". */
  publishedText: string;
}

/** A suggested/related video. */
export interface RelatedVideo {
  id: string;
  title: string;
  channelName: string;
  views: number | null;
  thumbnailUrl: string | null;
  durationText?: string;
}

/** An endscreen card (video, channel, playlist, etc.). */
export interface EndscreenElement {
  type: string;
  videoId?: string;
  title?: string;
  channelId?: string;
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/** Full channel metadata. */
export interface Channel {
  id: string;
  name: string;
  handle: string | null;
  thumbnail: string;
  subscribers: number | null;
  uploadsPlaylistId: string;
}

/** Channel search result. */
export interface ChannelResult {
  id: string;
  name: string;
  handle: string | null;
  thumbnail: string;
  subscribers: number | null;
}

/** Video from channel browse (lightweight, no /player call needed). */
export interface ChannelVideo {
  id: string;
  title: string;
  views: number | null;
  /** Duration in seconds. */
  duration: number | null;
  /** Relative publish text, e.g. "12 days ago". */
  publishedText: string;
  publishedAt: Date | null;
  thumbnailUrl: string | null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Video search result. */
export interface SearchResult {
  id: string;
  title: string;
  views: number | null;
  /** Duration text from YouTube, e.g. "12:34". */
  durationText: string | null;
  publishedText: string | null;
  channel: { id: string; name: string };
  thumbnailUrl: string | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

/** Full transcript with text and timed segments. */
export interface Transcript {
  videoId: string;
  language: string;
  text: string;
  segments: TimedTranscriptSegment[];
}

/** A single transcript segment with timing. */
export interface TranscriptSegment {
  text: string;
  /** Start time in seconds. */
  start: number;
  /** Duration in seconds. */
  duration: number;
}

/** A transcript segment with millisecond-precision timestamps. */
export interface TimedTranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

/** Three targeted transcript slices at sentence boundaries. */
export interface TranscriptSlices {
  opening: string;
  body: string;
  closing: string;
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

/** One of 100 segments dividing the video evenly. */
export interface HeatmapMarker {
  /** Segment start time in milliseconds. */
  startMillis: number;
  /** Segment duration in milliseconds. */
  durationMillis: number;
  /** Normalized intensity score (0.0 = lowest, 1.0 = most replayed). */
  intensityScoreNormalized: number;
}

/** The "Most replayed" range YouTube highlights on the progress bar. */
export interface MostReplayedSection {
  startMillis: number;
  endMillis: number;
  /** Peak point within the range in milliseconds. */
  peakMillis: number;
}

/** Heatmap data for a video (internal). */
export interface VideoHeatmap {
  videoId: string;
  markers: HeatmapMarker[];
  mostReplayed: MostReplayedSection | null;
}

/** A contiguous high-intensity region in the heatmap. */
export interface HeatmapSpike {
  startMs: number;
  endMs: number;
  peakMs: number;
  peakIntensity: number;
  avgIntensity: number;
}

/** A transcript segment annotated with heatmap intensity. */
export interface AnnotatedTranscriptSegment {
  startSec: number;
  endSec: number;
  avgIntensity: number;
  peakIntensity: number;
  text: string;
  chapterTitle?: string;
}

/** A contiguous engagement peak with associated transcript. */
export interface EngagementPeak {
  startSec: number;
  endSec: number;
  peakIntensity: number;
  transcript: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for creating an InnerTube SDK client. */
export interface InnertubeConfig {
  /** Request timeout in milliseconds. Default: 15000. */
  timeout?: number;
  /**
   * Custom fetch implementation (e.g. proxyFetch for proxy/IP rotation).
   * If omitted, uses global `fetch`.
   */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * App-level API key provider (e.g. Redis-backed cache).
   * When provided, the SDK calls this instead of scraping the key itself.
   * `forceRefresh === true` when the SDK gets a 400 due to invalid key.
   * If omitted, the SDK keeps its in-memory scraping behavior.
   */
  getApiKey?: (forceRefresh?: boolean) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for getChannelVideos(). */
export interface ChannelVideoOptions {
  /** Sort order: "latest" (default) or "popular". */
  sort?: "latest" | "popular";
  /** Maximum number of videos to return. Default: 30. */
  limit?: number;
}

/** Options for search() and searchChannels(). */
export interface SearchOptions {
  /** Maximum results to return. Default: 10. */
  limit?: number;
}

/** Options for getComments(). */
export interface CommentOptions {
  limit?: number;
  /** From video.commentsContinuationToken — skips 1 API call. */
  continuationToken?: string | null;
}

/** Options for getTranscript(). */
export interface TranscriptOptions {
  /** Preferred language code (e.g. "en", "es", "fr"). Default: auto (prefers English). */
  language?: string;
  /** Pre-fetched caption tracks from getVideo() — skips a /player call. */
  captionTracks?: CaptionTrackInfo[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type InnertubeErrorCode =
  | "TRANSPORT_ERROR"
  | "TIMEOUT"
  | "API_KEY_INVALID"
  | "VIDEO_UNAVAILABLE"
  | "CHANNEL_NOT_FOUND"
  | "NO_CAPTIONS"
  | "PARSE_ERROR";

export class InnertubeError extends Error {
  override readonly name = "InnertubeError";

  constructor(
    public readonly code: InnertubeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

// ---------------------------------------------------------------------------
// Internal types (used by module files, not re-exported from index.ts)
// ---------------------------------------------------------------------------

/** @internal Full /player extraction with all fields. */
export interface PlayerData {
  keywords: string[];
  shortDescription: string;
  endscreen: EndscreenElement[];
  captionTracks: CaptionTrackInfo[];
  title: string;
  channelId: string;
  channelTitle: string;
  /** Duration in seconds. */
  duration: number;
  viewCount: number | null;
  /** ISO 8601 date string. */
  publishedAt: string;
  isLive: boolean;
  defaultLanguage: string | null;
}

/** @internal Full /next extraction. */
export interface NextData {
  heatmap: HeatmapMarker[] | null;
  mostReplayed: MostReplayedSection | null;
  chapters: Chapter[];
  likeCount: number | null;
  commentCount: number | null;
  viewCountExact: number | null;
  relatedVideos: RelatedVideo[];
  commentsContinuationToken: string | null;
}
