#!/usr/bin/env node
/** Test every route in innertube-sdk */
import { innertube } from "./dist/index.js";

const VIDEO = "https://www.youtube.com/watch?v=nU-oOlqvl6Q";
const yt = innertube();

function inspect(label, data) {
  console.log("\n" + "=".repeat(60));
  console.log("ROUTE:", label);
  console.log("=".repeat(60));
  if (data instanceof Map) {
    console.log(JSON.stringify(Object.fromEntries(data), null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function run() {
  try {
    // 1. getVideo
    const video = await yt.getVideo(VIDEO);
    inspect("getVideo (full details)", {
      id: video.id,
      title: video.title,
      views: video.views,
      likes: video.likes,
      commentCount: video.commentCount,
      duration: video.duration,
      channel: video.channel,
      hasChapters: !!video.chapters?.length,
      hasHeatmap: !!video.heatmap,
      hasMostReplayed: !!video.mostReplayed,
      relatedCount: video.related?.length ?? 0,
      captionTracksCount: video.captionTracks?.length ?? 0,
    });

    // 2. getVideos (batch)
    const videos = await yt.getVideos([VIDEO, "dQw4w9WgXcQ"]);
    inspect("getVideos (batch metadata)", Object.fromEntries(videos));

    // 3. getTranscript
    const transcript = await yt.getTranscript(VIDEO);
    inspect("getTranscript", {
      textLength: transcript.text?.length ?? 0,
      segmentsCount: transcript.segments?.length ?? 0,
      sampleSegment: transcript.segments?.[0],
      textPreview: transcript.text?.slice(0, 200) + "...",
    });

    // 4. getComments
    const comments = await yt.getComments(VIDEO, { limit: 5 });
    inspect("getComments (limit 5)", comments);

    // 5. getChannel (by ID and by handle)
    const channel = await yt.getChannel(video.channel.id);
    inspect("getChannel (by ID)", channel);

    const channelByHandle = await yt.getChannel("@ThinkBigAnimation");
    inspect("getChannel (by @handle)", channelByHandle);

    // 6. getChannelVideos
    const channelVideos = await yt.getChannelVideos(channel.id, { limit: 3, sort: "latest" });
    inspect("getChannelVideos (latest, limit 3)", channelVideos);

    const popularVideos = await yt.getChannelVideos(channel.id, { limit: 3, sort: "popular" });
    inspect("getChannelVideos (popular, limit 3)", popularVideos);

    // 7. findChannelsByTopic
    const topicChannels = await yt.findChannelsByTopic("comedy standup", 5);
    inspect("findChannelsByTopic('comedy standup', 5)", topicChannels);

    // 8. search (videos)
    const searchResults = await yt.search("Patrice O'Neal comedy", { limit: 5 });
    inspect("search (videos)", searchResults);

    // 9. searchChannels
    const channelSearch = await yt.searchChannels("comedy channel", { limit: 5 });
    inspect("searchChannels", channelSearch);

    console.log("\n" + "=".repeat(60));
    console.log("ALL ROUTES PASSED");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("FAILED:", err);
    process.exit(1);
  } finally {
    yt.destroy();
  }
}

run();
