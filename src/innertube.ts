import { Transport } from "./transport.js";
import { InnertubeError } from "./types.js";

// ---------------------------------------------------------------------------
// InnerTube client contexts — different YouTube clients expose different data
// ---------------------------------------------------------------------------

export const WEB_CLIENT_CONTEXT = {
  client: { clientName: "WEB", clientVersion: "2.20240101.00.00" },
} as const;

export const ANDROID_CLIENT_CONTEXT = {
  client: { clientName: "ANDROID", clientVersion: "20.10.38" },
} as const;

// ---------------------------------------------------------------------------
// API key cache (in-memory only)
// ---------------------------------------------------------------------------

class MemoryCache {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// InnertubeApi — manages the API key lifecycle and provides authenticated POST
// ---------------------------------------------------------------------------

/**
 * Core InnerTube API layer. Handles:
 * - API key scraping from YouTube homepage
 * - In-memory key caching
 * - Automatic key rotation on 400 invalid-key responses
 * - Authenticated POST to InnerTube v1 endpoints
 */
export class InnertubeApi {
  private key: string | null = null;
  private keyPromise: Promise<string> | null = null;
  private readonly transport: Transport;
  private readonly cache = new MemoryCache();

  private static readonly CACHE_KEY = "innertube:innertube_api_key";

  constructor(transport: Transport) {
    this.transport = transport;
  }

  /** Get the current InnerTube API key, scraping it if necessary. */
  async getApiKey(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      if (this.key) return this.key;
      if (this.keyPromise) return this.keyPromise;
    } else {
      this.key = null;
      this.keyPromise = null;
    }

    this.keyPromise = this.fetchAndStoreKey(forceRefresh);
    return this.keyPromise;
  }

  /**
   * POST to an InnerTube v1 endpoint with automatic key rotation.
   *
   * If the response is HTTP 400 with a key-invalid body, the cached key is
   * evicted, a fresh one is scraped, and the request is retried exactly once.
   */
  async post(path: string, body: object, extraHeaders?: Record<string, string>): Promise<Response> {
    const request = (apiKey: string) =>
      this.transport.fetch(`https://www.youtube.com/youtubei/v1/${path}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      });

    const apiKey = await this.getApiKey();
    const res = await request(apiKey);

    if (res.status === 400) {
      const text = await res.text();
      if (isKeyInvalidResponse(text)) {
        const freshKey = await this.getApiKey(true);
        return request(freshKey);
      }
    }

    return res;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async fetchAndStoreKey(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh) {
      const cached = await this.cache.get(InnertubeApi.CACHE_KEY);
      if (cached) {
        this.key = cached;
        return cached;
      }
    }

    const res = await this.transport.fetch("https://www.youtube.com", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      throw new InnertubeError(
        "API_KEY_INVALID",
        `Failed to fetch YouTube homepage: ${res.status}`,
      );
    }

    const html = await res.text();
    const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    if (!match?.[1]) {
      throw new InnertubeError(
        "API_KEY_INVALID",
        "Could not extract INNERTUBE_API_KEY from YouTube homepage",
      );
    }

    this.key = match[1];
    // No TTL — key is stable. Invalidated reactively via post().
    await this.cache.set(InnertubeApi.CACHE_KEY, match[1]);
    return match[1];
  }
}

function isKeyInvalidResponse(body: string): boolean {
  return (
    body.includes("API_KEY_INVALID") ||
    body.includes("API key not valid") ||
    body.includes("keyInvalid") ||
    body.includes("keyExpired")
  );
}
