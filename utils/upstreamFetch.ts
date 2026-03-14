import { isSafeUrl } from "@/utils/urlSecurity";

const DEFAULT_MAX_REDIRECTS = 5;

export const DEFAULT_UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function buildUpstreamReferer(sourceUrl: string): string | null {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return null;
  }
}

export interface BuildUpstreamHeadersOptions {
  range?: string | null;
}

export function buildUpstreamHeaders(
  sourceUrl: string,
  options: BuildUpstreamHeadersOptions = {},
): Headers {
  const headers = new Headers();
  headers.set("Accept", "*/*");
  headers.set("Accept-Encoding", "identity");
  headers.set("User-Agent", DEFAULT_UPSTREAM_USER_AGENT);

  const referer = buildUpstreamReferer(sourceUrl);
  if (referer) {
    headers.set("Referer", referer);
  }

  const range = options.range?.trim();
  if (range) {
    headers.set("Range", range);
  }

  return headers;
}

export interface FetchUpstreamWithRedirectsOptions {
  method?: "GET" | "HEAD";
  range?: string | null;
  cache?: RequestCache;
  signal?: AbortSignal;
  maxRedirects?: number;
}

export async function fetchUpstreamWithRedirects(
  sourceUrl: string,
  options: FetchUpstreamWithRedirectsOptions = {},
): Promise<Response> {
  if (!(await isSafeUrl(sourceUrl))) {
    throw new Error("Only public HTTP(S) upstream URLs are supported.");
  }

  const method = options.method ?? "GET";
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = sourceUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      method,
      headers: buildUpstreamHeaders(currentUrl, { range: options.range }),
      cache: options.cache ?? "no-store",
      redirect: "manual",
      signal: options.signal,
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    if (redirectCount === maxRedirects) {
      response.body?.cancel().catch(() => undefined);
      throw new Error("Too many upstream redirects.");
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      response.body?.cancel().catch(() => undefined);
      throw new Error("Upstream redirect location is invalid.");
    }

    if (!(await isSafeUrl(nextUrl))) {
      response.body?.cancel().catch(() => undefined);
      throw new Error("Upstream redirect location is unsafe or unsupported.");
    }

    response.body?.cancel().catch(() => undefined);
    currentUrl = nextUrl;
  }

  throw new Error("Upstream redirect resolution failed.");
}
