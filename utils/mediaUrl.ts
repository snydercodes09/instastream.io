import { fetchUpstreamWithRedirects } from "@/utils/upstreamFetch";

const WRAPPER_HOSTS = new Set(["video-seed.dev", "www.video-seed.dev"]);
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const PROBE_RANGE = "bytes=0-1023";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500;

interface CachedProbeResult {
  result: MediaProbeResult;
  timestamp: number;
}

const probeCache = new Map<string, CachedProbeResult>();

export function clearMediaValidationCache() {
  probeCache.clear();
}

export type MediaValidationErrorCode =
  | "INVALID_URL"
  | "WRAPPER_URL_MISSING_INNER_URL"
  | "SOURCE_NOT_MEDIA"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE";

export interface MediaProbeResult {
  contentType: string | null;
  contentLength: number | null;
  acceptRanges: string | null;
}

export interface NormalizeMediaUrlResult {
  normalizedUrl: string;
  wasWrapped: boolean;
  wrapperHost?: string;
}

export interface AssertMediaLikeSourceOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class MediaValidationError extends Error {
  code: MediaValidationErrorCode;
  status: number;

  constructor(code: MediaValidationErrorCode, message: string, status: number) {
    super(message);
    this.name = "MediaValidationError";
    this.code = code;
    this.status = status;
  }
}

function parseContentLength(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function createTimedSignal(timeoutMs: number, upstream?: AbortSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  upstream?.addEventListener("abort", onAbort, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      upstream?.removeEventListener("abort", onAbort);
    },
  };
}

function looksLikeHtml(contentType: string | null, sampleBytes: Uint8Array): boolean {
  const type = (contentType ?? "").toLowerCase();
  const htmlType =
    type.includes("text/html") ||
    type.includes("application/xhtml+xml") ||
    type.includes("text/plain");

  let sample = "";
  if (sampleBytes.length > 0) {
    sample = new TextDecoder().decode(sampleBytes).trimStart().toLowerCase();
  }

  const htmlBody =
    sample.startsWith("<!doctype html") ||
    sample.startsWith("<html") ||
    sample.includes("<head") ||
    sample.includes("<body");

  return htmlType || htmlBody;
}

async function readSampleBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;

      const remaining = maxBytes - total;
      const slice = value.subarray(0, Math.min(value.length, remaining));
      chunks.push(slice);
      total += slice.length;

      if (slice.length < value.length) break;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

export function normalizeMediaUrl(raw: string): NormalizeMediaUrlResult {
  let outer: URL;
  try {
    outer = new URL(raw);
  } catch {
    throw new MediaValidationError(
      "INVALID_URL",
      "Invalid URL in \"url\" query parameter.",
      400,
    );
  }

  const host = outer.hostname.toLowerCase();
  if (!WRAPPER_HOSTS.has(host)) {
    if (outer.protocol !== "http:" && outer.protocol !== "https:") {
      throw new MediaValidationError(
        "INVALID_URL",
        "Only HTTP and HTTPS protocols are supported.",
        400,
      );
    }
    return {
      normalizedUrl: outer.toString(),
      wasWrapped: false,
    };
  }

  const innerUrlRaw = outer.searchParams.get("url");
  if (!innerUrlRaw) {
    throw new MediaValidationError(
      "WRAPPER_URL_MISSING_INNER_URL",
      "Wrapper URL is missing the required \"url\" parameter.",
      400,
    );
  }

  const decodedInner = decodeMaybe(innerUrlRaw);
  let inner: URL;
  try {
    inner = new URL(decodedInner);
  } catch {
    throw new MediaValidationError(
      "INVALID_URL",
      "The wrapper \"url\" parameter is not a valid absolute URL.",
      400,
    );
  }

  if (inner.protocol !== "http:" && inner.protocol !== "https:") {
    throw new MediaValidationError(
      "INVALID_URL",
      "Only HTTP and HTTPS protocols are supported for the wrapped URL.",
      400,
    );
  }

  return {
    normalizedUrl: inner.toString(),
    wasWrapped: true,
    wrapperHost: host,
  };
}

export async function assertMediaLikeSource(
  url: string,
  options: AssertMediaLikeSourceOptions = {},
): Promise<MediaProbeResult> {
  const now = Date.now();
  const cached = probeCache.get(url);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const { signal, cleanup } = createTimedSignal(timeoutMs, options.signal);

  try {
    const response = await fetchUpstreamWithRedirects(url, {
      method: "GET",
      range: PROBE_RANGE,
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new MediaValidationError(
        "UPSTREAM_UNAVAILABLE",
        `Upstream source responded with ${response.status} ${response.statusText}.`,
        502,
      );
    }

    const contentType = response.headers.get("content-type");
    const contentLength = parseContentLength(response.headers.get("content-length"));
    const acceptRanges = response.headers.get("accept-ranges");

    const sampleBytes = await readSampleBytes(response, 512);
    if (sampleBytes.length === 0 && contentLength === 0) {
      throw new MediaValidationError(
        "SOURCE_NOT_MEDIA",
        "Source returned an empty payload and does not look like a media stream.",
        422,
      );
    }

    if (looksLikeHtml(contentType, sampleBytes)) {
      throw new MediaValidationError(
        "SOURCE_NOT_MEDIA",
        "Source resolved to HTML/text instead of media bytes.",
        422,
      );
    }

    const result = {
      contentType,
      contentLength,
      acceptRanges,
    };

    if (probeCache.size >= MAX_CACHE_SIZE) {
      // Very simple FIFO/LRU eviction: remove the first key
      const firstKey = probeCache.keys().next().value;
      if (firstKey) {
        probeCache.delete(firstKey);
      }
    }
    probeCache.set(url, { result, timestamp: Date.now() });

    return result;
  } catch (error: unknown) {
    if (error instanceof MediaValidationError) {
      throw error;
    }

    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new MediaValidationError(
        "UPSTREAM_TIMEOUT",
        "Timed out while probing source media.",
        504,
      );
    }

    throw new MediaValidationError(
      "UPSTREAM_UNAVAILABLE",
      error instanceof Error ? error.message : "Failed to reach source media.",
      502,
    );
  } finally {
    cleanup();
  }
}
