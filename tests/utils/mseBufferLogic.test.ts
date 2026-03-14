/* eslint-disable @typescript-eslint/no-explicit-any */


import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { VideoBufferManager } from "../../utils/mseBufferLogic";

// --- Mocks ---

class MockTimeRanges {
    private ranges: [number, number][];

    constructor(ranges: [number, number][] = []) {
        this.ranges = ranges;
    }

    get length() {
        return this.ranges.length;
    }

    start(index: number) {
        if (index >= this.ranges.length) throw new Error("Index out of bounds");
        return this.ranges[index][0];
    }

    end(index: number) {
        if (index >= this.ranges.length) throw new Error("Index out of bounds");
        return this.ranges[index][1];
    }
}

class MockSourceBuffer {
    public updating: boolean = false;
    public buffered: MockTimeRanges = new MockTimeRanges();
    public listeners: Record<string, ((...args: any[]) => void)[]> = {};
    public appendBufferMock = mock((data: any) => {});
    public removeMock = mock((start: number, end: number) => {});

    addEventListener(event: string, callback: (...args: any[]) => void) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    trigger(event: string, data?: any) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }

    appendBuffer(data: any) {
        this.updating = true;
        this.appendBufferMock(data);
        // Simulate async update
        // In a real test, we might want to manually trigger 'updateend'
    }

    remove(start: number, end: number) {
        this.updating = true;
        this.removeMock(start, end);
    }
}

class MockMediaSource {
    public readyState: string = "closed";
    public activeSourceBuffers: MockSourceBuffer[] = [];
    public sourceBuffers: MockSourceBuffer[] = [];
    public listeners: Record<string, ((...args: any[]) => void)[]> = {};
    public addSourceBufferMock = mock((mime: string) => {
        const sb = new MockSourceBuffer();
        this.sourceBuffers.push(sb);
        return sb;
    });
    public endOfStreamMock = mock(() => {});

    constructor() {
        // Simulate immediate open for simplicity in some tests, or let test control it
    }

    addEventListener(event: string, callback: (...args: any[]) => void) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    trigger(event: string) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb());
        }
    }

    addSourceBuffer(mime: string) {
        return this.addSourceBufferMock(mime);
    }

    endOfStream() {
        this.endOfStreamMock();
    }

    static isTypeSupported(mime: string) {
        return true;
    }
}

// Global Mocks setup
global.MediaSource = MockMediaSource as any;
global.URL = { createObjectURL: mock(() => "blob:test") } as any;

// Mock DOMException
class MockDOMException extends Error {
    name: string;
    constructor(message: string, name: string) {
        super(message);
        this.name = name;
    }
}
global.DOMException = MockDOMException as any;


