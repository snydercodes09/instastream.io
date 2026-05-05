import { describe, expect, test, mock, beforeEach, afterAll } from "bun:test";

// --- Mocks ---

const mockDb = {
  prepare: mock(() => ({
    get: mock(),
    run: mock(() => ({ lastInsertRowid: 1 })),
  })),
};

mock.module("@/db", () => ({
  default: mockDb,
}));

const mockStorageManager = {
  ensureDirectory: mock(() => Promise.resolve()),
  fileExists: mock(() => Promise.resolve(false)),
  generateFilename: mock((url: string) => "video.mp4"),
  getFilePath: mock((filename: string) => `/tmp/${filename}`),
};

mock.module("@/utils/storage", () => ({
  StorageManager: mockStorageManager,
}));

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
    const urlStr = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
    this.nextUrl = new URL(urlStr, "http://localhost");
  }
}

class NextResponse extends Response {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
  }
}

mock.module("next/server", () => ({
  NextRequest,
  NextResponse,
}));

// Import the handler dynamically
const { GET } = await import("./route?t=" + Date.now());

describe("GET /api/download-stream Security Fix Verification", () => {
  beforeEach(() => {
    mockNormalizeMediaUrl.mockReset();
    mockAssertMediaLikeSource.mockReset();
    mockFetchUpstreamWithRedirects.mockReset();
    mockDb.prepare().get.mockReset();
    mockDb.prepare().run.mockReset();
  });

  test("fix: blocks SSRF via normalizeMediaUrl", async () => {
    mockNormalizeMediaUrl.mockImplementation(() => {
        throw new MediaValidationError("INVALID_URL", "Only HTTP and HTTPS protocols are supported.", 400);
    });

    const privateUrl = "file:///etc/passwd";
    const req = new NextRequest(`http://localhost/api/download-stream?url=${encodeURIComponent(privateUrl)}`);

    const res = await GET(req);

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Only HTTP and HTTPS protocols are supported.");
    expect(mockFetchUpstreamWithRedirects).not.toHaveBeenCalled();
  });

  test("fix: blocks SSRF via assertMediaLikeSource (private IP)", async () => {
    const normalizedUrl = "http://127.0.0.1/admin";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockImplementation(() => {
        throw new Error("Only public HTTP(S) upstream URLs are supported.");
    });

    const req = new NextRequest(`http://localhost/api/download-stream?url=${encodeURIComponent(normalizedUrl)}`);

    const res = await GET(req);

    // The current implementation returns 500 for generic errors in setup
    expect(res.status).toBe(500);
    expect(mockFetchUpstreamWithRedirects).not.toHaveBeenCalled();
  });

  test("fix: uses fetchUpstreamWithRedirects which has SSRF protection", async () => {
    const normalizedUrl = "https://example.com/video.mp4";
    mockNormalizeMediaUrl.mockReturnValue({ normalizedUrl });
    mockAssertMediaLikeSource.mockResolvedValue({});

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Content-Type", "video/mp4");

    const mockBody = new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
        }
    });

    mockFetchUpstreamWithRedirects.mockResolvedValue(new Response(mockBody, {
        status: 200,
        headers: upstreamHeaders
    }));

    const req = new NextRequest(`http://localhost/api/download-stream?url=${encodeURIComponent(normalizedUrl)}`);

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockFetchUpstreamWithRedirects).toHaveBeenCalledWith(normalizedUrl, expect.anything());
  });
});
