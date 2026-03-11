import { ANDROID_CLIENT_CONTEXT, InnertubeApi, WEB_CLIENT_CONTEXT } from "./innertube.js";
import type {
  CaptionTrackInfo,
  Chapter,
  Comment,
  EndscreenElement,
  HeatmapMarker,
  MostReplayedSection,
  NextData,
  PlayerData,
  RelatedVideo,
  SearchResult,
  VideoDetails,
  VideoHeatmap,
  VideoSummary,
} from "./types.js";
import { InnertubeError } from "./types.js";
import { parseAbbreviatedNumber } from "./utils.js";

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

const YT_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=)([\w-]{11})/,
  /(?:youtu\.be\/)([\w-]{11})/,
  /(?:youtube\.com\/embed\/)([\w-]{11})/,
  /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  /(?:youtube\.com\/v\/)([\w-]{11})/,
];

/** Extract an 11-character video ID from any YouTube URL format. */
export function parseVideoId(url: string): string | null {
  const trimmed = url.trim();
  for (const pattern of YT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  // Bare 11-char ID
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

// ---------------------------------------------------------------------------
// Batch metadata
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_PLAYER = 10;

/** @internal */
export async function getVideoMetadata(
  innertube: InnertubeApi,
  videoIds: string[],
): Promise<Map<string, VideoSummary>> {
  if (videoIds.length === 0) return new Map();

  const results = new Map<string, VideoSummary>();

  for (let i = 0; i < videoIds.length; i += MAX_CONCURRENT_PLAYER) {
    const batch = videoIds.slice(i, i + MAX_CONCURRENT_PLAYER);

    const settled = await Promise.allSettled(
      batch.map(async (videoId) => {
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
          return null;
        }

        const details = data?.videoDetails as InnertubeVideoDetails | undefined;
        if (!details) return null;

        const microformat = data?.microformat?.playerMicroformatRenderer as
          | { publishDate?: string; defaultAudioLanguage?: string }
          | undefined;
        const publishDate =
          microformat?.publishDate ??
          (details as { uploadDate?: string }).uploadDate ??
          (data?.videoDetails as { uploadDate?: string })?.uploadDate ??
          "";

        const duration = parseInt(details.lengthSeconds || "0", 10);
        const viewCount = parseInt(details.viewCount || "0", 10);
        const thumbnailUrl = `https://i.ytimg.com/vi/${details.videoId}/maxresdefault.jpg`;

        const rawTracks =
          (data?.captions?.playerCaptionsTracklistRenderer?.captionTracks as
            | Array<{
                baseUrl?: string;
                languageCode?: string;
                kind?: string;
              }>
            | undefined) ?? [];

        const captionTracks: CaptionTrackInfo[] = rawTracks
          .filter(
            (t): t is { baseUrl: string; languageCode: string; kind?: string } =>
              !!t.baseUrl && !!t.languageCode,
          )
          .map((t) => ({
            baseUrl: t.baseUrl,
            languageCode: t.languageCode,
            kind: t.kind,
          }));

        return {
          id: details.videoId,
          duration,
          title: details.title,
          channel: { id: details.channelId, name: details.author },
          publishedAt: publishDate,
          isLive: details.isLive === true || details.isLiveContent === true,
          views: viewCount || null,
          thumbnailUrl,
          defaultLanguage: microformat?.defaultAudioLanguage ?? null,
          captionTracks,
        } satisfies VideoSummary;
      }),
    );

    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        results.set(result.value.id, result.value);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Full player data (X-Ray)
// ---------------------------------------------------------------------------

/** @internal */
export async function getVideoPlayerData(
  innertube: InnertubeApi,
  videoId: string,
): Promise<PlayerData> {
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

  const details = data?.videoDetails as InnertubeVideoDetails | undefined;
  if (!details) {
    throw new InnertubeError("PARSE_ERROR", "No video details in player response");
  }

  const microformat = data?.microformat?.playerMicroformatRenderer as
    | { publishDate?: string; defaultAudioLanguage?: string }
    | undefined;

  return {
    keywords: (data?.videoDetails?.keywords as string[]) ?? [],
    shortDescription: details.shortDescription ?? "",
    endscreen: parseEndscreenElements(data),
    captionTracks: parseCaptionTracks(data),
    title: details.title,
    channelId: details.channelId,
    channelTitle: details.author,
    duration: parseInt(details.lengthSeconds || "0", 10),
    viewCount: parseInt(details.viewCount || "0", 10) || null,
    publishedAt: microformat?.publishDate ?? "",
    isLive: details.isLive === true || details.isLiveContent === true,
    defaultLanguage: microformat?.defaultAudioLanguage ?? null,
  };
}

// ---------------------------------------------------------------------------
// Full video details (combined player + next)
// ---------------------------------------------------------------------------

/** Fetch complete video details by combining /player and /next data in parallel. */
export async function getFullVideoDetails(
  innertube: InnertubeApi,
  videoId: string,
): Promise<VideoDetails> {
  const [playerData, nextData] = await Promise.all([
    getVideoPlayerData(innertube, videoId),
    getVideoNextData(innertube, videoId),
  ]);

  return {
    id: videoId,
    title: playerData.title,
    description: playerData.shortDescription,
    duration: playerData.duration,
    views: nextData.viewCountExact ?? playerData.viewCount,
    likes: nextData.likeCount,
    commentCount: nextData.commentCount,
    publishedAt: playerData.publishedAt,
    isLive: playerData.isLive,
    keywords: playerData.keywords,
    channel: { id: playerData.channelId, name: playerData.channelTitle },
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    defaultLanguage: playerData.defaultLanguage,
    chapters: nextData.chapters,
    heatmap: nextData.heatmap,
    mostReplayed: nextData.mostReplayed,
    related: nextData.relatedVideos,
    endscreen: playerData.endscreen,
    captionTracks: playerData.captionTracks,
    commentsContinuationToken: nextData.commentsContinuationToken,
  };
}

// ---------------------------------------------------------------------------
// Full next data (X-Ray)
// ---------------------------------------------------------------------------

/** @internal */
export async function getVideoNextData(
  innertube: InnertubeApi,
  videoId: string,
): Promise<NextData> {
  const res = await innertube.post("next", {
    context: WEB_CLIENT_CONTEXT,
    videoId,
  });

  if (!res.ok) {
    throw new InnertubeError("PARSE_ERROR", `InnerTube next error: ${res.status}`);
  }

  const data: any = await res.json();
  const heatmapResult = parseHeatmapFromNextResponse(videoId, data);
  const engagement = parseEngagementCounts(data);

  return {
    heatmap: heatmapResult?.markers ?? null,
    mostReplayed: heatmapResult?.mostReplayed ?? null,
    chapters: parseChaptersFromNextResponse(data),
    likeCount: engagement.likeCount,
    commentCount: engagement.commentCount,
    viewCountExact: engagement.viewCountExact,
    relatedVideos: parseRelatedVideos(data),
    commentsContinuationToken: parseCommentsContinuationToken(data),
  };
}

// ---------------------------------------------------------------------------
// Comments by video ID
// ---------------------------------------------------------------------------

/** Fetch comments for a video by ID, with automatic pagination. */
export async function getVideoCommentsByVideoId(
  innertube: InnertubeApi,
  videoId: string,
  limit: number = 20,
  continuationToken?: string | null,
): Promise<Comment[]> {
  let token: string | null =
    continuationToken ?? (await getVideoNextData(innertube, videoId)).commentsContinuationToken;
  if (!token) return [];

  const allComments: Comment[] = [];

  while (token && allComments.length < limit) {
    const res = await innertube.post("next", {
      context: WEB_CLIENT_CONTEXT,
      continuation: token,
    });

    if (!res.ok) break;

    const data: any = await res.json();
    const { comments, nextToken } = parseCommentsPage(data, limit - allComments.length);
    allComments.push(...comments);
    token = nextToken;
  }

  return allComments.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Video search
// ---------------------------------------------------------------------------

/** Search YouTube for videos matching a query. */
export async function searchVideos(
  innertube: InnertubeApi,
  query: string,
  maxResults: number = 10,
): Promise<SearchResult[]> {
  const res = await innertube.post("search", {
    context: WEB_CLIENT_CONTEXT,
    query,
    params: "EgIQAQ==", // video-only filter
  });

  if (!res.ok) {
    throw new InnertubeError("PARSE_ERROR", `InnerTube search error: ${res.status}`);
  }

  const data: any = await res.json();
  const results = parseSearchResults(data, maxResults);

  return results;
}

// ===========================================================================
// Private types and parsers
// ===========================================================================

interface InnertubeVideoDetails {
  videoId: string;
  title: string;
  lengthSeconds: string;
  channelId: string;
  shortDescription: string;
  thumbnail: { thumbnails: { url: string; width: number; height: number }[] };
  viewCount: string;
  author: string;
  isLiveContent: boolean;
  isLive?: boolean;
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

export function parseHeatmapFromNextResponse(
  videoId: string,
  data: Record<string, unknown>,
): VideoHeatmap | null {
  try {
    const mutations =
      ((
        (data.frameworkUpdates as Record<string, unknown>)?.entityBatchUpdate as Record<
          string,
          unknown
        >
      )?.mutations as Array<Record<string, unknown>>) ?? [];

    for (const mutation of mutations) {
      const entity = (mutation.payload as Record<string, unknown>)?.macroMarkersListEntity as
        | Record<string, unknown>
        | undefined;
      if (!entity) continue;

      const markersList = entity.markersList as Record<string, unknown> | undefined;
      if (markersList?.markerType !== "MARKER_TYPE_HEATMAP") continue;

      const rawMarkers = (markersList.markers as Array<Record<string, unknown>>) ?? [];
      if (rawMarkers.length === 0) return null;

      const markers: HeatmapMarker[] = rawMarkers.map((m) => ({
        startMillis: parseInt(String(m.startMillis), 10),
        durationMillis: parseInt(String(m.durationMillis), 10),
        intensityScoreNormalized: Number(m.intensityScoreNormalized),
      }));

      let mostReplayed: MostReplayedSection | null = null;
      const decorations = (markersList.markersDecoration as Record<string, unknown>)
        ?.timedMarkerDecorations as Array<Record<string, unknown>> | undefined;

      if (decorations?.[0]) {
        const d = decorations[0];
        mostReplayed = {
          startMillis: parseInt(String(d.visibleTimeRangeStartMillis), 10),
          endMillis: parseInt(String(d.visibleTimeRangeEndMillis), 10),
          peakMillis: parseInt(String(d.decorationTimeMillis), 10),
        };
      }

      return { videoId, markers, mostReplayed };
    }
  } catch {
    // Heatmap not available
  }

  return null;
}

// ---------------------------------------------------------------------------
// Endscreen
// ---------------------------------------------------------------------------

function parseEndscreenElements(data: Record<string, unknown>): EndscreenElement[] {
  try {
    const endscreenRenderer = (data?.endscreen as Record<string, unknown> | undefined)
      ?.endscreenRenderer;
    if (!endscreenRenderer) return [];

    const elements = (endscreenRenderer as Record<string, unknown>).elements as
      | Array<Record<string, unknown>>
      | undefined;

    const result: EndscreenElement[] = [];
    for (const el of elements ?? []) {
      const renderer = el.endscreenElementRenderer as Record<string, unknown> | undefined;
      if (!renderer) continue;

      const style = String(renderer.style ?? "");
      const endpoint = renderer.endpoint as Record<string, unknown> | undefined;
      const watchEndpoint = endpoint?.watchEndpoint as Record<string, unknown> | undefined;
      const browseEndpoint = endpoint?.browseEndpoint as Record<string, unknown> | undefined;
      const titleRuns = (
        (renderer.title as Record<string, unknown>)?.runs as Array<{ text: string }> | undefined
      )?.[0];

      result.push({
        type: style.replace("ENDSCREEN_STYLE_", ""),
        videoId: watchEndpoint?.videoId as string | undefined,
        title: titleRuns?.text,
        channelId: browseEndpoint?.browseId as string | undefined,
      });
    }
    return result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Caption tracks
// ---------------------------------------------------------------------------

function parseCaptionTracks(data: Record<string, unknown>): CaptionTrackInfo[] {
  try {
    const captions = data?.captions as Record<string, unknown> | undefined;
    const tracklistRenderer = captions?.playerCaptionsTracklistRenderer as
      | Record<string, unknown>
      | undefined;
    const rawTracks =
      (tracklistRenderer?.captionTracks as
        | Array<{ baseUrl?: string; languageCode?: string; kind?: string }>
        | undefined) ?? [];

    return rawTracks
      .filter(
        (t): t is { baseUrl: string; languageCode: string; kind?: string } =>
          !!t.baseUrl && !!t.languageCode,
      )
      .map((t) => ({
        baseUrl: t.baseUrl,
        languageCode: t.languageCode,
        kind: t.kind,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

function parseChaptersFromNextResponse(data: Record<string, unknown>): Chapter[] {
  try {
    const mutations =
      ((
        (data.frameworkUpdates as Record<string, unknown>)?.entityBatchUpdate as Record<
          string,
          unknown
        >
      )?.mutations as Array<Record<string, unknown>>) ?? [];

    const chapters: Chapter[] = [];
    for (const mutation of mutations) {
      const entity = (mutation.payload as Record<string, unknown>)?.macroMarkersListEntity as
        | Record<string, unknown>
        | undefined;
      if (!entity) continue;

      const markersList = entity.markersList as Record<string, unknown> | undefined;
      if (markersList?.markerType !== "MARKER_TYPE_TIMESTAMPS") continue;

      const rawMarkers = (markersList.markers as Array<Record<string, unknown>>) ?? [];
      for (const m of rawMarkers) {
        const titleRuns = (
          (m.title as Record<string, unknown>)?.runs as Array<{ text: string }> | undefined
        )?.[0];
        const thumbs = (
          (m.thumbnail as Record<string, unknown>)?.thumbnails as Array<{ url: string }> | undefined
        )?.[0];

        chapters.push({
          title: titleRuns?.text ?? "",
          startMillis: parseInt(String(m.startMillis), 10),
          thumbnailUrl: thumbs?.url,
        });
      }
    }
    return chapters;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Engagement counts
// ---------------------------------------------------------------------------

function getPrimaryResultContents(data: Record<string, unknown>): Array<Record<string, unknown>> {
  try {
    const contents = data?.contents as Record<string, unknown> | undefined;
    const results = contents?.twoColumnWatchNextResults as Record<string, unknown> | undefined;
    const primary = results?.results as Record<string, unknown> | undefined;
    return (
      ((primary?.results as Record<string, unknown>)?.contents as
        | Array<Record<string, unknown>>
        | undefined) ?? []
    );
  } catch {
    return [];
  }
}

interface EngagementCounts {
  likeCount: number | null;
  commentCount: number | null;
  viewCountExact: number | null;
}

function parseEngagementCounts(data: Record<string, unknown>): EngagementCounts {
  const result: EngagementCounts = {
    likeCount: null,
    commentCount: null,
    viewCountExact: null,
  };

  try {
    const items = getPrimaryResultContents(data);

    for (const item of items) {
      const vpir = item.videoPrimaryInfoRenderer as Record<string, unknown> | undefined;
      if (vpir) {
        result.viewCountExact = parseViewCount(vpir);
        result.likeCount = parseLikeCount(vpir);
      }
    }

    result.commentCount = parseCommentCountFromPanels(data);
  } catch {
    // Engagement data not available
  }

  return result;
}

function parseViewCount(vpir: Record<string, unknown>): number | null {
  try {
    const viewCountEntity = vpir.viewCount as Record<string, unknown> | undefined;
    const viewCountRenderer = viewCountEntity?.videoViewCountRenderer as
      | Record<string, unknown>
      | undefined;
    if (!viewCountRenderer) return null;

    const viewCountText = (viewCountRenderer.viewCount as Record<string, unknown>)?.simpleText as
      | string
      | undefined;
    if (!viewCountText) return null;

    const parsed = parseInt(viewCountText.replace(/[^0-9]/g, ""), 10);
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function parseLikeCount(vpir: Record<string, unknown>): number | null {
  try {
    const factoids = (vpir.videoActions as Record<string, unknown>)?.menuRenderer as
      | Record<string, unknown>
      | undefined;
    const topLevelButtons = factoids?.topLevelButtons as Array<Record<string, unknown>> | undefined;

    for (const btn of topLevelButtons ?? []) {
      const segmented = btn.segmentedLikeDislikeButtonViewModel as
        | Record<string, unknown>
        | undefined;
      if (!segmented) continue;

      const likeBtn = segmented.likeButtonViewModel as Record<string, unknown> | undefined;
      const likeModel = likeBtn?.likeButtonViewModel as Record<string, unknown> | undefined;
      const toggleModel = likeModel?.toggleButtonViewModel as Record<string, unknown> | undefined;
      const toggleDefault = toggleModel?.toggleButtonViewModel as
        | Record<string, unknown>
        | undefined;
      const defaultBtn = toggleDefault?.defaultButtonViewModel as
        | Record<string, unknown>
        | undefined;
      const buttonModel = defaultBtn?.buttonViewModel as Record<string, unknown> | undefined;
      const likeTitle = buttonModel?.title as string | undefined;

      if (likeTitle) {
        return parseAbbreviatedNumber(likeTitle);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseCommentCountFromPanels(data: Record<string, unknown>): number | null {
  try {
    const panels = data.engagementPanels as Array<Record<string, unknown>> | undefined;
    for (const panel of panels ?? []) {
      const panelRenderer = panel.engagementPanelSectionListRenderer as
        | Record<string, unknown>
        | undefined;
      if (!panelRenderer) continue;

      const panelId = panelRenderer.panelIdentifier as string | undefined;
      if (panelId !== "engagement-panel-comments-section") continue;

      const header = panelRenderer.header as Record<string, unknown> | undefined;
      const titleHeader = header?.engagementPanelTitleHeaderRenderer as
        | Record<string, unknown>
        | undefined;
      if (!titleHeader) continue;

      const contextualInfo = titleHeader.contextualInfo as Record<string, unknown> | undefined;
      const runs = contextualInfo?.runs as Array<Record<string, unknown>> | undefined;
      if (runs) {
        const fullText = runs.map((r) => r.text).join("");
        const result = parseAbbreviatedNumber(fullText);
        if (result) return result;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Related videos
// ---------------------------------------------------------------------------

function parseRelatedVideos(data: Record<string, unknown>): RelatedVideo[] {
  try {
    const contents = data?.contents as Record<string, unknown> | undefined;
    const results = contents?.twoColumnWatchNextResults as Record<string, unknown> | undefined;
    const secondary = (results?.secondaryResults as Record<string, unknown>)?.secondaryResults as
      | Record<string, unknown>
      | undefined;
    let items = (secondary?.results as Array<Record<string, unknown>>) ?? [];
    if (items.length === 0) {
      const sectionList = secondary?.sectionListRenderer as Record<string, unknown> | undefined;
      const sectionContents = sectionList?.contents as Array<Record<string, unknown>> | undefined;
      for (const section of sectionContents ?? []) {
        const sectionItems = (section?.itemSectionRenderer as Record<string, unknown>)?.contents as
          | Array<Record<string, unknown>>
          | undefined;
        if (sectionItems) items = sectionItems;
        break;
      }
    }

    const videos: RelatedVideo[] = [];
    for (const item of items.slice(0, 15)) {
      const lockup = item.lockupViewModel as Record<string, unknown> | undefined;
      if (lockup?.contentId && /^[\w-]{11}$/.test(String(lockup.contentId))) {
        const meta = (lockup.metadata as Record<string, unknown>)?.lockupMetadataViewModel as
          | Record<string, unknown>
          | undefined;
        const title = (meta?.title as { content?: string })?.content ?? "";
        const img = meta?.image as Record<string, unknown> | undefined;
        const a11y = (img?.decoratedAvatarViewModel as Record<string, unknown>)?.a11yLabel as
          | string
          | undefined;
        const contentMeta = (meta?.metadata as Record<string, unknown>)
          ?.contentMetadataViewModel as Record<string, unknown> | undefined;
        const rows = (contentMeta?.metadataRows as Array<Record<string, unknown>>) ?? [];
        let channelName = a11y?.replace(/^Go to channel\s+/i, "") ?? "";
        if (!channelName && rows[0]) {
          const p0 = (rows[0].metadataParts as Array<{ text?: { content?: string } }>)?.[0];
          channelName = p0?.text?.content ?? "";
        }
        let views: number | null = null;
        if (rows[1]) {
          const parts = (rows[1].metadataParts as Array<{ text?: { content?: string } }>) ?? [];
          const viewStr = parts[0]?.text?.content ?? "";
          if (viewStr) views = parseAbbreviatedNumber(viewStr.replace(/\s*views?\s*$/i, "").trim());
        }
        const thumbSrc = (lockup.contentImage as Record<string, unknown>)?.thumbnailViewModel as
          | Record<string, unknown>
          | undefined;
        const sources = (thumbSrc?.image as { sources?: { url?: string }[] })?.sources;
        const thumbnailUrl = sources?.[0]?.url ?? null;
        videos.push({
          id: lockup.contentId as string,
          title,
          channelName,
          views,
          thumbnailUrl,
        });
        continue;
      }

      const content = (item.richItemRenderer as Record<string, unknown>)?.content as Record<
        string,
        unknown
      > | undefined;
      const compact = ((item.compactVideoRenderer as Record<string, unknown>) ??
        (content?.compactVideoRenderer as Record<string, unknown>) ??
        content) as Record<string, unknown> | undefined;
      if (!compact?.videoId) continue;

      const titleRuns = (
        (compact.title as Record<string, unknown>)?.runs as Array<{ text: string }> | undefined
      )?.[0];
      const rawViewCount =
        ((compact.viewCountText as Record<string, unknown>)?.simpleText as string) ?? null;
      let views: number | null = null;
      if (rawViewCount) {
        const stripped = rawViewCount.replace(/\s*views?\s*$/i, "").trim();
        views = parseAbbreviatedNumber(stripped);
      }

      videos.push({
        id: compact.videoId as string,
        title: titleRuns?.text ?? "",
        channelName:
          (
            (compact.longBylineText as Record<string, unknown>)?.runs as
              | Array<{ text: string }>
              | undefined
          )?.[0]?.text ?? "",
        views,
        thumbnailUrl:
          (
            (compact.thumbnail as Record<string, unknown>)?.thumbnails as
              | Array<{ url: string }>
              | undefined
          )?.[0]?.url ?? null,
        durationText:
          ((compact.lengthText as Record<string, unknown>)?.simpleText as string) ?? undefined,
      });
    }
    return videos;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Comments continuation token
// ---------------------------------------------------------------------------

function parseCommentsContinuationToken(data: Record<string, unknown>): string | null {
  try {
    const items = getPrimaryResultContents(data);

    for (const item of items) {
      const itemSection = item.itemSectionRenderer as Record<string, unknown> | undefined;
      if (!itemSection) continue;

      const sectionContents = itemSection.contents as Array<Record<string, unknown>> | undefined;
      for (const sc of sectionContents ?? []) {
        const continuation = sc.continuationItemRenderer as Record<string, unknown> | undefined;
        if (!continuation) continue;

        const endpoint = continuation.continuationEndpoint as Record<string, unknown> | undefined;
        const cmd = endpoint?.continuationCommand as Record<string, unknown> | undefined;
        if (cmd?.token) return cmd.token as string;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Comments page parsing
// ---------------------------------------------------------------------------

function parseCommentsPage(
  data: Record<string, unknown>,
  limit: number = 20,
): { comments: Comment[]; nextToken: string | null } {
  const comments: Comment[] = [];
  let nextToken: string | null = null;

  try {
    // Parse comments from mutations (same as before)
    const mutations =
      ((
        (data.frameworkUpdates as Record<string, unknown>)?.entityBatchUpdate as Record<
          string,
          unknown
        >
      )?.mutations as Array<Record<string, unknown>>) ?? [];

    for (const mutation of mutations) {
      const payload = mutation.payload as Record<string, unknown> | undefined;
      const commentEntity = payload?.commentEntityPayload as Record<string, unknown> | undefined;
      if (!commentEntity) continue;

      const properties = commentEntity.properties as Record<string, unknown> | undefined;
      const toolbar = commentEntity.toolbar as Record<string, unknown> | undefined;
      const author = commentEntity.author as Record<string, unknown> | undefined;
      if (!properties) continue;

      const content = (properties.content as Record<string, unknown>)?.content as
        | string
        | undefined;

      comments.push({
        author: (author?.displayName as string) ?? "Unknown",
        text: content ?? "",
        likes: parseInt(String(toolbar?.likeCountLiked ?? "0"), 10) || 0,
        replies: parseInt(String(toolbar?.replyCount ?? "0"), 10) || 0,
        publishedText: (properties.publishedTime as string) ?? "",
      });

      if (comments.length >= limit) break;
    }

    // Extract next continuation token from response
    nextToken = parseResponseContinuationToken(data);
  } catch {
    // Return whatever we extracted
  }

  return { comments, nextToken };
}

function parseResponseContinuationToken(data: Record<string, unknown>): string | null {
  try {
    const endpoints = (data.onResponseReceivedEndpoints as Array<Record<string, unknown>>) ?? [];

    for (const endpoint of endpoints) {
      const action = (endpoint.reloadContinuationItemsCommand ??
        endpoint.appendContinuationItemsAction) as Record<string, unknown> | undefined;
      if (!action?.continuationItems) continue;

      const items = action.continuationItems as Array<Record<string, unknown>>;
      for (const item of items) {
        const contRenderer = item.continuationItemRenderer as Record<string, unknown> | undefined;
        if (!contRenderer) continue;

        // Direct continuationEndpoint path
        const contEndpoint = contRenderer.continuationEndpoint as
          | Record<string, unknown>
          | undefined;
        const contCmd = contEndpoint?.continuationCommand as Record<string, unknown> | undefined;
        if (contCmd?.token) return contCmd.token as string;

        // Button path (used by some comment sections)
        const button = contRenderer.button as Record<string, unknown> | undefined;
        const buttonRenderer = button?.buttonRenderer as Record<string, unknown> | undefined;
        const command = buttonRenderer?.command as Record<string, unknown> | undefined;
        const contCommand = command?.continuationCommand as Record<string, unknown> | undefined;
        if (contCommand?.token) return contCommand.token as string;
      }
    }
  } catch {
    // No continuation available
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

function parseSearchResults(data: Record<string, unknown>, maxResults: number): SearchResult[] {
  try {
    const contents = data?.contents as Record<string, unknown> | undefined;
    const twoCol = contents?.twoColumnSearchResultsRenderer as Record<string, unknown> | undefined;
    const primaryContents = twoCol?.primaryContents as Record<string, unknown> | undefined;
    const sectionListRenderer = primaryContents?.sectionListRenderer as
      | Record<string, unknown>
      | undefined;
    const sectionContents = sectionListRenderer?.contents as
      | Array<Record<string, unknown>>
      | undefined;

    const results: SearchResult[] = [];

    for (const section of sectionContents ?? []) {
      const itemSection = section.itemSectionRenderer as Record<string, unknown> | undefined;
      if (!itemSection) continue;

      const items = itemSection.contents as Array<Record<string, unknown>> | undefined;

      for (const item of items ?? []) {
        if (results.length >= maxResults) break;

        const renderer = item.videoRenderer as Record<string, unknown> | undefined;
        if (!renderer) continue;

        const videoId = renderer.videoId as string | undefined;
        if (!videoId) continue;

        // Title
        const titleRuns = (renderer.title as Record<string, unknown>)?.runs as
          | Array<{ text: string }>
          | undefined;
        const title = titleRuns?.map((r) => r.text).join("") ?? "";

        // Views
        const viewCountText = (renderer.viewCountText as Record<string, unknown>)?.simpleText as
          | string
          | undefined;
        let views: number | null = null;
        if (viewCountText) {
          const stripped = viewCountText.replace(/\s*views?\s*$/i, "").trim();
          views = parseAbbreviatedNumber(stripped);
        }

        // Duration
        const durationText =
          ((renderer.lengthText as Record<string, unknown>)?.simpleText as string) ?? null;

        // Published text
        const publishedText =
          ((renderer.publishedTimeText as Record<string, unknown>)?.simpleText as string) ?? null;

        // Channel
        const ownerRuns = (
          (renderer.ownerText as Record<string, unknown>)?.runs as
            | Array<Record<string, unknown>>
            | undefined
        )?.[0];
        const channelName = (ownerRuns?.text as string) ?? "";
        const browseEndpoint = (ownerRuns?.navigationEndpoint as Record<string, unknown>)
          ?.browseEndpoint as Record<string, unknown> | undefined;
        const channelId = (browseEndpoint?.browseId as string) ?? "";

        // Thumbnail
        const thumbnailUrl =
          (
            (renderer.thumbnail as Record<string, unknown>)?.thumbnails as
              | Array<{ url: string }>
              | undefined
          )?.[0]?.url ?? null;

        // Description
        let description: string | null = null;
        const detailedSnippets = (
          renderer.detailedMetadataSnippets as Array<Record<string, unknown>> | undefined
        )?.[0];
        if (detailedSnippets) {
          const snippetRuns = (detailedSnippets.snippetText as Record<string, unknown>)?.runs as
            | Array<{ text: string }>
            | undefined;
          if (snippetRuns) {
            description = snippetRuns.map((r) => r.text).join("");
          }
        }
        if (!description) {
          const descSnippet = renderer.descriptionSnippet as Record<string, unknown> | undefined;
          const descRuns = descSnippet?.runs as Array<{ text: string }> | undefined;
          if (descRuns) {
            description = descRuns.map((r) => r.text).join("");
          }
        }

        results.push({
          id: videoId,
          title,
          views,
          durationText,
          publishedText,
          channel: { id: channelId, name: channelName },
          thumbnailUrl,
          description,
        });
      }

      if (results.length >= maxResults) break;
    }

    return results;
  } catch {
    return [];
  }
}