describe("VideoBufferManager", () => {
    let manager: VideoBufferManager;
    let mockGetCurrentTime: ReturnType<typeof mock>;
    let mediaSourceInstance: MockMediaSource;
    let consoleErrorSpy: ReturnType<typeof spyOn>;
    let consoleWarnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        mockGetCurrentTime = mock(() => 0);
        consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});

        // Reset mocks
        (global.MediaSource as any).mockClear?.(); // If we were using jest.fn

        // We need to capture the MediaSource instance created by the manager
        // But the manager creates it internally.
        // Since we mocked the global class, `new MediaSource()` will return our mock instance.
        // However, we need to access that instance.
        // We can spy on the constructor or just prototype hacking, but simplest is to just
        // let the manager create it and we intercept it via a side channel if needed,
        // OR we just rely on the fact that `manager` has it private.
        // But `manager` has it as `private mediaSource`.

        // Better approach: The mock class is defined above. When `new MediaSource()` is called,
        // it returns an instance of MockMediaSource. We can't easily grab that instance
        // unless we store it globally or spy on the constructor.

        // Let's modify the MockMediaSource constructor to store the last instance
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    // Helper to get the internal mediaSource instance from the manager
    // (We cast to any to access private property for testing)
    function getMediaSource(mgr: VideoBufferManager): MockMediaSource {
        return (mgr as any).mediaSource;
    }

    it("should initialize and attach sourceopen listener", () => {
        manager = new VideoBufferManager(mockGetCurrentTime);
        const ms = getMediaSource(manager);

        expect(ms).toBeInstanceOf(MockMediaSource);
        expect(ms.listeners['sourceopen']).toBeDefined();
        expect(ms.listeners['sourceopen'].length).toBe(1);
    });

    it("should add SourceBuffer on sourceopen", () => {
        manager = new VideoBufferManager(mockGetCurrentTime, 'video/mp4; codecs="avc1"');
        const ms = getMediaSource(manager);

        // Trigger sourceopen
        ms.readyState = "open";
        ms.trigger('sourceopen');

        expect(ms.addSourceBufferMock).toHaveBeenCalledWith('video/mp4; codecs="avc1"');

        const sb = (manager as any).sourceBuffer as MockSourceBuffer;
        expect(sb).toBeDefined();
        expect(sb.listeners['updateend']).toBeDefined();
        expect(sb.listeners['error']).toBeDefined();
    });

    it("should queue data and append when SourceBuffer is ready", () => {
        manager = new VideoBufferManager(mockGetCurrentTime);
        const ms = getMediaSource(manager);
        ms.readyState = "open";
        ms.trigger('sourceopen');

        const sb = (manager as any).sourceBuffer as MockSourceBuffer;
        const data = new Uint8Array([1, 2, 3]);

        manager.append(data);

        expect(sb.appendBufferMock).toHaveBeenCalledWith(data);
        expect(sb.updating).toBe(true);
    });

    it("should process queue sequentially", () => {
        manager = new VideoBufferManager(mockGetCurrentTime);
        const ms = getMediaSource(manager);
        ms.readyState = "open";
        ms.trigger('sourceopen');

        const sb = (manager as any).sourceBuffer as MockSourceBuffer;
        const data1 = new Uint8Array([1]);
        const data2 = new Uint8Array([2]);

        manager.append(data1);
        expect(sb.appendBufferMock).toHaveBeenCalledWith(data1);
        expect(sb.updating).toBe(true);
        sb.appendBufferMock.mockClear();

        // Try appending second chunk while updating
        manager.append(data2);
        expect(sb.appendBufferMock).not.toHaveBeenCalled(); // Should be queued

        // Finish first update
        sb.updating = false;
        sb.trigger('updateend');

        expect(sb.appendBufferMock).toHaveBeenCalledWith(data2);
    });

    it("should handle QuotaExceededError by pruning buffer", () => {
        manager = new VideoBufferManager(mockGetCurrentTime);
        const ms = getMediaSource(manager);
        ms.readyState = "open";
        ms.trigger('sourceopen');

        const sb = (manager as any).sourceBuffer as MockSourceBuffer;

        // Setup a scenario where cleanup is needed
        // Current time = 1000
        mockGetCurrentTime.mockImplementation(() => 1000);

        // Buffer has data from 600 to 1030 (keep backward 300 means keep > 700)
        // so we have [600, 1030]. 600-700 is prunable (100s).
        sb.buffered = new MockTimeRanges([[600, 1030]]);

        const data = new Uint8Array([1]);

        // Make appendBuffer throw QuotaExceededError
        sb.appendBufferMock.mockImplementationOnce(() => {
            throw new MockDOMException("Quota exceeded", "QuotaExceededError");
        });

        // Spy on remove
        // We expect cleanupBuffer(300) to be called.
        // removeEnd = 1000 - 300 = 700.
        // Range is [600, 1030].
        // Should remove(600, 700).

        manager.append(data);

        expect(sb.removeMock).toHaveBeenCalledWith(600, 700);
        // After remove, updating is true
        expect(sb.updating).toBe(true);

        // Simulate updateend after removal
        sb.updating = false;
        sb.trigger('updateend');

        // Should retry append
        // The mock implementation was once, so next call should succeed (or just be called)
        // Since we didn't mock it to succeed specifically, it just calls the default mock which does nothing
        expect(sb.appendBufferMock).toHaveBeenCalledTimes(2); // 1 fail, 1 retry
    });

    it("should escalate pruning if initial cleanup fails", () => {
        manager = new VideoBufferManager(mockGetCurrentTime);
        const ms = getMediaSource(manager);
        ms.readyState = "open";
        ms.trigger('sourceopen');

        const sb = (manager as any).sourceBuffer as MockSourceBuffer;

        mockGetCurrentTime.mockImplementation(() => 1000);

        // Buffer is tight: [950, 1000]
        // cleanup(300) -> removeEnd = 700. 700 < 950. No prune.
        // cleanup(60) -> removeEnd = 940. 940 < 950. No prune.
        // cleanup(10) -> removeEnd = 990. 990 > 950. Prune [950, 990].

        sb.buffered = new MockTimeRanges([[950, 1000]]);

        const data = new Uint8Array([1]);

        sb.appendBufferMock.mockImplementationOnce(() => {
            throw new MockDOMException("Quota exceeded", "QuotaExceededError");
        });

        manager.append(data);

        // Expect remove to be called with escalation
        // It will try 300 (fail), 60 (fail), 10 (succeed)
        expect(sb.removeMock).toHaveBeenCalledWith(950, 990);
    });

    it("should retry with setTimeout if all pruning fails", async () => {
        // We need to mock setTimeout to test this synchronously or use async/await
        const originalSetTimeout = global.setTimeout;
        const setTimeoutMock = mock((cb: any, delay: any) => {
            cb(); // Execute immediately
            return 0 as any;
        });
        global.setTimeout = setTimeoutMock as any;

        try {
            manager = new VideoBufferManager(mockGetCurrentTime);
            const ms = getMediaSource(manager);
            ms.readyState = "open";
            ms.trigger('sourceopen');

            const sb = (manager as any).sourceBuffer as MockSourceBuffer;

            mockGetCurrentTime.mockImplementation(() => 1000);

            // Buffer very tight: [995, 1000] (Only 5s backward)
            // cleanup(10) -> removeEnd = 990. 990 < 995. No prune.

            sb.buffered = new MockTimeRanges([[995, 1000]]);

            const data = new Uint8Array([1]);

            // Fail twice: once initially, once after retry
            sb.appendBufferMock
                .mockImplementationOnce(() => { throw new MockDOMException("Quota", "QuotaExceededError"); })
                .mockImplementationOnce(() => { /* Success on retry */ });

            manager.append(data);

            expect(sb.removeMock).not.toHaveBeenCalled();
            expect(setTimeoutMock).toHaveBeenCalled();
            // The retry logic should have called appendBuffer again
            expect(sb.appendBufferMock).toHaveBeenCalledTimes(2);

        } finally {
            global.setTimeout = originalSetTimeout;
        }
    });

    it("should prune forward buffer if ahead of playback", () => {
        manager = new VideoBufferManager(mockGetCurrentTime);
        const ms = getMediaSource(manager);
        ms.readyState = "open";
        ms.trigger('sourceopen');
        const sb = (manager as any).sourceBuffer as MockSourceBuffer;

        mockGetCurrentTime.mockImplementation(() => 100);

        // Forward buffer: [100, 200].
        // Max forward is 30.
        // Should remove [130, 200].

        sb.buffered = new MockTimeRanges([[100, 200]]);

        manager.cleanupBuffer(300);

        expect(sb.removeMock).toHaveBeenCalledWith(130, 200);
    });
});
