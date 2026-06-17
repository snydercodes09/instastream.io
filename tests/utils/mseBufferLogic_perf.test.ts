import { describe, it, expect, mock, spyOn } from "bun:test";
import { VideoBufferManager } from "../../utils/mseBufferLogic";

// Mock browser globals
class MockSourceBuffer {
    updating = false;
    buffered = { length: 0, start: () => 0, end: () => 0 };
    addEventListener() {}
    appendBuffer() { this.updating = true; } // Sets updating to true
    remove() {}
}

class MockMediaSource {
    readyState = "open";
    sourceBuffers = [];
    activeSourceBuffers = [];
    addSourceBuffer() {
        const sb = new MockSourceBuffer();
        return sb;
    }
    addEventListener(evt: string, cb: Function) {
        if (evt === 'sourceopen') {
             // Simulate async callback
             setTimeout(cb, 0);
        }
    }
    endOfStream() {}
    static isTypeSupported() { return true; }
}

// Global Mocks setup
global.MediaSource = MockMediaSource as any;
global.URL = { createObjectURL: () => "blob:test" } as any;

describe("VideoBufferManager Performance", () => {
    it("should NOT poll for backpressure", async () => {
        const originalSetTimeout = global.setTimeout;
        let backpressurePollCount = 0;

        // Mock setTimeout to count 50ms polls
        const setTimeoutSpy = mock((cb: any, delay: any, ...args: any[]) => {
            if (delay === 50) {
                backpressurePollCount++;
            }
            return originalSetTimeout(cb, delay, ...args);
        });
        global.setTimeout = setTimeoutSpy as any;

        try {
            const manager = new VideoBufferManager(() => 0);

            // Create a stream that pushes data fast
            const stream = new ReadableStream({
                start(controller) {
                    // Fill queue > 50 chunks. MAX_QUEUE_SIZE is 50.
                    for (let i = 0; i < 60; i++) {
                        controller.enqueue(new Uint8Array([i]));
                    }
                }
            });

            global.fetch = mock(() => Promise.resolve(new Response(stream)));

            // Start fetching
            manager.startFetching("http://test");

            // Wait for 300ms to allow potential polling
            await new Promise(r => originalSetTimeout(r, 300));

            console.log(`Backpressure polls detected: ${backpressurePollCount}`);

            // Expect NO polling
            expect(backpressurePollCount).toBe(0);

            manager.stopFetching();

        } finally {
            global.setTimeout = originalSetTimeout;
        }
    });
});
