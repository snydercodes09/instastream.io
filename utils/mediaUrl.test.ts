import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockFetchUpstream = mock();

mock.module("@/utils/upstreamFetch", () => {
  return {
    fetchUpstreamWithRedirects: mockFetchUpstream
  };
});

import { assertMediaLikeSource, MediaValidationError, clearMediaValidationCache } from "./mediaUrl";

describe("assertMediaLikeSource", () => {
  beforeEach(() => {
    mockFetchUpstream.mockReset();
    clearMediaValidationCache();
  });

  it("should return valid probe result for media content", async () => {
    mockFetchUpstream.mockResolvedValue(new Response(new Uint8Array([0x00, 0x01, 0x02]), {
      headers: {
        "content-type": "video/mp4",
        "content-length": "1024",
        "accept-ranges": "bytes",
      },
    }));

    const result = await assertMediaLikeSource("http://example.com/video.mp4");

    expect(result).toEqual({
      contentType: "video/mp4",
      contentLength: 1024,
      acceptRanges: "bytes",
    });
    expect(mockFetchUpstream).toHaveBeenCalledTimes(1);
    expect(mockFetchUpstream.mock.calls[0][0]).toBe("http://example.com/video.mp4");

    // Check signal is passed
    const options = mockFetchUpstream.mock.calls[0][1];
    expect(options.signal).toBeDefined();
  });

  it("should cache successful probes", async () => {
    mockFetchUpstream.mockResolvedValue(new Response(new Uint8Array([0x00, 0x01, 0x02]), {
      headers: {
        "content-type": "video/mp4",
        "content-length": "1024",
        "accept-ranges": "bytes",
      },
    }));

    const result1 = await assertMediaLikeSource("http://example.com/cached.mp4");
    const result2 = await assertMediaLikeSource("http://example.com/cached.mp4");

    expect(result1).toEqual(result2);
    // Fetch should only be called once due to caching
    expect(mockFetchUpstream).toHaveBeenCalledTimes(1);
  });

  it("should throw UPSTREAM_UNAVAILABLE if response is not ok", async () => {
    mockFetchUpstream.mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));

    try {
      await assertMediaLikeSource("http://example.com/missing.mp4");
      throw new Error("Expected to throw MediaValidationError");
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "Expected to throw MediaValidationError") throw error;
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe("UPSTREAM_UNAVAILABLE");
        expect((error as MediaValidationError).status).toBe(502);
    }
  });

  it("should throw SOURCE_NOT_MEDIA for empty response", async () => {
    mockFetchUpstream.mockResolvedValue(new Response(new Uint8Array([]), {
       headers: { "content-length": "0" }
    }));

    try {
      await assertMediaLikeSource("http://example.com/empty");
      throw new Error("Expected to throw MediaValidationError");
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "Expected to throw MediaValidationError") throw error;
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe("SOURCE_NOT_MEDIA");
    }
  });

  it("should throw SOURCE_NOT_MEDIA for HTML content type", async () => {
    mockFetchUpstream.mockResolvedValue(new Response("<html></html>", {
      headers: { "content-type": "text/html" }
    }));

    try {
      await assertMediaLikeSource("http://example.com/page.html");
      throw new Error("Expected to throw MediaValidationError");
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "Expected to throw MediaValidationError") throw error;
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe("SOURCE_NOT_MEDIA");
    }
  });

  it("should throw SOURCE_NOT_MEDIA for HTML content body", async () => {
     // Content type is binary but content is HTML
    mockFetchUpstream.mockResolvedValue(new Response("<!doctype html><html>...</html>", {
      headers: { "content-type": "application/octet-stream" }
    }));

    try {
      await assertMediaLikeSource("http://example.com/fake.bin");
      throw new Error("Expected to throw MediaValidationError");
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "Expected to throw MediaValidationError") throw error;
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe("SOURCE_NOT_MEDIA");
    }
  });

  it("should throw UPSTREAM_TIMEOUT on AbortError", async () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    mockFetchUpstream.mockRejectedValue(error);

    try {
      await assertMediaLikeSource("http://example.com/timeout");
      throw new Error("Expected to throw MediaValidationError");
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "Expected to throw MediaValidationError") throw error;
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe("UPSTREAM_TIMEOUT");
    }
  });

  it("should throw UPSTREAM_UNAVAILABLE on generic network error", async () => {
    mockFetchUpstream.mockRejectedValue(new Error("Network failure"));

    try {
      await assertMediaLikeSource("http://example.com/error");
      throw new Error("Expected to throw MediaValidationError");
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "Expected to throw MediaValidationError") throw error;
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe("UPSTREAM_UNAVAILABLE");
    }
  });
});
