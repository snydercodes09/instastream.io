import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import db, { VideoRecord } from '@/db';
import { StorageManager } from '@/utils/storage';


// Background DB queue for non-blocking I/O
const dbQueue = new Map<number, { status: string; downloaded: number }>();
let isDbQueueFlushing = false;

// Pre-compile statement for performance
const updateStmt = db.prepare('UPDATE videos SET status = ?, downloaded = ? WHERE id = ?');

function flushDbQueue() {
    if (dbQueue.size === 0) {
        isDbQueueFlushing = false;
        return;
    }
    try {
        const batch = db.transaction(() => {
            for (const [id, data] of dbQueue.entries()) {
                updateStmt.run(data.status, data.downloaded, id);
            }
        });
        batch();
        dbQueue.clear();
    } catch (e) {
        console.error('DB Update Batch Error:', e);
    } finally {
        isDbQueueFlushing = false;
    }
}

function updateStatusAsync(id: number, status: string, downloaded: number) {
    // Coalesce updates per video id
    dbQueue.set(id, { status, downloaded });

    // Schedule background flush if not already running
    if (!isDbQueueFlushing) {
        isDbQueueFlushing = true;
        setImmediate(flushDbQueue);
    }
}

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');
    if (!url) {
        return new NextResponse('Missing URL', { status: 400 });
    }

    await StorageManager.ensureDirectory();

    // 1. Check DB for existing record
    let video = db.prepare('SELECT * FROM videos WHERE url = ?').get(url) as VideoRecord | undefined;

    // 2. If completely downloaded, serve from disk
    if (video && video.status === 'completed' && await StorageManager.fileExists(video.filename)) {
        const filePath = StorageManager.getFilePath(video.filename);
        const stat = await fs.promises.stat(filePath);
        const fileSize = stat.size;
        const range = req.headers.get('range');

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });

            return new NextResponse(Readable.toWeb(file) as ReadableStream, {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize.toString(),
                    'Content-Type': 'video/mp4',
                },
            });
        } else {
            const file = fs.createReadStream(filePath);
            return new NextResponse(Readable.toWeb(file) as ReadableStream, {
                status: 200,
                headers: {
                    'Content-Length': fileSize.toString(),
                    'Content-Type': 'video/mp4',
                },
            });
        }
    }

    // 3. If not fully downloaded, start fresh download & stream (Tee)
    // Note: To simplify, we don't support resuming partial downloads yet. 
    // If it's 'downloading' or 'pending', we treat it as a fresh stream but also write to disk.

    // Create new record if needed
    if (!video) {
        const filename = StorageManager.generateFilename(url);
        const info = db.prepare('INSERT INTO videos (url, filename, filepath, status) VALUES (?, ?, ?, ?)')
            .run(url, filename, StorageManager.getFilePath(filename), 'downloading');

        video = {
            id: info.lastInsertRowid as number,
            url,
            filename,
            filepath: StorageManager.getFilePath(filename),
            size: 0,
            downloaded: 0,
            status: 'downloading',
            created_at: new Date().toISOString(),
            last_accessed: new Date().toISOString()
        };
    } else {
        // Reset status to downloading if it was interrupted/error
        db.prepare('UPDATE videos SET status = ?, downloaded = 0 WHERE id = ?').run('downloading', video.id);
    }

    try {
        const upstreamRes = await fetch(url);
        if (!upstreamRes.ok || !upstreamRes.body) {
            db.prepare('UPDATE videos SET status = ? WHERE id = ?').run('error', video.id);
            return new NextResponse('Upstream Error', { status: upstreamRes.status });
        }

        const contentLength = upstreamRes.headers.get('content-length');
        if (contentLength) {
            db.prepare('UPDATE videos SET size = ? WHERE id = ?').run(parseInt(contentLength), video.id);
        }

        // The Tee Logic
        // We can't easily clone a web ReadableStream multiple times without buffering.
        // Instead, we use Node.js PassThrough if possible, or just read chunks and write to both.

        const fileStream = fs.createWriteStream(video.filepath);
        // const passThrough = new PassThrough();

        // Convert web stream to node stream to use .pipe()? 
        // Or manually read reader and write to both. Manual is safer for edge environment compat (though we are nodejs here).

        const reader = upstreamRes.body.getReader();
        let bytesWritten = 0;
        let lastUpdateBytes = 0;

        // Create a ReadableStream for the response
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            fileStream.end();
                            updateStatusAsync(video!.id, 'completed', bytesWritten);
                            controller.close();
                            break;
                        }

                        // 1. Write to file
                        const canWrite = fileStream.write(value);
                        if (!canWrite) {
                            await new Promise((resolve) => fileStream.once('drain', resolve));
                        }
                        bytesWritten += value.length;

                        // Throttle DB updates (every 1MB roughly?)
                        if (bytesWritten - lastUpdateBytes >= (1024 * 1024)) {
                            updateStatusAsync(video!.id, 'downloading', bytesWritten);
                            lastUpdateBytes = bytesWritten;
                        }

                        // 2. Send to client
                        controller.enqueue(value);
                    }
                } catch (err) {
                    console.error('Stream Error:', err);
                    fileStream.end();
                    updateStatusAsync(video!.id, 'error', bytesWritten);
                    controller.error(err);
                }
            },
            cancel() {
                // Client disconnected
                // We MIGHT want to continue downloading in background?
                // For now, let's stop to save bandwidth.
                console.log('Client disconnected, stopping download.');
                reader.cancel();
                fileStream.end();
                // Mark as pending so we can maybe resume or restart later
                updateStatusAsync(video!.id, 'pending', bytesWritten);
            }
        });

        const headers = new Headers(upstreamRes.headers);
        headers.set('X-InstaStream-Source', 'upstream-tee');

        return new NextResponse(stream, {
            status: upstreamRes.status,
            headers: headers
        });

    } catch (e) {
        console.error('Download Setup Error:', e);
        return new NextResponse('Internal Error', { status: 500 });
    }
}
