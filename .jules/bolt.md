
## 2024-05-24 - [Coalescing SQLite synchronous writes in API streams]
**Learning:** High-throughput streaming API routes (like download proxies) can severely block the Node.js event loop if they perform synchronous database writes (e.g., better-sqlite3) for every chunk, even if throttled by byte count.
**Action:** Coalesce these synchronous DB updates using an in-memory map and `setImmediate()`. This ensures updates are batched and executed asynchronously in the background, allowing the stream to process chunks without being blocked by I/O.
