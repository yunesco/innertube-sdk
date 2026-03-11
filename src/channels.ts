import { InnertubeApi, WEB_CLIENT_CONTEXT } from "./innertube.js";
import { Transport } from "./transport.js";
import type { Channel, ChannelResult, ChannelVideo, ChannelVideoOptions } from "./types.js";
import { InnertubeError } from "./types.js";
import { parseAbbreviatedNumber } from "./utils.js";

// ---------------------------------------------------------------------------
// URL parsing utilities
// ---------------------------------------------------------------------------

/** Convert a channel ID (UC...) to its uploads playlist ID (UU...). */
export function toUploadsPlaylistId(channelId: string): string {
  return channelId.startsWith("UC") ? "UU" + channelId.slice(2) : channelId;
}

/** Convert an uploads playlist ID (UU...) back to a channel ID (UC...). */
export function toChannelId(uploadsPlaylistId: string): string {
  return uploadsPlaylistId.startsWith("UU") ? "UC" + uploadsPlaylistId.slice(2) : uploadsPlaylistId;
}

/**
 * Parse any YouTube channel URL or identifier into a typed object.
 *
 * Handles: `@handle`, `youtube.com/@handle`, `youtube.com/channel/UCxxx`,
 * `youtube.com/c/name`, `youtube.com/user/name`, and bare `UCxxx` IDs.
 */
export function parseChannelHandle(
  url: string,
): { type: "handle" | "id" | "custom"; value: string } | null {
  const trimmed = url.trim();

  // Bare handle: @MrBeast
  if (/^@[\w.-]+$/.test(trimmed)) {
    return { type: "handle", value: trimmed.slice(1) };
  }

  // youtube.com/@MrBeast
  const handleMatch = trimmed.match(/(?:youtube\.com|youtu\.be)\/@([\w.-]+)/);
  if (handleMatch?.[1]) return { type: "handle", value: handleMatch[1] };

  // youtube.com/channel/UCX6OQ3...
  const channelIdMatch = trimmed.match(/youtube\.com\/channel\/(UC[\w-]+)/);
  if (channelIdMatch?.[1]) return { type: "id", value: channelIdMatch[1] };

  // youtube.com/c/MrBeast or youtube.com/user/MrBeast
  const customMatch = trimmed.match(/youtube\.com\/(?:c|user)\/([\w.-]+)/);
  if (customMatch?.[1]) return { type: "custom", value: customMatch[1] };

  // Raw channel ID (e.g. UCX6OQ3DkFbGxIStdZP8uQAg — 24 chars, UC prefix)
  if (/^UC[\w-]{22}$/.test(trimmed)) return { type: "id", value: trimmed };

  return null;
}

// ---------------------------------------------------------------------------
// Channel resolution
// ---------------------------------------------------------------------------

/** @internal */
export async function resolveChannel(
  innertube: InnertubeApi,
  input: string,
): Promise<Channel | null> {
  const identifier = parseChannelHandle(input);
  if (!identifier) {
    throw new InnertubeError("CHANNEL_NOT_FOUND", `Could not parse channel identifier: ${input}`);
  }

  return resolveChannelInnertube(innertube, identifier);
}

// ---------------------------------------------------------------------------
// Channel search
// ---------------------------------------------------------------------------

