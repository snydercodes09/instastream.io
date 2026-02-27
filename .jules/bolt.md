# Bolt's Journal - Critical Learnings

## Initial State
- Initialized Bolt's Journal.

## 2025-05-18 - [Promise Caching for Request Coalescing and Performance]
**Learning:** `app/api/media-info/route.ts` was performing redundant `assertMediaLikeSource` and `ffprobe` operations when multiple requests for the same URL were made simultaneously (which can happen frequently during page load or video switching).
**Action:** By instantiating a static `SimpleLRUCache` to store `Promise<MediaProbeResult>` by URL, concurrent requests now wait on the same promise, effectively acting as request coalescing and a cache for expensive operations. Failed promises must be caught and deleted from the cache to avoid permanently caching a transient error state.