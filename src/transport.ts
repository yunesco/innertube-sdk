import { InnertubeError } from "./types.js";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * HTTP transport layer. Wraps fetch with automatic timeout via AbortController.
 * Uses custom fetch when provided (e.g. for proxy/IP rotation), otherwise global fetch.
 */
export class Transport {
  private readonly timeoutMs: number;
  private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(config: { timeout?: number; fetch?: (url: string, init?: RequestInit) => Promise<Response> }) {
    this.timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  /** Send an HTTP request. */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    return this.directFetch(url, init);
  }

  /** No-op. Kept for API compatibility. */
  destroy(): void {}

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async directFetch(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);

      const isTimeout = err instanceof Error && err.name === "AbortError";
      const msg = err instanceof Error ? err.message : String(err);

      throw new InnertubeError(
        isTimeout ? "TIMEOUT" : "TRANSPORT_ERROR",
        `Request failed: ${msg}`,
        {
          cause: err,
        },
      );
    }
  }
}