/** @internal */
export async function searchChannels(
  innertube: InnertubeApi,
  query: string,
  maxResults: number = 5,
): Promise<ChannelResult[]> {
  const normalized = query.toLowerCase().trim();
  const results = await searchChannelsInnertube(innertube, normalized);
  return results.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Search videos and return owning channel IDs (niche discovery)
// ---------------------------------------------------------------------------

/** @internal */
export async function searchVideoChannels(
  innertube: InnertubeApi,
  query: string,
  maxResults: number = 15,
): Promise<string[]> {
  const res = await innertube.post("search", {
    context: WEB_CLIENT_CONTEXT,
    query,
  });

  if (!res.ok) {
    throw new InnertubeError("PARSE_ERROR", `InnerTube search error: ${res.status}`);
  }

  const data: any = await res.json();
  const channelIds: string[] = [];
  const seen = new Set<string>();

  try {
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents ?? [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents ?? [];
      for (const item of items) {
        const vr = item?.videoRenderer;
        if (!vr) continue;

        const channelId = vr?.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId as
          | string
          | undefined;
        if (!channelId?.startsWith("UC")) continue;

        if (!seen.has(channelId)) {
          seen.add(channelId);
          channelIds.push(channelId);
        }
        if (channelIds.length >= maxResults) break;
      }
      if (channelIds.length >= maxResults) break;
    }
  } catch {
    // Return whatever we extracted
  }

  return channelIds;
}

// ---------------------------------------------------------------------------
// Unified channel videos
// ---------------------------------------------------------------------------

/** @internal */
export async function getChannelVideos(
  innertube: InnertubeApi,
  _transport: Transport,
  channelId: string,
  options?: ChannelVideoOptions,
): Promise<ChannelVideo[]> {
  const sort = options?.sort ?? "latest";
  const limit = options?.limit ?? 30;

  if (sort === "popular") {
    return getPopularVideos(innertube, channelId, limit);
  }
  return getLatestVideos(innertube, channelId, limit);
}

// ---------------------------------------------------------------------------
// Recent video IDs from RSS feed
// ---------------------------------------------------------------------------

/** @internal */
export async function getChannelRecentVideoIds(
  transport: Transport,
  channelId: string,
): Promise<string[]> {
  const res = await transport.fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
  );

  if (!res.ok) {
    throw new InnertubeError("PARSE_ERROR", `RSS feed error: ${res.status}`);
  }

  const xml = await res.text();
  const ids: string[] = [];
  const regex = /<yt:videoId>([\w-]+)<\/yt:videoId>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    ids.push(match[1]);
  }

  return ids;
}

// ===========================================================================
// Private helpers
// ===========================================================================

async function getPopularVideos(
  innertube: InnertubeApi,
  channelId: string,
  limit: number,
): Promise<ChannelVideo[]> {
  const tabRes = await innertube.post("browse", {
    context: WEB_CLIENT_CONTEXT,
    browseId: channelId,
    params: "EgZ2aWRlb3PyBgQKAjoA", // "Videos" tab
  });

  if (!tabRes.ok) {
    throw new InnertubeError(
      "PARSE_ERROR",
      `InnerTube browse error: ${tabRes.status} for ${channelId}`,
    );
  }

  const tabData: any = await tabRes.json();
  const popularToken = extractPopularChipToken(tabData);

  if (!popularToken) {
    // Fall back to extracting from initial browse data
    const { videos } = extractBrowseVideos(tabData);
    return videos.slice(0, limit);
  }

  const popRes = await innertube.post("browse", {
    context: WEB_CLIENT_CONTEXT,
    continuation: popularToken,
  });

  if (!popRes.ok) {
    // Fall back to extracting from initial browse data
    const { videos } = extractBrowseVideos(tabData);
    return videos.slice(0, limit);
  }

  const popData: any = await popRes.json();
  const videos = extractVideosFromContinuation(popData);
  return videos.slice(0, limit);
}

async function getLatestVideos(
  innertube: InnertubeApi,
  channelId: string,
  limit: number,
): Promise<ChannelVideo[]> {
  const tabRes = await innertube.post("browse", {
    context: WEB_CLIENT_CONTEXT,
    browseId: channelId,
    params: "EgZ2aWRlb3PyBgQKAjoA",
  });

  if (!tabRes.ok) {
    throw new InnertubeError("PARSE_ERROR", `InnerTube browse error: ${tabRes.status}`);
  }

  const tabData: any = await tabRes.json();
  const { videos, continuationToken } = extractBrowseVideos(tabData);
  const allVideos = [...videos];

  if (allVideos.length >= limit) {
    return allVideos.slice(0, limit);
  }

  const maxPages = Math.ceil(limit / 30);
  let token = continuationToken;
  let page = 1;
  while (token && page < maxPages && allVideos.length < limit) {
    const contRes = await innertube.post("browse", {
      context: WEB_CLIENT_CONTEXT,
      continuation: token,
    });

    if (!contRes.ok) break;

    const contData: any = await contRes.json();
    const result = extractContinuationVideos(contData);
    allVideos.push(...result.videos);
    token = result.continuationToken;
    page++;
  }

  return allVideos.slice(0, limit);
}

