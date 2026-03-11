import { InnertubeError } from "./types.js";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * HTTP transport layer. Wraps globalThis.fetch with automatic timeout
 * via AbortController.
 */
export class Transport {
  private readonly timeoutMs: number;

  constructor(config: { timeout?: number }) {
    this.timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
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
      const res = await globalThis.fetch(url, { ...init, signal: controller.signal });
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
