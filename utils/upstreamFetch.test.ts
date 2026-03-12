import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { fetchUpstreamWithRedirects, DEFAULT_UPSTREAM_USER_AGENT } from "./upstreamFetch";

describe("fetchUpstreamWithRedirects", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mock();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("should return 200 OK response directly", async () => {
    const mockFetch = mock(async () => {
      return new Response("ok", { status: 200 });
    });
    global.fetch = mockFetch;

    const response = await fetchUpstreamWithRedirects("http://source.com/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("should follow a single 302 redirect", async () => {
    const mockFetch = mock(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "http://source.com/") {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://dest.com/" },
        });
      }
      if (url === "http://dest.com/") {
        return new Response("ok", { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });
    global.fetch = mockFetch;

    const response = await fetchUpstreamWithRedirects("http://source.com/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("should follow multiple redirects", async () => {
    const mockFetch = mock(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "http://source.com/") {
        return new Response(null, { status: 301, headers: { Location: "http://mid.com/" } });
      }
      if (url === "http://mid.com/") {
        return new Response(null, { status: 302, headers: { Location: "http://dest.com/" } });
      }
      if (url === "http://dest.com/") {
        return new Response("final", { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });
    global.fetch = mockFetch;

    const response = await fetchUpstreamWithRedirects("http://source.com/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("final");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test("should throw error when max redirects exceeded", async () => {
    const mockFetch = mock(async () => {
      return new Response(null, { status: 302, headers: { Location: "http://next.com/" } });
    });
    global.fetch = mockFetch;

    // Use try-catch to verify error message as bun:test sometimes behaves differently with async rejects
    try {
        await fetchUpstreamWithRedirects("http://source.com/", { maxRedirects: 1 });
        throw new Error("Should have thrown");
    } catch (e: any) {
        expect(e.message).toBe("Too many upstream redirects.");
    }
  });

  test("should throw error for unsupported protocol in redirect", async () => {
    const mockFetch = mock(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "http://source.com/") {
        return new Response(null, { status: 302, headers: { Location: "ftp://dest.com/" } });
      }
      return new Response("ok", { status: 200 });
    });
    global.fetch = mockFetch;

    try {
        await fetchUpstreamWithRedirects("http://source.com/");
        throw new Error("Should have thrown");
    } catch (e: any) {
        expect(e.message).toBe("Upstream redirect location is unsafe or unsupported.");
    }
  });

  test("should return 3xx response if location header is missing", async () => {
    const mockFetch = mock(async () => {
      return new Response(null, { status: 302 });
    });
    global.fetch = mockFetch;

    const response = await fetchUpstreamWithRedirects("http://source.com/");
    expect(response.status).toBe(302);
  });

  test("should throw error for invalid redirect location", async () => {
    // Construct a case where new URL() throws.
    // This is tricky because URL parser is quite robust.
    // However, if we return a relative URL but the base is not provided (which is not the case here, base is currentUrl),
    // Or if the location is garbage like "http://:invalid".

    const mockFetch = mock(async (input: RequestInfo | URL) => {
        if (input.toString() === "http://source.com/") {
             return new Response(null, { status: 302, headers: { Location: "http://:invalid" } });
        }
        return new Response("ok", { status: 200 });
    });
    global.fetch = mockFetch;

    try {
        await fetchUpstreamWithRedirects("http://source.com/");
        throw new Error("Should have thrown");
    } catch (e: any) {
        // Depending on the URL parser, it might throw a TypeError from new URL() first
        // But our code catches it and rethrows "Upstream redirect location is invalid."
        // Wait, if "http://:invalid" is valid for URL parser but invalid protocol, then it might fail next check.
        // Let's rely on the code block:
        /*
            try {
              nextUrl = new URL(location, currentUrl).toString();
            } catch {
              throw new Error("Upstream redirect location is invalid.");
            }
        */
        // We need `new URL()` to throw.
        expect(e.message).toBe("Upstream redirect location is invalid.");
    }
  });

  test("should throw error for initial unsupported protocol", async () => {
    try {
        await fetchUpstreamWithRedirects("ftp://source.com/");
        throw new Error("Should have thrown");
    } catch (e: any) {
        expect(e.message).toBe("Only public HTTP(S) upstream URLs are supported.");
    }
  });

  test("should send correct headers", async () => {
    const mockFetch = mock(async () => {
      return new Response("ok", { status: 200 });
    });
    global.fetch = mockFetch;

    await fetchUpstreamWithRedirects("http://source.com/", { range: "bytes=0-100" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://source.com/");

    // options is RequestInit, headers can be Headers object or plain object
    const headers = options?.headers as Headers;
    expect(headers.get("User-Agent")).toBe(DEFAULT_UPSTREAM_USER_AGENT);
    expect(headers.get("Range")).toBe("bytes=0-100");
    expect(headers.get("Referer")).toBe("http://source.com/");
  });
});
