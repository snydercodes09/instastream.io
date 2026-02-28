'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import Controls, { AudioTrack, SubtitleTrack } from './Controls';
import usePlayerShortcuts from '../hooks/usePlayerShortcuts';
import { VideoBufferManager } from '../utils/mseBufferLogic';

interface KMPlayerProps {
    srcUrl: string;
}

type PlaybackMode = 'direct' | 'proxy' | 'transcode' | 'failed';
const KEYFRAME_ALIGN_SECONDS = 2;
const SEEK_DEBOUNCE_MS = 150;
const STALL_RECOVERY_DELAY_MS = 4000;
const PROXY_ESCALATION_DELAY_MS = 6000;
const END_GUARD_SECONDS = 0.25;

function clampPlayableTime(target: number, duration?: number | null): number {
    if (!Number.isFinite(target)) return 0;
    const safeTarget = Math.max(0, target);
    if (!duration || !Number.isFinite(duration) || duration <= 0) return safeTarget;
    const maxTime = Math.max(0, duration - END_GUARD_SECONDS);
    return Math.max(0, Math.min(safeTarget, maxTime));
}

function formatTimestamp(value: number): string {
    if (!Number.isFinite(value)) return '0:00';
    const total = Math.max(0, Math.floor(value));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

async function readRouteError(url: string, mode: 'proxy' | 'transcode'): Promise<string | null> {
    try {
        const headers: HeadersInit = {};
        if (mode === 'proxy') {
            headers.Range = 'bytes=0-1023';
        }

        const response = await fetch(url, {
            method: 'GET',
            headers,
            cache: 'no-store',
        });

        if (response.ok) {
            await response.body?.cancel();
            return null;
        }

        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        if (contentType.includes('application/json')) {
            const payload = (await response.json()) as { message?: string; code?: string };
            return payload.message ?? payload.code ?? `HTTP ${response.status}`;
        }

        const text = (await response.text()).trim();
        return text ? `HTTP ${response.status}: ${text.slice(0, 180)}` : `HTTP ${response.status}`;
    } catch (error: unknown) {
        return error instanceof Error ? error.message : 'Unknown network error';
    }
}

function buildModeUrl(
    mode: PlaybackMode,
    srcUrl: string,
    transcodeStartTime: number,
    transcodeRevision: number,
    audioIndex: number | null,
    subtitleIndex: number | null,
): string | undefined {
    switch (mode) {
        case 'direct':
            return srcUrl;
        case 'proxy':
            return `/api/download-stream?url=${encodeURIComponent(srcUrl)}`;
        case 'transcode':
            let base = `/api/transcode?url=${encodeURIComponent(srcUrl)}&time=${transcodeStartTime.toFixed(3)}&r=${transcodeRevision}`;
            if (audioIndex !== null) base += `&audioIndex=${audioIndex}`;
            if (subtitleIndex !== null) base += `&subtitleIndex=${subtitleIndex}`;
            return base;
        case 'failed':
            return undefined;
        default:
            return srcUrl;
    }
}

const KMPlayer: React.FC<KMPlayerProps> = ({ srcUrl }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastMouseMoveTimeRef = useRef(0);
    const isPlayingRef = useRef(false);
    const handledErrorModeRef = useRef<PlaybackMode | null>(null);
    const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const stallRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSeekRef = useRef<number | null>(null);
    const pendingTranscodeOffsetRef = useRef<number | null>(null);
    const lastProgressAtRef = useRef(0);
    const recoveryAttemptRef = useRef(0);
    const sourceDurationRef = useRef<number | null>(null);
    const isSeekingRef = useRef(false);

    // Playback state
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isSeeking, setIsSeeking] = useState(false); // UI seeking state

    // Playback mode state machine: direct -> proxy -> transcode -> failed
    const [mode, setMode] = useState<PlaybackMode>('direct');
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [transcodeStartTime, setTranscodeStartTime] = useState(0);
    const [transcodeRevision, setTranscodeRevision] = useState(0);

    // Audio Tracks
    const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
    const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | null>(null);

    // Subtitle Tracks (Embedded)
    const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
    const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | null>(null);

    // MSE state
    const mseManagerRef = useRef<VideoBufferManager | null>(null);
    const [mseUrl, setMseUrl] = useState<string | null>(null);

    // Subtitle state (Custom external)
    const [subtitleUrl, setSubtitleUrl] = useState<string>('');
    const [showSubtitleInput, setShowSubtitleInput] = useState(false);

    // Netflix UI state
    const [brightness, setBrightness] = useState(1);
    const [contrast, setContrast] = useState(1);
    const [showPlayOverlay, setShowPlayOverlay] = useState(false);
    const playOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [bufferedEnd, setBufferedEnd] = useState(0);

    // Fetch media info on load to populate audio/subtitle tracks
    useEffect(() => {
        if (!srcUrl) return;

        const fetchInfo = async () => {
            try {
                const res = await fetch(`/api/media-info?url=${encodeURIComponent(srcUrl)}`);
                if (res.ok) {
                    const data = (await res.json()) as {
                        audioTracks: AudioTrack[],
                        allTracks: Array<{ type: string } & SubtitleTrack>
                    };

                    // Audio tracks
                    if (data.audioTracks && Array.isArray(data.audioTracks)) {
                        setAudioTracks(data.audioTracks);
                        if (data.audioTracks.length > 0) {
                            setSelectedAudioIndex(data.audioTracks[0].index);
                        }
                    }

                    // Subtitle tracks
                    if (data.allTracks && Array.isArray(data.allTracks)) {
                        const subs = data.allTracks.filter((t) => t.type === 'subtitle');
                        setSubtitleTracks(subs);
                    }
                }
            } catch (e) {
                console.error('Failed to fetch media info:', e);
            }
        };
        fetchInfo();
    }, [srcUrl]);

    const finalUrl = useMemo(
        () => buildModeUrl(mode, srcUrl, transcodeStartTime, transcodeRevision, selectedAudioIndex, selectedSubtitleIndex),
        [mode, srcUrl, transcodeStartTime, transcodeRevision, selectedAudioIndex, selectedSubtitleIndex],
    );

    useEffect(() => {
        if (mode === 'transcode' && finalUrl) {
            // Initialize MSE
            if (mseManagerRef.current) {
                mseManagerRef.current.destroy();
            }
            const manager = new VideoBufferManager(() => videoRef.current?.currentTime || 0);
            mseManagerRef.current = manager;
            setMseUrl(manager.getUrl());
            manager.startFetching(finalUrl);

            return () => {
                if (mseManagerRef.current) {
                    mseManagerRef.current.destroy();
                    mseManagerRef.current = null;
                }
                setMseUrl(null);
            };
        } else {
            // Cleanup MSE if switching away from transcode
            if (mseManagerRef.current) {
                mseManagerRef.current.destroy();
                mseManagerRef.current = null;
            }
            setMseUrl(null);
        }
    }, [mode, finalUrl]);

    const handleSubtitleToggle = useCallback(() => {
        setShowSubtitleInput(prev => !prev);
    }, []);

    const handleSubtitleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const url = formData.get('subtitleUrl') as string;
        if (url) {
            setSubtitleUrl(url);
            setShowSubtitleInput(false);
            setStatusMessage('Subtitles loaded.');
            setTimeout(() => setStatusMessage(null), 3000);
        }
    };

    const clearStallRecoveryTimer = useCallback(() => {
        if (!stallRecoveryTimerRef.current) return;
        clearTimeout(stallRecoveryTimerRef.current);
        stallRecoveryTimerRef.current = null;
    }, []);

    const getAbsolutePlaybackTime = useCallback(() => {
        const video = videoRef.current;
        if (!video) return currentTime;
        if (mode === 'transcode') {
            return Math.max(0, transcodeStartTime + (video.currentTime || 0));
        }
        return Math.max(0, video.currentTime || currentTime);
    }, [currentTime, mode, transcodeStartTime]);

    const commitTranscodeSeek = useCallback((absoluteTarget: number, reasonMessage?: string) => {
        const absoluteDuration = sourceDurationRef.current ?? duration;
        const clamped = clampPlayableTime(absoluteTarget, absoluteDuration);
        const alignedStart = Math.max(
            0,
            Math.floor(clamped / KEYFRAME_ALIGN_SECONDS) * KEYFRAME_ALIGN_SECONDS,
        );
        const offsetWithinSegment = Math.max(0, clamped - alignedStart);

        pendingTranscodeOffsetRef.current = offsetWithinSegment;
        setIsSeeking(true);
        setCurrentTime(clamped);
        setTranscodeStartTime(alignedStart);
        setTranscodeRevision((prev) => prev + 1);
        handledErrorModeRef.current = null;
        clearStallRecoveryTimer();

        if (reasonMessage) {
            setStatusMessage(reasonMessage);
        } else {
            setStatusMessage(`Seeking to ${formatTimestamp(clamped)}...`);
        }
    }, [clearStallRecoveryTimer, duration]);

    const switchToTranscode = useCallback((absoluteStart: number, message: string) => {
        const absoluteDuration = sourceDurationRef.current ?? duration;
        const start = clampPlayableTime(absoluteStart, absoluteDuration);
        pendingTranscodeOffsetRef.current = 0;
        setIsSeeking(true);
        setCurrentTime(start);
        setTranscodeStartTime(start);
        setTranscodeRevision((prev) => prev + 1);
        setStatusMessage(message);
        setMode('transcode');
        handledErrorModeRef.current = null;
        clearStallRecoveryTimer();
    }, [clearStallRecoveryTimer, duration]);

    const recoverFromStall = useCallback((reason: string) => {
        const video = videoRef.current;
        if (!video || !isPlaying) return;

        if (mode === 'transcode') {
            if (recoveryAttemptRef.current >= 2) {
                setMode('failed');
                setStatusMessage('Playback stalled repeatedly during transcoding.');
                return;
            }

            recoveryAttemptRef.current += 1;
            const absolute = getAbsolutePlaybackTime();
            commitTranscodeSeek(absolute, `Recovering stalled playback (${reason})...`);
            return;
        }

        if (mode === 'proxy') {
            switchToTranscode(
                getAbsolutePlaybackTime(),
                'Proxy playback stalled. Switching to live transcoding.',
            );
            return;
        }

        if (mode === 'direct') {
            setStatusMessage('Direct playback stalled. Retrying through proxy.');
            setMode('proxy');
        }
    }, [commitTranscodeSeek, getAbsolutePlaybackTime, isPlaying, mode, switchToTranscode]);

    const scheduleStallRecovery = useCallback((reason: string) => {
        clearStallRecoveryTimer();
        stallRecoveryTimerRef.current = setTimeout(() => {
            const video = videoRef.current;
            if (!video || video.paused) return;

            const stale = Date.now() - lastProgressAtRef.current >= STALL_RECOVERY_DELAY_MS - 250;
            if (!stale) return;

            recoverFromStall(reason);
        }, STALL_RECOVERY_DELAY_MS);
    }, [clearStallRecoveryTimer, recoverFromStall]);

    // Some browsers can hang on unsupported proxy streams without firing a useful second error.
    // If proxy mode never becomes playable, force escalation to transcoding.
    useEffect(() => {
        if (mode !== 'proxy') return;

        const timer = setTimeout(() => {
            const video = videoRef.current;
            if (!video) return;

            const stalledAtStart = video.readyState < 2 && video.currentTime === 0;
            if (!stalledAtStart) return;

            switchToTranscode(
                getAbsolutePlaybackTime(),
                'Proxy did not become playable. Switching to live transcoding.',
            );
        }, PROXY_ESCALATION_DELAY_MS);

        return () => clearTimeout(timer);
    }, [getAbsolutePlaybackTime, mode, switchToTranscode]);

    useEffect(() => {
        isSeekingRef.current = isSeeking;
    }, [isSeeking]);

    useEffect(() => {
        lastProgressAtRef.current = Date.now();
    }, []);

    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        // Trigger play/pause overlay animation
        if (playOverlayTimeoutRef.current) clearTimeout(playOverlayTimeoutRef.current);
        setShowPlayOverlay(true);
        playOverlayTimeoutRef.current = setTimeout(() => setShowPlayOverlay(false), 600);

        if (video.paused) {
            video.play().catch(() => undefined);
        } else {
            video.pause();
        }
    }, []);

    const handleSeek = useCallback((time: number) => {
        const video = videoRef.current;
        if (!video) return;

        const absoluteDuration = sourceDurationRef.current ?? duration;
        const safeTime = clampPlayableTime(time, absoluteDuration);
        setCurrentTime(safeTime);

        if (mode === 'transcode') {
            pendingSeekRef.current = safeTime;

            if (seekDebounceRef.current) {
                clearTimeout(seekDebounceRef.current);
            }

            seekDebounceRef.current = setTimeout(() => {
                const target = pendingSeekRef.current ?? safeTime;
                commitTranscodeSeek(target);
            }, SEEK_DEBOUNCE_MS);
            return;
        }

        setIsSeeking(true);
        video.currentTime = safeTime;
    }, [commitTranscodeSeek, duration, mode]);

    const seekRelative = useCallback((seconds: number) => {
        const video = videoRef.current;
        if (!video) return;

        const raw = video.currentTime || 0;
        const currentAbs = mode === 'transcode' ? transcodeStartTime + raw : raw;
        handleSeek(currentAbs + seconds);
    }, [handleSeek, mode, transcodeStartTime]);

    const handleVolume = useCallback((vol: number) => {
        const video = videoRef.current;
        if (!video) return;

        const safeVol = Math.max(0, Math.min(vol, 1));
        video.volume = safeVol;
        video.muted = safeVol === 0;
        setVolume(safeVol);
    }, []);

    const volumeRelative = useCallback((change: number) => {
        const video = videoRef.current;
        if (!video) return;
        handleVolume(video.volume + change);
    }, [handleVolume]);

    const toggleMute = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        if (video.volume === 0) {
            handleVolume(1);
            return;
        }

        handleVolume(0);
    }, [handleVolume]);

    const toggleFullscreen = useCallback(() => {
        if (!containerRef.current) return;

        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch((err) => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
            return;
        }

        document.exitFullscreen().catch(() => undefined);
    }, []);

    const adjustBrightness = useCallback((delta: number) => {
        setBrightness(prev => Math.max(0.2, Math.min(2, +(prev + delta).toFixed(2))));
    }, []);

    const adjustContrast = useCallback((delta: number) => {
        setContrast(prev => Math.max(0.2, Math.min(2, +(prev + delta).toFixed(2))));
    }, []);

    // Track buffered end for progress bar
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onProgress = () => {
            if (video.buffered.length > 0) {
                const end = video.buffered.end(video.buffered.length - 1);
                const absolute = mode === 'transcode' ? transcodeStartTime + end : end;
                setBufferedEnd(absolute);
            }
        };
        video.addEventListener('progress', onProgress);
        return () => video.removeEventListener('progress', onProgress);
    }, [mode, transcodeStartTime]);

    usePlayerShortcuts({
        isPlaying,
        togglePlay,
        seekRelative,
        volumeRelative,
        toggleFullscreen,
        toggleMute,
        adjustBrightness,
        adjustContrast,
    });

    const handleMouseMove = useCallback(() => {
        setShowControls(true);
        lastMouseMoveTimeRef.current = Date.now();

        if (controlsTimeoutRef.current) return;

        const checkInactivity = () => {
            const timeSinceLastMove = Date.now() - lastMouseMoveTimeRef.current;
            if (timeSinceLastMove >= 3000) {
                if (isPlayingRef.current) {
                    setShowControls(false);
                }
                controlsTimeoutRef.current = null;
            } else {
                controlsTimeoutRef.current = setTimeout(checkInactivity, 3000 - timeSinceLastMove);
            }
        };

        controlsTimeoutRef.current = setTimeout(checkInactivity, 3000);
    }, []);

    const advanceMode = useCallback(async (currentMode: Exclude<PlaybackMode, 'failed'>) => {
        if (currentMode === 'direct') {
            setStatusMessage('Direct playback failed. Retrying through proxy.');
            setMode('proxy');
            return;
        }

        if (currentMode === 'proxy') {
            const diagnostics = await readRouteError(
                `/api/stream?url=${encodeURIComponent(srcUrl)}`,
                'proxy',
            );
            setStatusMessage(
                diagnostics
                    ? `Proxy failed: ${diagnostics}. Retrying with live transcoding.`
                    : 'Proxy failed. Retrying with live transcoding.',
            );
            switchToTranscode(getAbsolutePlaybackTime(), 'Switching to live transcoding...');
            return;
        }

        if (recoveryAttemptRef.current < 2) {
            recoveryAttemptRef.current += 1;
            commitTranscodeSeek(getAbsolutePlaybackTime(), 'Transcoding stream errored. Recovering...');
            return;
        }

        const diagnostics = await readRouteError(
            `/api/transcode?url=${encodeURIComponent(srcUrl)}`,
            'transcode',
        );

        setStatusMessage(
            diagnostics
                ? `Transcoding failed: ${diagnostics}`
                : 'Transcoding failed after all fallback modes.',
        );
        setMode('failed');
    }, [commitTranscodeSeek, getAbsolutePlaybackTime, srcUrl, switchToTranscode]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onTimeUpdate = () => {
            const raw = video.currentTime || 0;
            const absolute = mode === 'transcode' ? transcodeStartTime + raw : raw;
            setCurrentTime(absolute);
            lastProgressAtRef.current = Date.now();
        };
        const onLoadedMetadata = () => {
            const nativeDuration = Number.isFinite(video.duration) && video.duration > 0
                ? video.duration
                : null;

            if (mode === 'transcode') {
                const inferredTotal = nativeDuration !== null
                    ? transcodeStartTime + nativeDuration
                    : null;
                const absoluteDuration = sourceDurationRef.current ?? inferredTotal;

                if (absoluteDuration !== null && Number.isFinite(absoluteDuration) && absoluteDuration > 0) {
                    setDuration(absoluteDuration);
                }

                const pendingOffset = pendingTranscodeOffsetRef.current;
                if (pendingOffset !== null) {
                    const maxOffset = nativeDuration !== null
                        ? Math.max(0, nativeDuration - END_GUARD_SECONDS)
                        : pendingOffset;
                    const safeOffset = Math.max(0, Math.min(pendingOffset, maxOffset));

                    if (safeOffset > 0.01) {
                        try {
                            video.currentTime = safeOffset;
                        } catch {
                            // Ignore browser-specific seek failures; stall recovery handles fallback.
                        }
                    }
                    pendingTranscodeOffsetRef.current = null;
                }
            } else if (nativeDuration !== null) {
                sourceDurationRef.current = nativeDuration;
                setDuration(nativeDuration);
            }

            setIsSeeking(false);
            clearStallRecoveryTimer();
        };
        const onVolumeChange = () => {
            setVolume(video.volume);
        };
        const onSeeking = () => {
            setIsSeeking(true);
            clearStallRecoveryTimer();
        };
        const onSeeked = () => {
            setIsSeeking(false);
            lastProgressAtRef.current = Date.now();
            clearStallRecoveryTimer();
        };
        const onWaiting = () => {
            if (!isSeekingRef.current) {
                scheduleStallRecovery('buffering');
            }
        };
        const onStalled = () => {
            if (!isSeekingRef.current) {
                scheduleStallRecovery('stalled');
            }
        };
        const onCanPlay = () => clearStallRecoveryTimer();
        const onPlaying = () => {
            clearStallRecoveryTimer();
            setIsSeeking(false);
            recoveryAttemptRef.current = 0;
            setStatusMessage((prev) => {
                if (!prev) return prev;
                if (
                    prev.includes('Seeking') ||
                    prev.includes('Recovering') ||
                    prev.includes('Switching to live transcoding') ||
                    prev.includes('Proxy did not become playable')
                ) {
                    return null;
                }
                return prev;
            });
        };

        const onError = () => {
            if (mode === 'failed') return;

            if (handledErrorModeRef.current === mode) {
                return;
            }
            handledErrorModeRef.current = mode;

            const err = video.error;
            console.warn('Video Error Details:', {
                mode,
                code: err?.code ?? 'unknown',
                message: err?.message ?? 'unknown',
                original: err,
            });

            void advanceMode(mode);
        };

        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('volumechange', onVolumeChange);
        video.addEventListener('seeking', onSeeking);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('waiting', onWaiting);
        video.addEventListener('stalled', onStalled);
        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('playing', onPlaying);
        video.addEventListener('error', onError);

        return () => {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('volumechange', onVolumeChange);
            video.removeEventListener('seeking', onSeeking);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('waiting', onWaiting);
            video.removeEventListener('stalled', onStalled);
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('error', onError);
        };
    }, [advanceMode, clearStallRecoveryTimer, mode, scheduleStallRecovery, transcodeStartTime]);

    useEffect(() => {
        handledErrorModeRef.current = null;
        clearStallRecoveryTimer();
    }, [clearStallRecoveryTimer, finalUrl, mode]);

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    useEffect(() => {
        return () => {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
            }
            if (seekDebounceRef.current) {
                clearTimeout(seekDebounceRef.current);
            }
            clearStallRecoveryTimer();
        };
    }, [clearStallRecoveryTimer]);

    // Extract filename from URL for display
    const displayTitle = useMemo(() => {
        try {
            const url = new URL(srcUrl);
            const path = url.pathname;
            const filename = path.split('/').pop() || '';
            return decodeURIComponent(filename).replace(/\.[^.]+$/, '') || 'Untitled';
        } catch {
            return 'Untitled';
        }
    }, [srcUrl]);

    const handleSubtitleTrackChange = useCallback((index: number | null) => {
        setSelectedSubtitleIndex(index);
        if (index !== null) {
            // Force transcode mode if embedded subtitle is selected
            setTranscodeRevision(prev => prev + 1);
            setStatusMessage('Burning in subtitles...');
            if (mode !== 'transcode') {
                setMode('transcode');
            }
        } else if (mode === 'transcode' && selectedAudioIndex !== null) {
            // If unselecting subs but still in transcode (e.g. for audio), just reload
            setTranscodeRevision(prev => prev + 1);
            setStatusMessage('Turning off subtitles...');
        }
    }, [mode, selectedAudioIndex]);

    const handleAudioTrackChange = useCallback((index: number | null) => {
        setSelectedAudioIndex(index);
        if (mode === 'transcode') {
            setTranscodeRevision(prev => prev + 1);
            setStatusMessage('Switching audio track...');
        }
    }, [mode]);

    if (!srcUrl) {
        return <div className="flex items-center justify-center h-full text-gray-500">No Video Source</div>;
    }

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full bg-black overflow-hidden select-none ${!showControls && isPlaying ? 'cursor-none' : 'cursor-default'
                }`}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => isPlaying && setShowControls(false)}
        >
            {/* Video element with brightness/contrast CSS filter */}
            <video
                key={`${mode}:${finalUrl ?? 'none'}`}
                ref={videoRef}
                className="w-full h-full object-contain"
                style={{
                    filter: `brightness(${brightness}) contrast(${contrast})`,
                }}
                onClick={togglePlay}
                autoPlay
                playsInline
                src={mode === 'transcode' ? (mseUrl ?? undefined) : finalUrl}
                crossOrigin="anonymous"
            >
                {subtitleUrl && (
                    <track
                        kind="subtitles"
                        src={`/api/subtitles?url=${encodeURIComponent(subtitleUrl)}`}
                        label="English"
                        default
                    />
                )}
                Your browser does not support the video tag.
            </video>

            {/* ─── Top gradient bar with title ─── */}
            <div
                className={`absolute top-0 left-0 right-0 z-20 transition-opacity duration-500 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
            >
                <div className="bg-linear-to-b from-black/80 via-black/40 to-transparent px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div>
                            <p className="text-white/60 text-xs uppercase tracking-wider">Now Playing</p>
                            <h2 className="text-white text-lg font-semibold truncate max-w-md">
                                {displayTitle}
                            </h2>
                        </div>
                    </div>
                    {/* Mode badges */}
                    <div className="flex gap-2 mt-2">
                        {mode === 'proxy' && (
                            <span className="bg-yellow-600/80 text-white text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-medium">
                                Proxy
                            </span>
                        )}
                        {mode === 'transcode' && (
                            <span className="bg-[#E50914]/80 text-white text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-medium">
                                Transcoding
                            </span>
                        )}
                        {isSeeking && (
                            <span className="bg-white/20 text-white text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-medium">
                                Seeking
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* ─── Center play/pause overlay (animated flash) ─── */}
            <div
                className={`absolute inset-0 flex items-center justify-center pointer-events-none z-10 transition-opacity duration-300 ${showPlayOverlay ? 'opacity-100' : 'opacity-0'
                    }`}
            >
                <div className={`bg-black/50 rounded-full p-5 ${showPlayOverlay ? 'netflix-play-overlay' : ''}`}>
                    {isPlaying ? (
                        <Play size={48} className="text-white" fill="white" />
                    ) : (
                        <Pause size={48} className="text-white" fill="white" />
                    )}
                </div>
            </div>

            {/* ─── Controls ─── */}
            <Controls
                isPlaying={isPlaying}
                onPlayPause={togglePlay}
                currentTime={currentTime}
                duration={duration}
                onSeek={handleSeek}
                onSeekRelative={seekRelative}
                volume={volume}
                onVolumeChange={handleVolume}
                isFullscreen={isFullscreen}
                onFullscreenToggle={toggleFullscreen}
                onSubtitleToggle={handleSubtitleToggle}
                hasSubtitles={!!subtitleUrl}
                subtitleTracks={subtitleTracks}
                selectedSubtitleIndex={selectedSubtitleIndex}
                onSubtitleTrackChange={handleSubtitleTrackChange}
                isVisible={showControls}
                audioTracks={audioTracks}
                selectedAudioIndex={selectedAudioIndex}
                onAudioTrackChange={handleAudioTrackChange}
                brightness={brightness}
                contrast={contrast}
                onBrightnessChange={setBrightness}
                onContrastChange={setContrast}
                bufferedEnd={bufferedEnd}
            />

            {/* ─── Subtitle input modal ─── */}
            {showSubtitleInput && (
                <div className="absolute inset-0 bg-black/85 flex items-center justify-center z-40 backdrop-blur-sm">
                    <form onSubmit={handleSubtitleSubmit} className="bg-[#141414] p-6 rounded-xl border border-white/10 space-y-4 w-96 shadow-2xl">
                        <h3 className="text-white font-semibold text-lg">Load Subtitles</h3>
                        <p className="text-white/50 text-sm">Enter a direct URL to an SRT or VTT subtitle file.</p>
                        <input
                            name="subtitleUrl"
                            type="url"
                            placeholder="https://example.com/subs.srt"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-[#E50914] focus:border-transparent outline-none placeholder-white/30 transition-all"
                            autoFocus
                        />
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowSubtitleInput(false)}
                                className="px-4 py-2 text-white/60 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-5 py-2 bg-[#E50914] text-white rounded-lg hover:bg-[#f6121d] transition-colors font-medium"
                            >
                                Load
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ─── Status message ─── */}
            {statusMessage && (
                <div className="absolute bottom-16 left-4 right-4 z-20 transition-opacity duration-500">
                    <div className="bg-black/80 backdrop-blur-sm text-white/90 text-xs px-4 py-2.5 rounded-lg pointer-events-none inline-block">
                        {statusMessage}
                    </div>
                </div>
            )}

            {/* ─── Failed state overlay ─── */}
            {mode === 'failed' && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center px-6 text-center z-40">
                    <div className="bg-[#141414] rounded-xl p-8 max-w-md border border-white/10">
                        <div className="text-[#E50914] text-4xl mb-4">⚠</div>
                        <h3 className="text-white text-lg font-semibold mb-2">Playback Failed</h3>
                        <p className="text-white/50 text-sm">
                            Unable to play this video after trying direct, proxy, and transcoding modes.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default KMPlayer;