async function resolveChannelInnertube(
  innertube: InnertubeApi,
  identifier: { type: "handle" | "id" | "custom"; value: string },
): Promise<Channel | null> {
  let channelId: string;

  if (identifier.type === "id") {
    channelId = identifier.value;
  } else {
    const resolvedId = await resolveUrlToChannelId(innertube, identifier);
    if (!resolvedId) return null;
    channelId = resolvedId;
  }

  const res = await innertube.post("browse", {
    context: WEB_CLIENT_CONTEXT,
    browseId: channelId,
  });

  if (!res.ok) return null;

  const data: any = await res.json();
  return parseChannelBrowseData(channelId, data);
}

async function resolveUrlToChannelId(
  innertube: InnertubeApi,
  identifier: { type: "handle" | "id" | "custom"; value: string },
): Promise<string | null> {
  const urlToResolve = `https://www.youtube.com/@${identifier.value}`;

  const res = await innertube.post("navigation/resolve_url", {
    context: WEB_CLIENT_CONTEXT,
    url: urlToResolve,
  });

  if (!res.ok) {
    if (identifier.type === "custom") {
      for (const prefix of ["/c/", "/user/"]) {
        const fallbackRes = await innertube.post("navigation/resolve_url", {
          context: WEB_CLIENT_CONTEXT,
          url: `https://www.youtube.com${prefix}${identifier.value}`,
        });
        if (fallbackRes.ok) {
          const fallbackData: any = await fallbackRes.json();
          const fallbackId = fallbackData?.endpoint?.browseEndpoint?.browseId as string | undefined;
          if (fallbackId?.startsWith("UC")) return fallbackId;
        }
      }
    }
    return null;
  }

  const data: any = await res.json();
  const browseId = data?.endpoint?.browseEndpoint?.browseId as string | undefined;
  return browseId?.startsWith("UC") ? browseId : null;
}

