## 2024-05-19 - Missing Probe Cache Bottleneck
**Learning:** The memory context indicated `assertMediaLikeSource` cached successful probe results in an in-memory Map to avoid redundant network requests. However, this cache was missing from the implementation. Network requests were being made for every stream operation, which was a significant performance bottleneck.
**Action:** Implemented the missing LRU Map cache with a 5-minute TTL and 500-item limit in `utils/mediaUrl.ts` to restore the expected optimization and reduce upstream bandwidth usage.
