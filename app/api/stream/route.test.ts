import { describe, expect, test, mock, beforeEach } from "bun:test";

// --- Mocks ---

// Mock MediaValidationError class
class MediaValidationError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MediaValidationError";
    this.code = code;
    this.status = status;
  }
}

// Mock functions
const mockNormalizeMediaUrl = mock();
const mockAssertMediaLikeSource = mock();
const mockFetchUpstreamWithRedirects = mock();

// Mock Modules
mock.module("@/utils/mediaUrl", () => ({
  normalizeMediaUrl: mockNormalizeMediaUrl,
  assertMediaLikeSource: mockAssertMediaLikeSource,
  MediaValidationError: MediaValidationError,
}));

mock.module("@/utils/upstreamFetch", () => ({
  fetchUpstreamWithRedirects: mockFetchUpstreamWithRedirects,
}));

// Mock NextRequest and NextResponse
class NextRequest extends Request {
  nextUrl: URL;
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    // If input is a string, use it. If it's a Request, use its URL.
    const urlStr = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    this.nextUrl = new URL(urlStr, "http://localhost"); // Ensure base URL for relative paths if any
  }
}

class NextResponse extends Response {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static json(body: any, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), {
      ...init,
      headers: {
        ...init?.headers,
        "content-type": "application/json",
      },
    });
  }
}

mock.module("next/server", () => ({
  NextRequest,
  NextResponse,
}));

// Import the handler dynamically to apply mocks
const { GET, _validationCache } = await import("./route");

// --- Tests ---

describe("GET /api/stream", () => {
  beforeEach(() => {
    mockNormalizeMediaUrl.mockReset();
    mockAssertMediaLikeSource.mockReset();
    mockFetchUpstreamWithRedirects.mockReset();
    _validationCache.clear();
  });

  test("returns 400 if url param is missing", async () => {
    const req = new NextRequest("http://localhost/api/stream");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      code: "MISSING_URL",
      message: 'Missing required "url" query parameter.',
    });
  });

  test("returns 400 if normalizeMediaUrl throws MediaValidationError", async () => {
    mockNormalizeMediaUrl.mockImplementation(() => {
      throw new MediaValidationError("INVALID_URL", "Invalid URL", 400);
    });

    const req = new NextRequest("http://localhost/api/stream?url=invalid");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_URL");
  });

  test("returns 400 if normalizeMediaUrl throws generic Error", async () => {
    mockNormalizeMediaUrl.mockImplementation(() => {
      throw new Error("Some error");
    });

    const req = new NextRequest("http://localhost/api/stream?url=invalid");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_URL");
  });

  test("returns error status if assertMediaLikeSource throws MediaValidationError", async () => {
    const normalizedUrl = "http://example.com/video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockImplementation(() => {
        throw new MediaValidationError("UPSTREAM_TIMEOUT", "Timeout", 504);
    });

    const req = new NextRequest("http://localhost/api/stream?url=http://example.com/video.mp4");
    const res = await GET(req);
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_TIMEOUT");
  });

  test("returns 502 if assertMediaLikeSource throws generic Error", async () => {
    const normalizedUrl = "http://example.com/video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockImplementation(() => {
        throw new Error("Connection failed");
    });

    const req = new NextRequest("http://localhost/api/stream?url=http://example.com/video.mp4");
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  test("returns 502 if upstream response is not ok", async () => {
    const normalizedUrl = "http://example.com/video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockResolvedValue({});
    mockFetchUpstreamWithRedirects.mockResolvedValue(new Response("Not Found", { status: 404, statusText: "Not Found" }));

    const req = new NextRequest("http://localhost/api/stream?url=http://example.com/video.mp4");
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_BAD_RESPONSE");
  });

  test("returns 504 if upstream fetch times out (AbortError)", async () => {
    const normalizedUrl = "http://example.com/video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockResolvedValue({});
    mockFetchUpstreamWithRedirects.mockImplementation(() => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
    });

    const req = new NextRequest("http://localhost/api/stream?url=http://example.com/video.mp4");
    const res = await GET(req);
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_TIMEOUT");
  });

  test("returns 200 and proxies headers on success", async () => {
    const normalizedUrl = "http://example.com/video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockResolvedValue({});

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Content-Type", "video/mp4");
    upstreamHeaders.set("Content-Length", "1024");
    upstreamHeaders.set("Accept-Ranges", "bytes");

    mockFetchUpstreamWithRedirects.mockResolvedValue(new Response("video data", {
        status: 200,
        headers: upstreamHeaders
    }));

    const req = new NextRequest("http://localhost/api/stream?url=http://example.com/video.mp4");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Length")).toBe("1024");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const text = await res.text();
    expect(text).toBe("video data");
  });

    test("handles Range header correctly", async () => {
    const normalizedUrl = "http://example.com/video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockResolvedValue({});

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Content-Range", "bytes 0-10/100");
    upstreamHeaders.set("Content-Length", "11");

    mockFetchUpstreamWithRedirects.mockResolvedValue(new Response("partial content", {
        status: 206,
        headers: upstreamHeaders
    }));

    const req = new NextRequest("http://localhost/api/stream?url=http://example.com/video.mp4", {
        headers: { "Range": "bytes=0-10" }
    });

    const res = await GET(req);

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-10/100");

    // check if fetchUpstreamWithRedirects was called with range
    expect(mockFetchUpstreamWithRedirects).toHaveBeenCalled();
    const args = mockFetchUpstreamWithRedirects.mock.calls[0];
    expect(args[1].range).toBe("bytes=0-10");
  });

  test("caches assertMediaLikeSource result for subsequent requests", async () => {
    const normalizedUrl = "http://example.com/cached-video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockResolvedValue({});

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Content-Type", "video/mp4");
    mockFetchUpstreamWithRedirects.mockImplementation(() => {
      return Promise.resolve(new Response("data", { status: 200, headers: upstreamHeaders }));
    });

    const req1 = new NextRequest(`http://localhost/api/stream?url=${normalizedUrl}`);
    const res1 = await GET(req1);
    expect(res1.status).toBe(200);

    const req2 = new NextRequest(`http://localhost/api/stream?url=${normalizedUrl}`);
    const res2 = await GET(req2);
    expect(res2.status).toBe(200);

    // Should only be called once due to caching
    expect(mockAssertMediaLikeSource).toHaveBeenCalledTimes(1);
  });

  test("removes from cache on validation error", async () => {
    const normalizedUrl = "http://example.com/error-video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });

    // First call fails
    mockAssertMediaLikeSource.mockRejectedValueOnce(new MediaValidationError("UPSTREAM_TIMEOUT", "Timeout", 504));

    const req1 = new NextRequest(`http://localhost/api/stream?url=${normalizedUrl}`);
    const res1 = await GET(req1);
    expect(res1.status).toBe(504);

    // Second call succeeds (should retry)
    mockAssertMediaLikeSource.mockResolvedValueOnce({});
    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Content-Type", "video/mp4");
    mockFetchUpstreamWithRedirects.mockResolvedValue(new Response("data", { status: 200, headers: upstreamHeaders }));

    const req2 = new NextRequest(`http://localhost/api/stream?url=${normalizedUrl}`);
    const res2 = await GET(req2);
    expect(res2.status).toBe(200);

    // Should be called twice because the first one failed and was evicted
    expect(mockAssertMediaLikeSource).toHaveBeenCalledTimes(2);
  });
});
