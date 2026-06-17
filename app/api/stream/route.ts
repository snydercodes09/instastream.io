import { NextRequest, NextResponse } from "next/server";

import {
  assertMediaLikeSource,
  MediaProbeResult,
  MediaValidationError,
  normalizeMediaUrl,
} from "@/utils/mediaUrl";
import { SimpleLRUCache } from "@/utils/lruCache";
import { fetchUpstreamWithRedirects } from "@/utils/upstreamFetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const validationCache = new SimpleLRUCache<string, Promise<MediaProbeResult>>(100);

type ErrorBody = {
  code: string;
  message: string;
  sourceUrl?: string;
  normalizedUrl?: string;
};

function jsonError(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const sourceUrl = req.nextUrl.searchParams.get("url");
  if (!sourceUrl) {
    return jsonError(400, {
      code: "MISSING_URL",
      message: "Missing required \"url\" query parameter.",
    });
  }

  let normalizedUrl = "";
  try {
    normalizedUrl = normalizeMediaUrl(sourceUrl).normalizedUrl;
  } catch (error: unknown) {
    if (error instanceof MediaValidationError) {
      return jsonError(error.status, {
        code: error.code,
        message: error.message,
        sourceUrl,
      });
    }
    return jsonError(400, {
      code: "INVALID_URL",
      message: "Invalid source URL.",
      sourceUrl,
    });
  }

  try {
    let validationPromise = validationCache.get(normalizedUrl);
    if (!validationPromise) {
      validationPromise = assertMediaLikeSource(normalizedUrl, { timeoutMs: 10_000 });
      validationPromise.catch(() => validationCache.delete(normalizedUrl));
      validationCache.set(normalizedUrl, validationPromise);
    }
    await validationPromise;
  } catch (error: unknown) {
    if (error instanceof MediaValidationError) {
      return jsonError(error.status, {
        code: error.code,
        message: error.message,
        sourceUrl,
        normalizedUrl,
      });
    }
    return jsonError(502, {
      code: "UPSTREAM_UNAVAILABLE",
      message: "Failed to validate upstream media source.",
      sourceUrl,
      normalizedUrl,
    });
  }

  const range = req.headers.get("range");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    const onAbort = () => controller.abort();
    req.signal.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetchUpstreamWithRedirects(normalizedUrl, {
        method: "GET",
        range,
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        return jsonError(502, {
          code: "UPSTREAM_BAD_RESPONSE",
          message: `Upstream responded with ${response.status} ${response.statusText}.`,
          sourceUrl,
          normalizedUrl,
        });
      }

      const headers = new Headers();
      const allowedHeaders = [
        "content-range",
        "content-length",
        "content-type",
        "accept-ranges",
        "content-encoding",
        "content-disposition",
        "cache-control",
        "etag",
        "last-modified",
      ];

      response.headers.forEach((value, key) => {
        if (allowedHeaders.includes(key.toLowerCase())) {
          headers.set(key, value);
        }
      });

      if (!headers.has("Accept-Ranges")) {
        headers.set("Accept-Ranges", "bytes");
      }

      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Cache-Control", "no-store");

      return new NextResponse(response.body, {
        status: response.status,
        headers,
      });
    } catch (fetchError: unknown) {
      if (
        (fetchError instanceof DOMException && fetchError.name === "AbortError") ||
        (fetchError instanceof Error && fetchError.name === "AbortError")
      ) {
        return jsonError(504, {
          code: "UPSTREAM_TIMEOUT",
          message: "Timed out while requesting upstream media.",
          sourceUrl,
          normalizedUrl,
        });
      }

      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
      req.signal.removeEventListener("abort", onAbort);
    }
  } catch (error: unknown) {
    return jsonError(500, {
      code: "STREAM_PROXY_ERROR",
      message: error instanceof Error ? error.message : "Unexpected proxy error.",
      sourceUrl,
      normalizedUrl,
    });
  }
}
