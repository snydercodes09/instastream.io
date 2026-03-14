# Bolt's Journal

## 2024-03-24 - [Initial Learning]
**Learning:** This codebase uses Next.js with React server and client components, relying on an in-house proxying and live transcoding setup. Performance issues likely lie in component re-rendering, unoptimized proxy buffering, or database writes.
**Action:** Focus on low-hanging React rendering issues first.

## 2024-05-18 - [Web Stream to Node Stream Backpressure]
**Learning:** When proxying responses in Next.js API Routes using Web `ReadableStream` and writing the chunks to disk with a Node.js `fs.WriteStream`, the disk write speed might be slower than the network fetch. If `fileStream.write(value)` returns `false`, reading from the upstream network must be paused using `await new Promise(resolve => fileStream.once('drain', resolve))` to prevent severe memory bloat.
**Action:** Always handle stream backpressure manually when translating between un-piped Web Streams and Node.js Streams.
