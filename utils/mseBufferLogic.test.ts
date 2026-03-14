/* eslint-disable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/ban-ts-comment */

import { VideoBufferManager } from './mseBufferLogic';
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock implementation
class MockSourceBuffer extends EventTarget {
    public buffered = {
        length: 0,
        start: () => 0,
        end: () => 0
    };
    public updating = false;

    appendBuffer(data: any) {
        this.updating = true;
        // Simulate slow processing - do NOT fire updateend immediately
    }

    remove(start: number, end: number) {}
}

class MockMediaSource extends EventTarget {
    public sourceBuffers = [];
    public readyState = 'closed';

    constructor() {
        super();
        this.readyState = 'closed';
        setTimeout(() => {
            this.readyState = 'open';
            this.dispatchEvent(new Event('sourceopen'));
        }, 10);
    }

    addSourceBuffer(mime: string) {
        const sb = new MockSourceBuffer();
        return sb;
    }

    endOfStream() {}

    static isTypeSupported(mime: string) { return true; }
}

// Setup globals
global.MediaSource = MockMediaSource as any;
global.URL = { createObjectURL: () => 'blob:mock' } as any;

describe('VideoBufferManager Memory Leak', () => {
    it('should grow queue indefinitely if append is slow', async () => {
        const manager = new VideoBufferManager(() => 0);

        // Wait for sourceopen
        await new Promise(resolve => setTimeout(resolve, 50));

        // Create a fast stream
        const stream = new ReadableStream({
            start(controller) {
                // Push 1000 chunks quickly
                for(let i=0; i<1000; i++) {
                    controller.enqueue(new Uint8Array(1024));
                }
                controller.close();
            }
        });

        global.fetch = mock(() => Promise.resolve(new Response(stream)));

        // Start fetching
        const fetchPromise = manager.startFetching('http://example.com/video.mp4');

        // Give it some time to process the loop.
        // Since the stream is already in memory, it should be read very quickly.
        await new Promise(resolve => setTimeout(resolve, 200));

        // Check queue size
        // @ts-ignore
        const queueSize = manager.queue.length;
        console.log(`Queue size: ${queueSize}`);

        // Since we pushed 1000 chunks and SourceBuffer is "stuck" (we never fired updateend),
        // the first chunk might be "processing" (shifted).
        // With backpressure, the loop should pause when queue reaches threshold (e.g. 50).
        expect(queueSize).toBeLessThan(100);

        manager.destroy();
    });
});
