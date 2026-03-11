import type {
  AnnotatedTranscriptSegment,
  Chapter,
  EngagementPeak,
  HeatmapMarker,
  HeatmapSpike,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default threshold for engagement peak detection (0-1). */
export const PEAK_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Spike detection — merge adjacent high-intensity heatmap segments
// ---------------------------------------------------------------------------

export interface FindSpikesOptions {
  /** Minimum intensity to consider (0-1). Default: 0.65. */
  threshold?: number;
  /** Maximum spikes to return. Default: 5. */
  maxSpikes?: number;
  /** Skip first N% of video (0-1). Default: 0. */
  skipStartPct?: number;
}

/**
 * Find contiguous high-intensity regions in a heatmap.
 *
 * Filters markers above the threshold, merges adjacent segments within
 * 1.5x the average segment gap, and returns the top N spikes sorted by
 * peak intensity.
 */
export function findHeatmapSpikes(
  markers: HeatmapMarker[],
  options?: FindSpikesOptions,
): HeatmapSpike[] {
  const threshold = options?.threshold ?? 0.65;
  const maxSpikes = options?.maxSpikes ?? 5;
  const skipStartPct = options?.skipStartPct ?? 0;

  if (!markers || markers.length === 0) return [];

  const totalDuration =
    markers[markers.length - 1].startMillis + markers[markers.length - 1].durationMillis;
  const skipMs = totalDuration * skipStartPct;

  const hot = markers.filter(
    (m) => m.intensityScoreNormalized >= threshold && m.startMillis >= skipMs,
  );

  if (hot.length === 0) return [];

  const sorted = [...hot].sort((a, b) => a.startMillis - b.startMillis);

  const avgSegDuration =
    markers.length > 1
      ? (markers[markers.length - 1].startMillis - markers[0].startMillis) / (markers.length - 1)
      : markers[0].durationMillis;
  const mergeGap = avgSegDuration * 1.5;

  const regions: HeatmapMarker[][] = [];
  let current: HeatmapMarker[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = current[current.length - 1];
    const prevEnd = prev.startMillis + prev.durationMillis;
    if (sorted[i].startMillis - prevEnd <= mergeGap) {
      current.push(sorted[i]);
    } else {
      regions.push(current);
      current = [sorted[i]];
    }
  }
  regions.push(current);

  const spikes: HeatmapSpike[] = regions.map((region) => {
    const peak = region.reduce((best, m) =>
      m.intensityScoreNormalized > best.intensityScoreNormalized ? m : best,
    );
    const avgIntensity =
      region.reduce((sum, m) => sum + m.intensityScoreNormalized, 0) / region.length;
    const startMs = region[0].startMillis;
    const last = region[region.length - 1];
    const endMs = last.startMillis + last.durationMillis;

    return {
      startMs,
      endMs,
      peakMs: peak.startMillis + Math.floor(peak.durationMillis / 2),
      peakIntensity: peak.intensityScoreNormalized,
      avgIntensity,
    };
  });

  return spikes.sort((a, b) => b.peakIntensity - a.peakIntensity).slice(0, maxSpikes);
}

// ---------------------------------------------------------------------------
// Intensity for a time range
// ---------------------------------------------------------------------------

/** Get heatmap markers that overlap a given time range [startMs, endMs). */
function getOverlappingMarkers(
  markers: HeatmapMarker[],
  startMs: number,
  endMs: number,
): HeatmapMarker[] {
  return markers.filter((m) => {
    const mEnd = m.startMillis + m.durationMillis;
    return m.startMillis < endMs && mEnd > startMs;
  });
}

/** Get the average heatmap intensity for a given time range. */
export function getIntensityForRange(
  markers: HeatmapMarker[],
  startMs: number,
  endMs: number,
): number {
  if (!markers || markers.length === 0) return 0;
  const overlapping = getOverlappingMarkers(markers, startMs, endMs);
  if (overlapping.length === 0) return 0;
  return overlapping.reduce((sum, m) => sum + m.intensityScoreNormalized, 0) / overlapping.length;
}

// ---------------------------------------------------------------------------
// Transcript extraction at timestamp
// ---------------------------------------------------------------------------

/** Extract transcript text for a specific time range using proportional word mapping. */
export function getTranscriptAtTimestamp(
  transcript: string,
  durationMs: number,
  startMs: number,
  endMs: number,
  maxWords?: number,
): string {
  if (!transcript || durationMs <= 0) return "";

  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const startIdx = Math.floor((startMs / durationMs) * words.length);
  const endIdx = Math.ceil((endMs / durationMs) * words.length);

  const clampStart = Math.max(0, Math.min(startIdx, words.length - 1));
  const clampEnd = Math.max(clampStart + 1, Math.min(endIdx, words.length));

  let slice = words.slice(clampStart, clampEnd);
  if (maxWords && slice.length > maxWords) {
    slice = slice.slice(0, maxWords);
  }

  return slice.join(" ");
}

/** Extract the first N seconds of transcript (for hook analysis). */
export function getTranscriptFirstNSeconds(
  transcript: string,
  durationMs: number,
  seconds: number,
): string {
  return getTranscriptAtTimestamp(transcript, durationMs, 0, seconds * 1000);
}

// ---------------------------------------------------------------------------
// Heatmap-transcript alignment
// ---------------------------------------------------------------------------

/**
 * Split transcript into time-aligned segments annotated with heatmap
 * intensity and chapter markers.
 *
 * Uses proportional word mapping. When heatmap is null, segments have
 * intensity 0. When chapters are null, no chapterTitle is set.
 */
export function alignTranscriptToHeatmap(
  transcript: string,
  durationSeconds: number,
  markers: HeatmapMarker[] | null,
  chapters: Chapter[] | null,
  segmentDurationSec: number = 30,
): AnnotatedTranscriptSegment[] {
  if (!transcript || durationSeconds <= 0) return [];

  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const segmentCount = Math.max(1, Math.ceil(durationSeconds / segmentDurationSec));
  const segments: AnnotatedTranscriptSegment[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const startSec = i * segmentDurationSec;
    const endSec = Math.min((i + 1) * segmentDurationSec, durationSeconds);

    const startIdx = Math.floor((startSec / durationSeconds) * words.length);
    const endIdx = Math.ceil((endSec / durationSeconds) * words.length);
    const clampStart = Math.max(0, Math.min(startIdx, words.length - 1));
    const clampEnd = Math.max(clampStart, Math.min(endIdx, words.length));
    const text = words.slice(clampStart, clampEnd).join(" ");

    if (!text) continue;

    let avgIntensity = 0;
    let peakIntensity = 0;
    if (markers && markers.length > 0) {
      const startMs = startSec * 1000;
      const endMs = endSec * 1000;
      const overlapping = getOverlappingMarkers(markers, startMs, endMs);
      if (overlapping.length > 0) {
        avgIntensity =
          overlapping.reduce((sum, m) => sum + m.intensityScoreNormalized, 0) / overlapping.length;
        peakIntensity = Math.max(...overlapping.map((m) => m.intensityScoreNormalized));
      }
    }

    let chapterTitle: string | undefined;
    if (chapters && chapters.length > 0) {
      const startMs = startSec * 1000;
      const endMs = endSec * 1000;
      const ch = chapters.find((c) => c.startMillis >= startMs && c.startMillis < endMs);
      if (ch) chapterTitle = ch.title;
    }

    segments.push({
      startSec,
      endSec,
      avgIntensity: Math.round(avgIntensity * 100) / 100,
      peakIntensity: Math.round(peakIntensity * 100) / 100,
      text,
      chapterTitle,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Engagement peak extraction
// ---------------------------------------------------------------------------

/** Collect text from annotated segments overlapping a time range. */
export function joinSegmentTexts(
  segments: { startSec: number; endSec: number; text: string }[],
  startSec: number,
  endSec: number,
): string {
  return segments
    .filter((s) => s.startSec < endSec && s.endSec > startSec)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

/**
 * Scan heatmap for contiguous regions above threshold and attach
 * the corresponding transcript text.
 */
export function extractEngagementPeaks(
  heatmap: HeatmapMarker[],
  segments: { startSec: number; endSec: number; text: string }[],
  threshold = PEAK_THRESHOLD,
): EngagementPeak[] {
  const peaks: EngagementPeak[] = [];
  let i = 0;

  while (i < heatmap.length) {
    if (heatmap[i].intensityScoreNormalized < threshold) {
      i++;
      continue;
    }

    const startMs = heatmap[i].startMillis;
    let peakIntensity = 0;
    let j = i;
    while (j < heatmap.length && heatmap[j].intensityScoreNormalized >= threshold) {
      peakIntensity = Math.max(peakIntensity, heatmap[j].intensityScoreNormalized);
      j++;
    }

    const last = heatmap[j - 1];
    const endMs = last.startMillis + last.durationMillis;
    const startSec = startMs / 1000;
    const endSec = endMs / 1000;

    peaks.push({
      startSec,
      endSec,
      peakIntensity,
      transcript: joinSegmentTexts(segments, startSec, endSec),
    });
    i = j;
  }

  return peaks;
}
