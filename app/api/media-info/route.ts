import { NextRequest, NextResponse } from 'next/server';
import { probeMedia, MediaProbeResult } from '@/utils/mediaProbe';
import { normalizeMediaUrl, assertMediaLikeSource, MediaValidationError } from '@/utils/mediaUrl';
import { SimpleLRUCache } from '@/utils/lruCache';

export const dynamic = 'force-dynamic';

// Cache up to 100 recent probes to avoid redundant HEAD/ffprobe requests
// This persists across requests in the same lambda/container instance
const probeCache = new SimpleLRUCache<string, Promise<MediaProbeResult>>(100);

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    try {
        const { normalizedUrl } = normalizeMediaUrl(url);

        // Check cache first
        let probePromise = probeCache.get(normalizedUrl);

        if (!probePromise) {
            probePromise = (async () => {
                // Assert that the source is actually media before probing.
                // This also performs SSRF and LFI validation.
                await assertMediaLikeSource(normalizedUrl, { signal: req.signal });
                return probeMedia(normalizedUrl);
            })();

            probeCache.set(normalizedUrl, probePromise);

            // If it fails, remove from cache so we can retry later
            probePromise.catch(() => probeCache.delete(normalizedUrl));
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
