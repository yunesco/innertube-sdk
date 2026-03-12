# innertube-sdk

YouTube data extraction via the InnerTube API. No API key required.

Get video metadata, transcripts, heatmap engagement data, channel info, comments, chapters, and more — all from YouTube's internal API.

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Client Configuration](#client-configuration)
- [Videos](#videos)
  - [getVideo](#getvideoinput)
  - [getVideos](#getvideosinputs)
  - [getTranscript](#gettranscriptinput-options)
  - [getComments](#getcommentsinput-options)
- [Channels](#channels)
  - [getChannel](#getchannelinput)
  - [getChannelVideos](#getchannelvideosinput-options)
  - [findChannelsByTopic](#findchannelsbytopicquery-limit)
- [Search](#search)
  - [search](#searchquery-options)
  - [searchChannels](#searchchannelsquery-options)
- [Heatmap Analysis](#heatmap-analysis)
  - [findHeatmapSpikes](#findheatmapspikesmarkers-options)
  - [getIntensityForRange](#getintensityforrangemarkers-startms-endms)
  - [alignTranscriptToHeatmap](#aligntranscripttoheatmaptranscript-durationseconds-markers-chapters-segmentdurationsec)
  - [extractEngagementPeaks](#extractengagementpeaksheatmap-segments-threshold)
  - [getTranscriptAtTimestamp](#gettranscriptattimestamptranscript-durationms-startms-endms-maxwords)
  - [getTranscriptFirstNSeconds](#gettranscriptfirstnsecondstranscript-durationms-seconds)
  - [joinSegmentTexts](#joinsegmenttextssegments-startsec-endsec)
- [Standalone Utilities](#standalone-utilities)
  - [parseVideoId](#parsevideoidinput)
  - [parseChannelHandle](#parsechannelhandleinput)
  - [toUploadsPlaylistId](#touploadplaylistidchannelid)
  - [toChannelId](#tochanneliduploadplaylistid)
  - [sanitizeTranscript](#sanitizetranscriptraw-maxchars)
  - [truncateTranscript](#truncatetranscripttext-maxwords)
  - [sliceTranscript](#slicetranscripttext-slicewords)
  - [parseAbbreviatedNumber](#parseabbreviatednumbertext)
- [Error Handling](#error-handling)
- [Types](#types)
- [How It Works](#how-it-works)
- [License](#license)

## Install

```bash
npm install innertube-sdk
```

Requires Node.js >= 18.

## Quick Start

```ts
import { innertube } from "innertube-sdk";

const yt = innertube();

// Get full video details (metadata + engagement data)
const video = await yt.getVideo("dQw4w9WgXcQ");
console.log(video.title, video.views, video.likes);

// Get transcript with timed segments
const transcript = await yt.getTranscript("dQw4w9WgXcQ");
console.log(transcript.text);

// Resolve any channel format
const channel = await yt.getChannel("@mkbhd");
console.log(channel?.name, channel?.subscribers);

// Search YouTube
const results = await yt.search("typescript tutorial");

// Clean up connections
yt.destroy();
```

## Client Configuration

```ts
import { innertube } from "innertube-sdk";

const yt = innertube({ timeout: 20000 });
```

| Option       | Type                                                                 | Default | Description                                                                 |
| ------------ | -------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `timeout`    | `number`                                                             | `15000` | Request timeout in milliseconds                                              |
| `fetch`      | `(url: string, init?: RequestInit) => Promise<Response>`             | —       | Custom fetch (e.g. `proxyFetch` for proxy/IP rotation). Uses global `fetch` if omitted. |
| `getApiKey`  | `(forceRefresh?: boolean) => Promise<string>`                        | —       | App-level API key provider (e.g. Redis-backed). Uses in-memory scraping if omitted. `forceRefresh === true` when SDK gets 400 due to invalid key. |

**Example: custom proxy + Redis-backed API key cache**

```ts
const yt = innertube({
  fetch: proxyFetch,
  getApiKey: (forceRefresh) => getInnertubeApiKey(forceRefresh),
});
```

Call `yt.destroy()` when done to release resources.

---

## Videos

### `getVideo(input)`

Get complete video details by combining `/player` and `/next` endpoint data. Accepts a video ID or any YouTube URL.

```ts
const video = await yt.getVideo("dQw4w9WgXcQ");
// Also accepts URLs:
const video = await yt.getVideo("https://youtu.be/dQw4w9WgXcQ");
```

Returns a [`VideoDetails`](#videodetails) object with everything: metadata, engagement data, heatmap, chapters, related videos, endscreen elements, and available caption tracks.

```ts
console.log(video.title); // "Rick Astley - Never Gonna Give You Up"
console.log(video.duration); // 212 (seconds)
console.log(video.views); // 1500000000
console.log(video.likes); // 15000000
console.log(video.commentCount); // 2800000
console.log(video.publishedAt); // "2009-10-25T00:00:00Z"
console.log(video.isLive); // false
console.log(video.keywords); // ["rick astley", "never gonna give you up", ...]
console.log(video.channel); // { id: "UCuAXFkgsw1L7xaCfnd5JJOw", name: "Rick Astley" }
console.log(video.chapters); // [{ title: "Intro", startMillis: 0 }, ...]
console.log(video.heatmap); // 100 HeatmapMarker[] or null
console.log(video.mostReplayed); // { startMillis, endMillis, peakMillis } or null
console.log(video.related); // RelatedVideo[]
console.log(video.endscreen); // EndscreenElement[]
console.log(video.captionTracks); // CaptionTrackInfo[]
console.log(video.commentsContinuationToken); // string | null — pass to getComments() to skip 1 API call
```

### `getVideos(inputs)`

Get lightweight metadata for multiple videos in parallel (max 10 concurrent). Returns a `Map` keyed by video ID.

```ts
const videos = await yt.getVideos(["dQw4w9WgXcQ", "https://youtu.be/jNQXAC9IVRw", "9bZkp7q19f0"]);

for (const [id, summary] of videos) {
  console.log(`${summary.title} — ${summary.views} views`);
}
```

Returns [`VideoSummary`](#videosummary) objects (lighter than `VideoDetails` — no engagement data, chapters, or heatmap).

### `getTranscript(input, options?)`

Get a video's transcript as clean text with timed segments.

```ts
// Default: auto-selects best track (English manual > English ASR > first available)
const t = await yt.getTranscript("dQw4w9WgXcQ");
console.log(t.text); // Full transcript text
console.log(t.language); // "en"
console.log(t.segments); // TimedTranscriptSegment[]
// [{ text: "Never gonna give you up", startMs: 18000, endMs: 21000 }, ...]
```

**Options:**

| Option          | Type                 | Default | Description                                                 |
| --------------- | -------------------- | ------- | ----------------------------------------------------------- |
| `language`      | `string`             | auto    | Language code (e.g. `"en"`, `"es"`, `"fr"`)                 |
| `captionTracks` | `CaptionTrackInfo[]` | —       | Pre-fetched tracks from `getVideo()` — skips a /player call |

```ts
// Request specific language (throws if unavailable)
const t = await yt.getTranscript("dQw4w9WgXcQ", { language: "es" });

// Skip duplicate /player call by reusing caption tracks
const video = await yt.getVideo("dQw4w9WgXcQ");
const t = await yt.getTranscript("dQw4w9WgXcQ", {
  captionTracks: video.captionTracks,
});
```

**Track selection logic:**

1. If `language` is specified: strict match only (manual > ASR). Throws `NO_CAPTIONS` if not found.
2. Otherwise: English manual > English ASR > first available track.

### `getComments(input, options?)`

Get top comments on a video with automatic pagination.

```ts
const comments = await yt.getComments("dQw4w9WgXcQ"); // top 20
const more = await yt.getComments("dQw4w9WgXcQ", { limit: 100 }); // top 100

// Skip 1 API call when you already have getVideo data
const video = await yt.getVideo("dQw4w9WgXcQ");
const comments = await yt.getComments("dQw4w9WgXcQ", {
  continuationToken: video.commentsContinuationToken,
});

for (const c of comments) {
  console.log(`${c.author}: ${c.text} (${c.likes} likes, ${c.replies} replies)`);
}
```

| Option              | Type     | Default | Description                                      |
| ------------------- | -------- | ------- | ------------------------------------------------ |
| `limit`             | `number` | `20`    | Maximum comments to fetch                        |
| `continuationToken` | `string \| null` | — | From `video.commentsContinuationToken` — skips 1 API call |

---

## Channels

### `getChannel(input)`

Get channel metadata. Accepts `@handle`, channel URL, or `UC...` channel ID.

```ts
const ch = await yt.getChannel("@mkbhd");
const ch = await yt.getChannel("UCBcRF18a7Qf58cCRy5xuWwQ");
const ch = await yt.getChannel("https://www.youtube.com/@mkbhd");
const ch = await yt.getChannel("https://youtube.com/channel/UCBcRF18a7Qf58cCRy5xuWwQ");
const ch = await yt.getChannel("https://youtube.com/c/mkbhd");
```

Returns a [`Channel`](#channel) object or `null` if not found.

```ts
console.log(ch.id); // "UCBcRF18a7Qf58cCRy5xuWwQ"
console.log(ch.name); // "MKBHD"
console.log(ch.handle); // "mkbhd" (without @)
console.log(ch.subscribers); // 19200000
console.log(ch.thumbnail); // "https://yt3.ggpht.com/..."
console.log(ch.uploadsPlaylistId); // "UUBcRF18a7Qf58cCRy5xuWwQ"
```

### `getChannelVideos(input, options?)`

Get a channel's videos sorted by latest or most popular.

```ts
// Latest 30 videos (default)
const videos = await yt.getChannelVideos("@mkbhd");

// Most popular, limited to 10
const popular = await yt.getChannelVideos("@mkbhd", {
  sort: "popular",
  limit: 10,
});

for (const v of videos) {
  console.log(`${v.title} — ${v.views} views — ${v.publishedText}`);
}
```

| Option  | Type                      | Default    | Description              |
| ------- | ------------------------- | ---------- | ------------------------ |
| `sort`  | `"latest"` \| `"popular"` | `"latest"` | Sort order               |
| `limit` | `number`                  | `30`       | Maximum videos to return |

Returns [`ChannelVideo[]`](#channelvideo). `publishedAt` is parsed from relative text (e.g., "2 weeks ago") into an approximate `Date`. It may be `null` if the text can't be parsed.

- **`"latest"`**: InnerTube `/browse` with pagination.
- **`"popular"`**: InnerTube `/browse` with "Popular" tab filter.

### `findChannelsByTopic(query, limit?)`

Discover channel IDs by searching videos on a topic. Returns unique channel IDs from video search results — useful for niche/competitor discovery.

```ts
const channelIds = await yt.findChannelsByTopic("TypeScript tutorials", 20);

for (const id of channelIds) {
  const ch = await yt.getChannel(id);
  console.log(ch?.name, ch?.subscribers);
}
```

---

## Search

### `search(query, options?)`

Search YouTube for videos.

```ts
const results = await yt.search("typescript tutorial");
const limited = await yt.search("react hooks", { limit: 5 });

for (const r of results) {
  console.log(`${r.title} — ${r.channel.name} — ${r.views} views`);
}
```

| Option  | Type     | Default | Description     |
| ------- | -------- | ------- | --------------- |
| `limit` | `number` | `10`    | Maximum results |

Returns [`SearchResult[]`](#searchresult).

### `searchChannels(query, options?)`

Search YouTube for channels.

```ts
const channels = await yt.searchChannels("tech reviews");

for (const ch of channels) {
  console.log(`${ch.name} (@${ch.handle}) — ${ch.subscribers} subs`);
}
```

| Option  | Type     | Default | Description     |
| ------- | -------- | ------- | --------------- |
| `limit` | `number` | `10`    | Maximum results |

Returns [`ChannelResult[]`](#channelresult).

---

## Heatmap Analysis

Pure functions — work with data from `getVideo()`. No client needed.

```ts
import {
  findHeatmapSpikes,
  alignTranscriptToHeatmap,
  extractEngagementPeaks,
  getIntensityForRange,
  getTranscriptAtTimestamp,
  getTranscriptFirstNSeconds,
  joinSegmentTexts,
  PEAK_THRESHOLD,
} from "innertube-sdk";
```

### `findHeatmapSpikes(markers, options?)`

Find contiguous high-intensity regions in a heatmap. Filters markers above the threshold, merges adjacent segments within 1.5x the average segment gap, and returns the top N spikes sorted by peak intensity.

```ts
const spikes = findHeatmapSpikes(video.heatmap, {
  threshold: 0.65,
  maxSpikes: 5,
  skipStartPct: 0.1,
});

for (const spike of spikes) {
  const startSec = Math.round(spike.startMs / 1000);
  const endSec = Math.round(spike.endMs / 1000);
  console.log(`${startSec}s–${endSec}s (peak: ${spike.peakIntensity})`);
}
```

| Option         | Type     | Default | Description                         |
| -------------- | -------- | ------- | ----------------------------------- |
| `threshold`    | `number` | `0.65`  | Minimum intensity to consider (0–1) |
| `maxSpikes`    | `number` | `5`     | Maximum spikes to return            |
| `skipStartPct` | `number` | `0`     | Skip first N% of video (0–1)        |

Returns [`HeatmapSpike[]`](#heatmapspike).

### `getIntensityForRange(markers, startMs, endMs)`

Get the average heatmap intensity for a time range.

```ts
const intensity = getIntensityForRange(video.heatmap, 30000, 60000);
console.log(`30s–60s intensity: ${intensity}`); // 0.0–1.0
```

### `alignTranscriptToHeatmap(transcript, durationSeconds, markers, chapters, segmentDurationSec?)`

Split transcript text into time-aligned segments annotated with heatmap intensity and chapter markers. Uses proportional word mapping.

```ts
const segments = alignTranscriptToHeatmap(
  transcript.text,
  video.duration, // seconds
  video.heatmap, // HeatmapMarker[] | null
  video.chapters, // Chapter[] | null
  30, // segment duration in seconds (default: 30)
);

for (const seg of segments) {
  console.log(
    `[${seg.startSec}s–${seg.endSec}s] avg=${seg.avgIntensity} peak=${seg.peakIntensity}`,
  );
  if (seg.chapterTitle) console.log(`  Chapter: ${seg.chapterTitle}`);
  console.log(`  ${seg.text.slice(0, 100)}...`);
}
```

Returns [`AnnotatedTranscriptSegment[]`](#annotatedtranscriptsegment).

### `extractEngagementPeaks(heatmap, segments, threshold?)`

Scan heatmap for contiguous regions above a threshold and attach the corresponding transcript text from annotated segments.

```ts
const aligned = alignTranscriptToHeatmap(
  transcript.text,
  video.duration,
  video.heatmap,
  video.chapters,
);
const peaks = extractEngagementPeaks(video.heatmap, aligned);
// or with custom threshold:
const peaks = extractEngagementPeaks(video.heatmap, aligned, 0.8);

for (const peak of peaks) {
  console.log(`Peak at ${peak.startSec}s–${peak.endSec}s (intensity: ${peak.peakIntensity})`);
  console.log(`Transcript: ${peak.transcript}`);
}
```

Default threshold: `PEAK_THRESHOLD` (0.7). Returns [`EngagementPeak[]`](#engagementpeak).

### `getTranscriptAtTimestamp(transcript, durationMs, startMs, endMs, maxWords?)`

Extract transcript text for a specific time range using proportional word mapping.

```ts
const text = getTranscriptAtTimestamp(
  transcript.text,
  video.duration * 1000, // total duration in ms
  30000, // start at 30s
  60000, // end at 60s
  100, // max 100 words (optional)
);
```

### `getTranscriptFirstNSeconds(transcript, durationMs, seconds)`

Extract the first N seconds of transcript — useful for hook analysis.

```ts
const hook = getTranscriptFirstNSeconds(transcript.text, video.duration * 1000, 5);
console.log(`First 5 seconds: ${hook}`);
```

### `joinSegmentTexts(segments, startSec, endSec)`

Collect and join text from annotated segments overlapping a time range.

```ts
const text = joinSegmentTexts(segments, 30, 60);
```

---

## Standalone Utilities

These functions work without a client instance:

```ts
import {
  parseVideoId,
  parseChannelHandle,
  toUploadsPlaylistId,
  toChannelId,
  sanitizeTranscript,
  truncateTranscript,
  sliceTranscript,
  parseAbbreviatedNumber,
} from "innertube-sdk";
```

### `parseVideoId(input)`

Extract an 11-character video ID from any YouTube URL format. Returns `null` for invalid input.

```ts
parseVideoId("dQw4w9WgXcQ"); // "dQw4w9WgXcQ"
parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"); // "dQw4w9WgXcQ"
parseVideoId("https://youtu.be/dQw4w9WgXcQ"); // "dQw4w9WgXcQ"
parseVideoId("https://youtube.com/embed/dQw4w9WgXcQ"); // "dQw4w9WgXcQ"
parseVideoId("https://youtube.com/shorts/dQw4w9WgXcQ"); // "dQw4w9WgXcQ"
parseVideoId("https://youtube.com/v/dQw4w9WgXcQ"); // "dQw4w9WgXcQ"
parseVideoId("invalid"); // null
```

### `parseChannelHandle(input)`

Parse any YouTube channel URL or identifier into a typed result.

```ts
parseChannelHandle("@MrBeast"); // { type: "handle", value: "MrBeast" }
parseChannelHandle("youtube.com/@MrBeast"); // { type: "handle", value: "MrBeast" }
parseChannelHandle("youtube.com/channel/UCK7tptU..."); // { type: "id", value: "UCK7tptU..." }
parseChannelHandle("youtube.com/c/MrBeast"); // { type: "custom", value: "MrBeast" }
parseChannelHandle("youtube.com/user/MrBeast"); // { type: "custom", value: "MrBeast" }
parseChannelHandle("UCK7tptU..."); // { type: "id", value: "UCK7tptU..." }
parseChannelHandle("invalid"); // null
```

Returns `{ type: "handle" | "id" | "custom"; value: string }` or `null`.

### `toUploadsPlaylistId(channelId)`

Convert a channel ID (`UC...`) to its uploads playlist ID (`UU...`).

```ts
toUploadsPlaylistId("UCBcRF18a7Qf58cCRy5xuWwQ"); // "UUBcRF18a7Qf58cCRy5xuWwQ"
```

### `toChannelId(uploadPlaylistId)`

Convert an uploads playlist ID (`UU...`) back to a channel ID (`UC...`).

```ts
toChannelId("UUBcRF18a7Qf58cCRy5xuWwQ"); // "UCBcRF18a7Qf58cCRy5xuWwQ"
```

### `sanitizeTranscript(raw, maxChars?)`

Clean raw transcript text through an 11-step sanitization pipeline. Default `maxChars`: 50,000.

```ts
const clean = sanitizeTranscript(rawText);
const short = sanitizeTranscript(rawText, 10000);
```

**Pipeline steps:**

1. Hard character cap
2. Strip HTML tags
3. Decode HTML entities (`&amp;` -> `&`, `&#39;` -> `'`, etc.)
4. Remove zero-width and invisible Unicode characters
5. NFKC normalization (curly quotes -> straight, special spaces -> regular)
6. Strip SRT timestamps and markers
7. Remove URLs
8. Collapse single newlines to spaces
9. Collapse multiple spaces/tabs to single space
10. Collapse 3+ newlines to double newline
11. Final trim

### `truncateTranscript(text, maxWords?)`

Smart-sample transcript to fit a word budget. Default `maxWords`: 5,000.

```ts
const sampled = truncateTranscript(cleanText, 2000);
```

**Sampling strategy:**

- At or under budget: returns as-is
- 1–1.5x budget: trims from the middle, keeps 60% from start and 40% from end
- Over 1.5x budget: samples 3 evenly-spaced chunks (start, middle, end)

### `sliceTranscript(text, sliceWords?)`

Extract 3 targeted transcript slices at sentence boundaries. Default `sliceWords`: 500.

```ts
const { opening, body, closing } = sliceTranscript(cleanText, 300);
```

Returns `TranscriptSlices`:

| Field     | Description                                 |
| --------- | ------------------------------------------- |
| `opening` | First ~N words (sentence-aligned)           |
| `body`    | ~N words from the middle (sentence-aligned) |
| `closing` | Last ~N words (sentence-aligned)            |

### `parseAbbreviatedNumber(text)`

Parse abbreviated numbers common in YouTube's UI. Returns `null` for invalid input.

```ts
parseAbbreviatedNumber("26.4M"); // 26400000
parseAbbreviatedNumber("1.2K"); // 1200
parseAbbreviatedNumber("2.5B"); // 2500000000
parseAbbreviatedNumber("456"); // 456
parseAbbreviatedNumber("invalid"); // null
```

---

## Error Handling

All errors are instances of `InnertubeError` with a typed `code` property:

```ts
import { innertube, InnertubeError } from "innertube-sdk";

const yt = innertube();

try {
  const video = await yt.getVideo("invalid_id");
} catch (err) {
  if (err instanceof InnertubeError) {
    switch (err.code) {
      case "VIDEO_UNAVAILABLE":
        // Video is private, deleted, or age-restricted
        break;
      case "NO_CAPTIONS":
        // Video has no captions, or requested language unavailable
        break;
      case "CHANNEL_NOT_FOUND":
        // Could not resolve the channel
        break;
      case "TIMEOUT":
        // Request exceeded the timeout
        break;
      case "TRANSPORT_ERROR":
        // Network/connection failure
        break;
      case "API_KEY_INVALID":
        // Failed to scrape a valid InnerTube API key
        break;
      case "PARSE_ERROR":
        // Unexpected response format from YouTube
        break;
    }
  }
}
```

| Code                | When                                                     |
| ------------------- | -------------------------------------------------------- |
| `VIDEO_UNAVAILABLE` | Video is private, deleted, age-restricted, or unplayable |
| `NO_CAPTIONS`       | No captions exist or requested language not available    |
| `CHANNEL_NOT_FOUND` | Channel handle/URL/ID could not be resolved              |
| `TIMEOUT`           | Request exceeded the configured timeout                  |
| `TRANSPORT_ERROR`   | Network-level failure (connection refused, reset, etc.)  |
| `API_KEY_INVALID`   | Could not scrape a valid InnerTube API key from YouTube  |
| `PARSE_ERROR`       | YouTube returned an unexpected response structure        |

---

## Types

All types are exported from the main package:

```ts
import type {
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
  FindSpikesOptions,
} from "innertube-sdk";
```

### VideoDetails

```ts
interface VideoDetails {
  id: string;
  title: string;
  description: string;
  duration: number; // seconds
  views: number | null;
  likes: number | null;
  commentCount: number | null;
  publishedAt: string; // ISO 8601
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
  commentsContinuationToken: string | null; // pass to getComments() to skip 1 API call
}
```

### VideoSummary

```ts
interface VideoSummary {
  id: string;
  title: string;
  duration: number; // seconds
  views: number | null;
  publishedAt: string; // ISO 8601
  isLive: boolean;
  channel: { id: string; name: string };
  thumbnailUrl: string;
  defaultLanguage: string | null;
  captionTracks: CaptionTrackInfo[];
}
```

### Channel

```ts
interface Channel {
  id: string; // UC...
  name: string;
  handle: string | null; // without @
  thumbnail: string;
  subscribers: number | null;
  uploadsPlaylistId: string; // UU...
}
```

### ChannelResult

```ts
interface ChannelResult {
  id: string;
  name: string;
  handle: string | null;
  thumbnail: string;
  subscribers: number | null;
}
```

### ChannelVideo

```ts
interface ChannelVideo {
  id: string;
  title: string;
  views: number | null;
  duration: number | null; // seconds
  publishedText: string; // "12 days ago"
  publishedAt: Date | null; // approximate, parsed from relative text like "2 weeks ago"
  thumbnailUrl: string | null;
}
```

### SearchResult

```ts
interface SearchResult {
  id: string;
  title: string;
  views: number | null;
  durationText: string | null; // "12:34"
  publishedText: string | null; // "2 weeks ago"
  channel: { id: string; name: string };
  thumbnailUrl: string | null;
  description: string | null;
}
```

### Transcript

```ts
interface Transcript {
  videoId: string;
  language: string;
  text: string; // full text joined with spaces
  segments: TimedTranscriptSegment[];
}

interface TimedTranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

interface TranscriptSegment {
  text: string;
  start: number; // seconds
  duration: number; // seconds
}
```

### Comment

```ts
interface Comment {
  author: string;
  text: string;
  likes: number;
  replies: number;
  publishedText: string; // "2 months ago"
}
```

### HeatmapMarker

```ts
interface HeatmapMarker {
  startMillis: number;
  durationMillis: number;
  intensityScoreNormalized: number; // 0.0–1.0
}
```

### HeatmapSpike

```ts
interface HeatmapSpike {
  startMs: number;
  endMs: number;
  peakMs: number;
  peakIntensity: number;
  avgIntensity: number;
}
```

### AnnotatedTranscriptSegment

```ts
interface AnnotatedTranscriptSegment {
  startSec: number;
  endSec: number;
  avgIntensity: number;
  peakIntensity: number;
  text: string;
  chapterTitle?: string;
}
```

### EngagementPeak

```ts
interface EngagementPeak {
  startSec: number;
  endSec: number;
  peakIntensity: number;
  transcript: string;
}
```

### Other Types

```ts
interface Chapter {
  title: string;
  startMillis: number;
  thumbnailUrl?: string;
}

interface RelatedVideo {
  id: string;
  title: string;
  channelName: string;
  views: number | null;
  thumbnailUrl: string | null;
  durationText?: string;
}

interface EndscreenElement {
  type: string;
  videoId?: string;
  title?: string;
  channelId?: string;
}

interface CaptionTrackInfo {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" = auto-generated
}

interface MostReplayedSection {
  startMillis: number;
  endMillis: number;
  peakMillis: number;
}

interface TranscriptSlices {
  opening: string;
  body: string;
  closing: string;
}

interface FindSpikesOptions {
  threshold?: number; // default: 0.65
  maxSpikes?: number; // default: 5
  skipStartPct?: number; // default: 0
}
```

---

## How It Works

innertube-sdk uses YouTube's InnerTube API — the same internal API that youtube.com uses. No official API key or OAuth required.

| Data            | Endpoint                              | Client Context |
| --------------- | ------------------------------------- | -------------- |
| Video metadata  | `/player`                             | Android        |
| Engagement data | `/next`                               | Web            |
| Channel info    | `/navigation/resolve_url` + `/browse` | Web            |
| Channel videos  | `/browse`                             | Web            |
| Video search    | `/search`                             | Web            |
| Channel search  | `/search` (channel filter)            | Web            |
| Transcripts     | Caption track URLs from `/player`     | —              |
| Comments        | `/next` (continuation)                | Web            |

**API key lifecycle:**

1. In-memory cache for the scraped API key
2. If no key found, scrape YouTube homepage HTML for `"INNERTUBE_API_KEY":"xxx"`
3. On 400 response with invalid key: invalidate cache, scrape fresh key, retry once

## License

MIT
