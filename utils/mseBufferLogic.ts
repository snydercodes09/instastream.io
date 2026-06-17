const MAX_QUEUE_SIZE = 50;

export class VideoBufferManager {
    private mediaSource: MediaSource;
    private sourceBuffer: SourceBuffer | null = null;
    private queue: Uint8Array[] = [];
    private isUpdating = false;
    private mimeType: string;
    private getCurrentTime: () => number;
    private drainResolve: (() => void) | null = null;

    constructor(getCurrentTime: () => number, mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"') {
        this.getCurrentTime = getCurrentTime;
        this.mediaSource = new MediaSource();
        this.mimeType = mimeType;

        this.mediaSource.addEventListener('sourceopen', this.onSourceOpen.bind(this));
    }

    public getUrl(): string {
        return URL.createObjectURL(this.mediaSource);
    }

    public destroy() {
        if (this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch {
                // Ignore
            }
        }
        // URL revocation is handled by caller or GC. 
    }

    private onSourceOpen() {
        if (this.sourceBuffer) return;

        try {
            if (MediaSource.isTypeSupported(this.mimeType)) {
                this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mimeType);
                this.sourceBuffer.addEventListener('updateend', this.onUpdateEnd.bind(this));
                this.sourceBuffer.addEventListener('error', (e) => console.error('SourceBuffer error:', e));
            } else {
                console.error(`MIME type ${this.mimeType} not supported for MSE.`);
            }
        } catch (e) {
            console.error('Error adding SourceBuffer:', e);
        }

        this.processQueue();
    }

    public append(data: Uint8Array) {
        this.queue.push(data);
        this.processQueue();
    }

    private processQueue() {
        if (!this.sourceBuffer || this.isUpdating || this.queue.length === 0) return;

        const data = this.queue.shift();

        // If queue drained enough, resume fetching
        if (this.queue.length <= MAX_QUEUE_SIZE && this.drainResolve) {
            this.drainResolve();
            this.drainResolve = null;
        }

        if (data) {
            try {
                this.isUpdating = true;
                // Cast to any to avoid TS lib mismatch issues with Uint8Array/BufferSource
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.sourceBuffer.appendBuffer(data as any);
            } catch (e) {
                console.error('Error appending buffer:', e);
                this.isUpdating = false; // Reset if append fails synchronously

                if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                    // Quota Hit! 
                    // 1. Try standard cleanup (prunes forward > 30s, keeps backward 300s)
                    let freed = this.cleanupBuffer(300);

                    // 2. If that failed, it means we don't have >30s forward buffer to prune.
                    //    We must sacrifice backward buffer. Try keeping only 60s.
                    if (!freed) {
                        console.warn('Quota full, reducing backward buffer to 60s...');
                        freed = this.cleanupBuffer(60);
                    }

                    // 3. If still full, emergency prune: keep only 10s backward.
                    if (!freed) {
                        console.warn('Quota critical, reducing backward buffer to 10s...');
                        freed = this.cleanupBuffer(10);
                    }

                    if (freed) {
                        // If we successfully started a remove op, 'isUpdating' is true. 
                        // The 'updateend' will trigger processQueue again, which will naturally retry this chunk.
                        this.queue.unshift(data);
                    } else {
                        // We couldn't free space. This is critical.
                        // We can wait a bit or just drop the chunk? Dropping causes gaps.
                        // For now, let's retry after a delay to see if playback advances
                        console.warn('Quota reached and unable to free buffer. Retrying in 1s...');
                        setTimeout(() => {
                            if (this.queue.length > 0 && this.queue[0] === data) {
                                this.processQueue();
                            } else {
                                this.queue.unshift(data);
                                this.processQueue();
                            }
                        }, 1000);
                    }
                }
            }
        }
    }

    private onUpdateEnd() {
        this.isUpdating = false;
        this.processQueue();
    }

    public cleanupBuffer(secondsToKeepBackward = 300): boolean {
        if (!this.sourceBuffer || this.isUpdating || this.mediaSource.readyState !== 'open') return false;

        try {
            const currentTime = this.getCurrentTime();
            const buffered = this.sourceBuffer.buffered;

            // Strategy:
            // 1. First, try to remove far-future content (forward buffer) to relieve pressure.
            //    This preserves the "rewind" capability (backward buffer) as the priority.
            // 2. If that doesn't free enough space or isn't applicable, THEN prune backward buffer.

            const MAX_FORWARD_BUFFER = 30; // Keep at most 30s ahead to be safe

            // Phase 1: Forward Pruning (Sacrifice future for past)
            for (let i = 0; i < buffered.length; i++) {
                const start = buffered.start(i);
                const end = buffered.end(i);

                // If range is entirely in future beyond safe limit
                if (start > currentTime + MAX_FORWARD_BUFFER) {
                    this.sourceBuffer.remove(start, end);
                    this.isUpdating = true;
                    return true;
                }

                // If range overlaps cursor but extends too far
                if (start <= currentTime + MAX_FORWARD_BUFFER && end > currentTime + MAX_FORWARD_BUFFER) {
                    this.sourceBuffer.remove(currentTime + MAX_FORWARD_BUFFER, end);
                    this.isUpdating = true;
                    return true;
                }
            }

            // Phase 2: Backward Pruning (Only if Phase 1 didn't trigger)
            // We only do this if we are FORCED to (e.g. quota exceeded calls this with a lower secondsToKeep)
            // or if we are just regularly maintaining the window.
            for (let i = 0; i < buffered.length; i++) {
                const start = buffered.start(i);
                const end = buffered.end(i);
                const removeEnd = currentTime - secondsToKeepBackward;

                if (removeEnd > start) {
                    this.sourceBuffer.remove(start, Math.min(end, removeEnd));
                    this.isUpdating = true;
                    return true;
                }
            }

            return false;
        } catch (e) {
            console.error('Error cleaning buffer:', e);
            return false;
        }
    }

    public flushRange(start: number, end: number) {
        if (!this.sourceBuffer || this.isUpdating || this.mediaSource.readyState !== 'open') return;
        try {
            this.isUpdating = true;
            this.sourceBuffer.remove(start, end);
        } catch (e) {
            console.error('Error removing buffer:', e);
            this.isUpdating = false;
        }
    }

    public endOfStream() {
        if (this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch { }
        }
    }

    private abortController: AbortController | null = null;

    private waitForDrain(signal: AbortSignal): Promise<void> {
        return new Promise<void>((resolve) => {
            if (signal.aborted) {
                resolve();
                return;
            }

            const onAbort = () => {
                this.drainResolve = null;
                resolve();
            };

            this.drainResolve = () => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            };

            signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    public async startFetching(url: string) {
        this.stopFetching();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            const response = await fetch(url, { signal });
            if (!response.ok || !response.body) {
                console.error('Fetch failed:', response.status);
                return;
            }

            const reader = response.body.getReader();

            while (true) {
                // Backpressure: pause reading if queue is too large
                while (this.queue.length > MAX_QUEUE_SIZE) {
                    if (signal.aborted) break;
                    await this.waitForDrain(signal);
                }
                if (signal.aborted) break;

                const { done, value } = await reader.read();
                if (done) {
                    this.endOfStream();
                    break;
                }
                if (value) {
                    this.append(value);
                }
            }
        } catch (e) {
            if (signal.aborted) {
                console.log('Fetching aborted');
            } else {
                console.error('Error fetching stream:', e);
            }
        }
    }

    public stopFetching() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this.drainResolve) {
            this.drainResolve();
            this.drainResolve = null;
        }
    }
}
