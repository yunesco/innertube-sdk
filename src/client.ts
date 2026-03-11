import * as channelOps from "./channels.js";
import { InnertubeApi } from "./innertube.js";
import * as transcriptOps from "./transcripts.js";
import { Transport } from "./transport.js";
import type {
  Channel,
  ChannelResult,
  ChannelVideo,
  ChannelVideoOptions,
  Comment,
  CommentOptions,
  InnertubeConfig,
  SearchOptions,
  SearchResult,
  Transcript,
  TranscriptOptions,
  VideoDetails,
  VideoSummary,
} from "./types.js";
import * as videoOps from "./videos.js";

/**
 * Create an InnerTube SDK client for accessing YouTube data.
 *
 * @example
 * ```ts
 * import { innertube } from 'innertube-sdk';
 *
 * const yt = innertube();
 * const video = await yt.getVideo('dQw4w9WgXcQ');
 * const channel = await yt.getChannel('@mkbhd');
 * yt.destroy();
 * ```
 */
export function innertube(config: InnertubeConfig = {}) {
  const transport = new Transport({
    timeout: config.timeout,
    fetch: config.fetch,
  });
  const api = new InnertubeApi(transport, { getApiKey: config.getApiKey });

  // Helper: resolve a video ID from URL or bare ID
  const resolveVideoId = (input: string): string => {
    const id = videoOps.parseVideoId(input);
    if (!id) throw new Error(`Invalid video ID or URL: ${input}`);
    return id;
  };

  // Helper: resolve channel ID — fast path for bare UC... IDs
  const resolveChannelId = async (input: string): Promise<string> => {
    const parsed = channelOps.parseChannelHandle(input);
    if (parsed?.type === "id") return parsed.value;
    const channel = await channelOps.resolveChannel(api, input);
    if (!channel) throw new Error(`Could not resolve channel: ${input}`);
    return channel.id;
  };

  return {
    // ----- Videos -----

    /**
     * Get complete details about a video (combines player + engagement data).
     * Accepts a video ID or any YouTube video URL.
     */
    getVideo: (input: string): Promise<VideoDetails> =>
      videoOps.getFullVideoDetails(api, resolveVideoId(input)),

    /**
     * Get lightweight metadata for multiple videos in parallel.
     * Accepts video IDs or URLs. Returns a Map keyed by video ID.
     */
    getVideos: (inputs: string[]): Promise<Map<string, VideoSummary>> =>
      videoOps.getVideoMetadata(api, inputs.map(resolveVideoId)),

    /**
     * Get a video's transcript (clean text + timed segments).
     * Accepts a video ID or URL.
     */
    getTranscript: (input: string, options?: TranscriptOptions): Promise<Transcript> =>
      transcriptOps.getFullTranscript(
        api,
        transport,
        resolveVideoId(input),
        options?.captionTracks,
        options?.language,
      ),

    /**
     * Get comments on a video with automatic pagination.
     * Accepts a video ID or URL.
     */
    getComments: (input: string, options?: CommentOptions): Promise<Comment[]> =>
      videoOps.getVideoCommentsByVideoId(
        api,
        resolveVideoId(input),
        options?.limit,
        options?.continuationToken,
      ),

    // ----- Channels -----

    /**
     * Get channel info. Accepts @handle, channel URL, or UC... ID.
     */
    getChannel: (input: string): Promise<Channel | null> =>
      channelOps.resolveChannel(api, input),

    /**
     * Get a channel's videos. Accepts @handle, URL, or UC... ID.
     */
    getChannelVideos: async (
      input: string,
      options?: ChannelVideoOptions,
    ): Promise<ChannelVideo[]> => {
      const channelId = await resolveChannelId(input);
      return channelOps.getChannelVideos(api, transport, channelId, options);
    },

    /**
     * Find channel IDs by searching videos on a topic.
     * Useful for niche/competitor discovery.
     */
    findChannelsByTopic: (query: string, limit?: number): Promise<string[]> =>
      channelOps.searchVideoChannels(api, query, limit),

    // ----- Search -----

    /**
     * Search YouTube for videos.
     */
    search: (query: string, options?: SearchOptions): Promise<SearchResult[]> =>
      videoOps.searchVideos(api, query, options?.limit),

    /**
     * Search YouTube for channels.
     */
    searchChannels: (query: string, options?: SearchOptions): Promise<ChannelResult[]> =>
      channelOps.searchChannels(api, query, options?.limit),

    // ----- Cleanup -----

    /** Close the proxy connection pool and release resources. */
    destroy: (): void => transport.destroy(),
  };
}

/** The return type of innertube(). */
export type InnertubeClient = ReturnType<typeof innertube>;