function parseChannelBrowseData(channelId: string, data: Record<string, unknown>): Channel | null {
  try {
    const metadata = (data?.metadata as Record<string, unknown>) ?? {};
    const channelMetadata = metadata.channelMetadataRenderer as Record<string, unknown> | undefined;

    const name = (channelMetadata?.title as string) ?? "";
    if (!name) return null;

    // Handle from vanityChannelUrl
    let handle: string | null = null;
    const vanityUrl =
      (channelMetadata?.vanityChannelUrl as string) ??
      (channelMetadata?.channelUrl as string) ??
      "";
    const handleMatch = vanityUrl.match(/@([\w.-]+)/);
    if (handleMatch?.[1]) handle = handleMatch[1];

    // Thumbnail from header
    let thumbnail = "";
    const header = (data?.header as Record<string, unknown>) ?? {};

    // Standard channels: c4TabbedHeaderRenderer
    const c4 = header.c4TabbedHeaderRenderer as Record<string, unknown> | undefined;
    if (c4) {
      const avatar = c4.avatar as { thumbnails?: { url?: string }[] } | undefined;
      if (avatar?.thumbnails?.length) {
        const thumbUrl = avatar.thumbnails[avatar.thumbnails.length - 1].url ?? "";
        thumbnail = thumbUrl.startsWith("//") ? `https:${thumbUrl}` : thumbUrl;
      }
    }

    // Newer layout: pageHeaderRenderer
    if (!thumbnail) {
      const pageHeader = header.pageHeaderRenderer as Record<string, unknown> | undefined;
      const content = pageHeader?.content as Record<string, unknown> | undefined;
      const phViewModel = content?.pageHeaderViewModel as Record<string, unknown> | undefined;
      const image = phViewModel?.image as Record<string, unknown> | undefined;
      const decoratedImage = image?.decoratedAvatarViewModel as Record<string, unknown> | undefined;
      const avatarModel = decoratedImage?.avatar as Record<string, unknown> | undefined;
      const avatarImage = avatarModel?.avatarViewModel as Record<string, unknown> | undefined;
      const avatarThumb = avatarImage?.image as Record<string, unknown> | undefined;
      const sources = avatarThumb?.sources as Array<{ url?: string }> | undefined;
      if (sources?.length) {
        const thumbUrl = sources[sources.length - 1].url ?? "";
        thumbnail = thumbUrl.startsWith("//") ? `https:${thumbUrl}` : thumbUrl;
      }
    }

    // Subscriber count
    let subscribers: number | null = null;

    if (c4?.subscriberCountText) {
      const subText = (c4.subscriberCountText as { simpleText?: string }).simpleText;
      subscribers = parseSubscriberText(subText) ?? null;
    }

    if (subscribers === null) {
      const pageHeader = header.pageHeaderRenderer as Record<string, unknown> | undefined;
      if (pageHeader) {
        const content = pageHeader.content as Record<string, unknown> | undefined;
        const phRenderer = content?.pageHeaderViewModel as Record<string, unknown> | undefined;
        const metaRow = phRenderer?.metadata as Record<string, unknown> | undefined;
        const metaRowContent = metaRow?.contentMetadataViewModel as
          | Record<string, unknown>
          | undefined;
        const parts = (metaRowContent?.metadataRows as Array<Record<string, unknown>>) ?? [];
        for (const row of parts) {
          const rowParts = (row.metadataParts as Array<Record<string, unknown>>) ?? [];
          for (const part of rowParts) {
            const textObj = part.text as { content?: string } | undefined;
            const textStr = textObj?.content ?? "";
            if (textStr.includes("subscriber")) {
              subscribers = parseSubscriberText(textStr) ?? null;
            }
          }
        }
      }
    }

    return {
      id: channelId,
      name,
      handle,
      thumbnail,
      subscribers,
      uploadsPlaylistId: toUploadsPlaylistId(channelId),
    };
  } catch {
    return null;
  }
}

function parseSubscriberText(text: string | undefined): number | undefined {
  if (!text || text.startsWith("@")) return undefined;
  return parseAbbreviatedNumber(text) ?? undefined;
}

async function searchChannelsInnertube(
  innertube: InnertubeApi,
  query: string,
): Promise<ChannelResult[]> {
  const res = await innertube.post("search", {
    context: WEB_CLIENT_CONTEXT,
    query,
    params: "EgIQAg==", // filter: channels only
  });

  if (!res.ok) {
    throw new InnertubeError("PARSE_ERROR", `InnerTube search error: ${res.status}`);
  }

  const data: any = await res.json();
  const results: ChannelResult[] = [];
  const MAX_RESULTS = 10;

  try {
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents ?? [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents ?? [];
      for (const item of items) {
        const cr = item?.channelRenderer;
        if (!cr) continue;

        const id = cr.channelId as string | undefined;
        if (!id) continue;

        const name = (cr.title?.simpleText as string | undefined) ?? "Unknown Channel";

        const canonicalUrl = cr.canonicalBaseUrl as string | undefined;
        const handle = canonicalUrl?.startsWith("/@") ? canonicalUrl.slice(2) : null;

        const subText =
          (cr.subscriberCountText as { simpleText?: string })?.simpleText ??
          (
            (cr.subscriberCountText as { runs?: { text?: string }[] })?.runs?.[0]?.text
          ) ??
          (cr.subscriberCountText as { accessibility?: { accessibilityData?: { label?: string } } })
            ?.accessibility?.accessibilityData?.label;

        const thumbnails = (cr.thumbnail?.thumbnails ?? []) as {
          url?: string;
          width?: number;
        }[];
        let thumbnail = "";
        for (const t of thumbnails) {
          if (t.url) {
            thumbnail = t.url.startsWith("//") ? `https:${t.url}` : t.url;
            if (t.width && t.width >= 88) break;
          }
        }

        const subscribers = parseSubscriberText(subText) ?? null;

        results.push({ id, name, handle, thumbnail, subscribers });
        if (results.length >= MAX_RESULTS) break;
      }
      if (results.length >= MAX_RESULTS) break;
    }
  } catch {
    // Return whatever we extracted
  }

  return results;
}

