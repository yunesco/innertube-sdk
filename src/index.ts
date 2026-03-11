// ---------------------------------------------------------------------------
// innertube-sdk — YouTube InnerTube API client
// ---------------------------------------------------------------------------

// Client factory
export { innertube, type InnertubeClient } from "./client.js";

// Error class
export { InnertubeError } from "./types.js";

// Types
export type {
  // Config
  InnertubeConfig,
  InnertubeErrorCode,
  // Video
  VideoDetails,
  VideoSummary,
  CaptionTrackInfo,
  Chapter,
  Comment,
  RelatedVideo,
  EndscreenElement,
  // Channel
  Channel,
  ChannelResult,
  ChannelVideo,
  ChannelVideoOptions,
  // Search
  SearchResult,
  SearchOptions,
  // Options
  CommentOptions,
  TranscriptOptions,
  // Transcript
  Transcript,
  TranscriptSegment,
  TimedTranscriptSegment,
  TranscriptSlices,
  // Heatmap
  HeatmapMarker,
  MostReplayedSection,
  VideoHeatmap,
  HeatmapSpike,
  AnnotatedTranscriptSegment,
  EngagementPeak,
} from "./types.js";

// Standalone utilities (no client needed)
export { parseVideoId } from "./videos.js";
export { parseChannelHandle, toUploadsPlaylistId, toChannelId } from "./channels.js";
export { sanitizeTranscript, truncateTranscript, sliceTranscript } from "./transcripts.js";
export {
  findHeatmapSpikes,
  getIntensityForRange,
  getTranscriptAtTimestamp,
  getTranscriptFirstNSeconds,
  alignTranscriptToHeatmap,
  extractEngagementPeaks,
  joinSegmentTexts,
  PEAK_THRESHOLD,
  type FindSpikesOptions,
} from "./heatmap.js";
export { parseAbbreviatedNumber } from "./utils.js";
