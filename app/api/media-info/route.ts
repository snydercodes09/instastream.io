import { NextRequest, NextResponse } from 'next/server';
import { probeMedia, MediaProbeResult } from '@/utils/mediaProbe';
import { normalizeMediaUrl, assertMediaLikeSource, MediaValidationError } from '@/utils/mediaUrl';
import { SimpleLRUCache } from '@/utils/lruCache';

export const dynamic = 'force-dynamic';

// Cache expensive ffprobe operations. This also acts as request coalescing
// for concurrent requests to the same URL, which is common on page load.
const probeCache = new SimpleLRUCache<string, Promise<MediaProbeResult>>(50);

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    try {
        const { normalizedUrl } = normalizeMediaUrl(url);

        // Assert that the source is actually media before probing.
        // This also performs SSRF and LFI validation. We must do this for every request
        // because we want to apply the specific request's abort signal to the fetch.
        await assertMediaLikeSource(normalizedUrl, { signal: req.signal });

        let probePromise = probeCache.get(normalizedUrl);

        if (!probePromise) {
            probePromise = probeMedia(normalizedUrl)
                .catch((err) => {
                    // Do not cache failures, allowing subsequent retries
                    // Only delete if the current cached promise is STILL the one that failed
                    if (probeCache.get(normalizedUrl) === probePromise) {
                        probeCache.delete(normalizedUrl);
                    }
                    throw err;
                });

            probeCache.set(normalizedUrl, probePromise);
        }

        const metadata = await probePromise;

        // Filter for audio tracks specifically for the frontend selector
        const audioTracks = metadata.tracks.filter(t => t.type === 'audio');

        return NextResponse.json({
            duration: metadata.duration,
            audioTracks,
            allTracks: metadata.tracks
        });
    } catch (error: unknown) {
        if (error instanceof MediaValidationError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        console.error('Probe error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to probe media' },
            { status: 500 }
        );
    }
}