// ---------------------------------------------------------------------------
// Browse helpers
// ---------------------------------------------------------------------------

function extractPopularChipToken(data: Record<string, unknown>): string | null {
  try {
    const tabs = (data?.contents as Record<string, unknown>)
      ?.twoColumnBrowseResultsRenderer as Record<string, unknown>;
    const tabList = (tabs?.tabs as Array<Record<string, unknown>>) ?? [];

    for (const tab of tabList) {
      const tr = tab.tabRenderer as Record<string, unknown> | undefined;
      if (!tr?.content) continue;

      const grid = (tr.content as Record<string, unknown>).richGridRenderer as
        | Record<string, unknown>
        | undefined;
      if (!grid?.header) continue;

      const chipBar = (grid.header as Record<string, unknown>).chipBarViewModel as
        | Record<string, unknown>
        | undefined;
      if (!chipBar?.chips) continue;

      const chips = chipBar.chips as Array<Record<string, unknown>>;
      for (const chip of chips) {
        const cv = chip.chipViewModel as Record<string, unknown> | undefined;
        if (!cv || cv.text !== "Popular") continue;

        const cmd = (cv.tapCommand as Record<string, unknown>)?.innertubeCommand as
          | Record<string, unknown>
          | undefined;
        const contCmd = cmd?.continuationCommand as Record<string, unknown> | undefined;
        if (contCmd?.token) return contCmd.token as string;
      }
    }
  } catch {
    // Extraction failed
  }
  return null;
}

function extractVideosFromContinuation(data: Record<string, unknown>): ChannelVideo[] {
  const videos: ChannelVideo[] = [];
  try {
    const actions = (data.onResponseReceivedActions as Array<Record<string, unknown>>) ?? [];

    for (const action of actions) {
      const reload = action.reloadContinuationItemsCommand as Record<string, unknown> | undefined;
      if (!reload?.continuationItems) continue;

      const items = reload.continuationItems as Array<Record<string, unknown>>;
      for (const item of items) {
        const ri = item.richItemRenderer as Record<string, unknown> | undefined;
        const vr = (ri?.content as Record<string, unknown>)?.videoRenderer as
          | Record<string, unknown>
          | undefined;
        if (vr) {
          const video = extractVideoRendererData(vr);
          if (video) videos.push(video);
        }
      }
    }
  } catch {
    // Defensive
  }
  return videos;
}

function extractVideoRendererData(vr: Record<string, unknown>): ChannelVideo | null {
  const id = vr.videoId as string | undefined;
  if (!id) return null;

  const title =
    ((vr.title as Record<string, unknown>)?.runs as Array<{ text: string }>)?.[0]?.text ??
    (vr.title as Record<string, unknown>)?.simpleText ??
    "";

  const viewCountText =
    ((vr.viewCountText as Record<string, unknown>)?.simpleText as string) ??
    (
      (vr.viewCountText as Record<string, unknown>)?.runs as Array<{ text: string }> | undefined
    )?.[0]?.text ??
    "";
  const views = parseViewCountText(String(viewCountText));

  const durationText = ((vr.lengthText as Record<string, unknown>)?.simpleText as string) ?? "";
  const duration = parseDurationText(durationText);

  const publishedText =
    ((vr.publishedTimeText as Record<string, unknown>)?.simpleText as string) ??
    (
      (vr.publishedTimeText as Record<string, unknown>)?.runs as Array<{ text: string }> | undefined
    )?.[0]?.text ??
    "";

  const thumbnailUrl = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

  return {
    id,
    title: String(title),
    views,
    duration,
    publishedText,
    publishedAt: parseRelativeDate(publishedText),
    thumbnailUrl,
  };
}

function extractBrowseVideos(data: Record<string, unknown>): {
  videos: ChannelVideo[];
  continuationToken: string | null;
} {
  const videos: ChannelVideo[] = [];
  let continuationToken: string | null = null;

  try {
    const tabs =
      ((
        (data?.contents as Record<string, unknown>)?.twoColumnBrowseResultsRenderer as Record<
          string,
          unknown
        >
      )?.tabs as Array<Record<string, unknown>>) ?? [];

    for (const tab of tabs) {
      const tr = tab.tabRenderer as Record<string, unknown> | undefined;
      if (!tr?.content) continue;

      const grid = (tr.content as Record<string, unknown>).richGridRenderer as
        | Record<string, unknown>
        | undefined;
      if (!grid) continue;

      const items = (grid.contents as Array<Record<string, unknown>>) ?? [];
      for (const item of items) {
        const ri = item.richItemRenderer as Record<string, unknown> | undefined;
        if (ri) {
          const vr = (ri.content as Record<string, unknown>)?.videoRenderer as
            | Record<string, unknown>
            | undefined;
          if (vr) {
            const video = extractVideoRendererData(vr);
            if (video) videos.push(video);
          }
        }

        const contItem = item.continuationItemRenderer as Record<string, unknown> | undefined;
        if (contItem) {
          const endpoint = contItem.continuationEndpoint as Record<string, unknown> | undefined;
          const contCmd = endpoint?.continuationCommand as Record<string, unknown> | undefined;
          if (contCmd?.token) continuationToken = contCmd.token as string;
        }
      }
    }
  } catch {
    // Defensive
  }

  return { videos, continuationToken };
}

function extractContinuationVideos(data: Record<string, unknown>): {
  videos: ChannelVideo[];
  continuationToken: string | null;
} {
  const videos: ChannelVideo[] = [];
  let continuationToken: string | null = null;

  try {
    const actions = (data.onResponseReceivedActions as Array<Record<string, unknown>>) ?? [];

    for (const action of actions) {
      const append = action.appendContinuationItemsAction as Record<string, unknown> | undefined;
      if (!append?.continuationItems) continue;

      const items = append.continuationItems as Array<Record<string, unknown>>;
      for (const item of items) {
        const ri = item.richItemRenderer as Record<string, unknown> | undefined;
        if (ri) {
          const vr = (ri.content as Record<string, unknown>)?.videoRenderer as
            | Record<string, unknown>
            | undefined;
          if (vr) {
            const video = extractVideoRendererData(vr);
            if (video) videos.push(video);
          }
        }

        const contItem = item.continuationItemRenderer as Record<string, unknown> | undefined;
        if (contItem) {
          const endpoint = contItem.continuationEndpoint as Record<string, unknown> | undefined;
          const contCmd = endpoint?.continuationCommand as Record<string, unknown> | undefined;
          if (contCmd?.token) continuationToken = contCmd.token as string;
        }
      }
    }
  } catch {
    // Defensive
  }

  return { videos, continuationToken };
}

// ---------------------------------------------------------------------------
// Relative date parsing
// ---------------------------------------------------------------------------

const RELATIVE_DATE_REGEX = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000, // ~30 days
  year: 31_536_000_000, // ~365 days
};

function parseRelativeDate(text: string): Date | null {
  const match = text.match(RELATIVE_DATE_REGEX);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = UNIT_MS[unit];
  if (!ms) return null;
  return new Date(Date.now() - amount * ms);
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseViewCountText(text: string): number | null {
  if (!text) return null;
  return parseAbbreviatedNumber(text.replace(/\s*views?\s*$/i, "").trim());
}

function parseDurationText(text: string): number | null {
  if (!text) return null;
  const parts = text.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

