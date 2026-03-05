'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
    Play,
    Pause,
    Volume2,
    VolumeX,
    Volume1,
    Maximize,
    Minimize,
    Captions,
    Music,
    RotateCcw,
    RotateCw,
    Sun,
    Contrast,
} from 'lucide-react';

export interface AudioTrack {
    index: number;
    label?: string;
    language?: string;
    codec: string;
}

export interface SubtitleTrack {
    index: number;
    label?: string;
    language?: string;
    codec: string;
}

interface ControlsProps {
    isPlaying: boolean;
    onPlayPause: () => void;
    currentTime: number;
    duration: number;
    onSeek: (time: number) => void;
    onSeekRelative: (seconds: number) => void;
    volume: number;
    onVolumeChange: (volume: number) => void;
    isFullscreen: boolean;
    onFullscreenToggle: () => void;

    // Subtitles
    onSubtitleToggle: () => void; // Opens custom sub modal
    hasSubtitles: boolean; // True if custom sub loaded
    subtitleTracks?: SubtitleTrack[];
    selectedSubtitleIndex?: number | null;
    onSubtitleTrackChange?: (index: number | null) => void;

    isVisible: boolean;
    audioTracks?: AudioTrack[];
    selectedAudioIndex?: number | null;
    onAudioTrackChange?: (index: number) => void;
    brightness: number;
    contrast: number;
    onBrightnessChange: (value: number) => void;
    onContrastChange: (value: number) => void;
    bufferedEnd?: number;
}

/* ─── helpers ─── */

function formatTime(time: number): string {
    if (!time || isNaN(time)) return '0:00';
    const total = Math.max(0, Math.floor(time));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatRemaining(current: number, total: number): string {
    const remaining = Math.max(0, total - current);
    return `-${formatTime(remaining)}`;
}

/* ─── component ─── */

const Controls: React.FC<ControlsProps> = ({
    isPlaying,
    onPlayPause,
    currentTime,
    duration,
    onSeek,
    onSeekRelative,
    volume,
    onVolumeChange,
    isFullscreen,
    onFullscreenToggle,
    onSubtitleToggle,
    hasSubtitles,
    subtitleTracks = [],
    selectedSubtitleIndex,
    onSubtitleTrackChange,
    isVisible,
    audioTracks = [],
    selectedAudioIndex,
    onAudioTrackChange,
    brightness,
    contrast,
    onBrightnessChange,
    onContrastChange,
    bufferedEnd = 0,
}) => {
    const [showAudioMenu, setShowAudioMenu] = useState(false);
    const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [isHoveringProgress, setIsHoveringProgress] = useState(false);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const progressRef = useRef<HTMLDivElement>(null);
    const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /* ─── progress bar logic ─── */

    const getTimeFromEvent = useCallback(
        (e: React.MouseEvent | MouseEvent): number => {
            if (!progressRef.current || !duration) return 0;
            const rect = progressRef.current.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            return (x / rect.width) * duration;
        },
        [duration],
    );

    const handleProgressMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            setIsScrubbing(true);
            const time = getTimeFromEvent(e);
            onSeek(time);

            const onMouseMove = (ev: MouseEvent) => {
                const t = getTimeFromEvent(ev);
                onSeek(t);
            };
            const onMouseUp = () => {
                setIsScrubbing(false);
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        },
        [getTimeFromEvent, onSeek],
    );

    const handleProgressMouseMove = useCallback(
        (e: React.MouseEvent) => {
            const time = getTimeFromEvent(e);
            setHoverTime(time);
        },
        [getTimeFromEvent],
    );

    /* ─── volume hover ─── */

    const handleVolumeEnter = useCallback(() => {
        if (volumeTimeoutRef.current) clearTimeout(volumeTimeoutRef.current);
        setShowVolumeSlider(true);
    }, []);

    const handleVolumeLeave = useCallback(() => {
        volumeTimeoutRef.current = setTimeout(() => setShowVolumeSlider(false), 400);
    }, []);

    const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    const staticLeftControls = React.useMemo(() => (
        <>
            {/* Play/Pause */}
            <button
                onClick={onPlayPause}
                className="text-white hover:text-white/80 transition-colors"
                aria-label={isPlaying ? 'Pause' : 'Play'}
            >
                {isPlaying ? <Pause size={28} fill="white" /> : <Play size={28} fill="white" />}
            </button>

            {/* Rewind 5s */}
            <button
                onClick={() => onSeekRelative(-5)}
                className="text-white hover:text-white/80 transition-colors"
                aria-label="Rewind 5 seconds"
            >
                <RotateCcw size={22} />
            </button>

            {/* Forward 5s */}
            <button
                onClick={() => onSeekRelative(5)}
                className="text-white hover:text-white/80 transition-colors"
                aria-label="Forward 5 seconds"
            >
                <RotateCw size={22} />
            </button>

            {/* Volume */}
            <div
                className="relative flex items-center"
                onMouseEnter={handleVolumeEnter}
                onMouseLeave={handleVolumeLeave}
            >
                <button
                    onClick={() => onVolumeChange(volume === 0 ? 1 : 0)}
                    className="text-white hover:text-white/80 transition-colors"
                    aria-label={volume === 0 ? 'Unmute' : 'Mute'}
                >
                    <VolumeIcon size={22} />
                </button>

                {/* Vertical volume slider popup */}
                <div
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-black/90 rounded-lg p-2 transition-all duration-300 ${showVolumeSlider
                        ? 'opacity-100 translate-y-0 pointer-events-auto'
                        : 'opacity-0 translate-y-2 pointer-events-none'
                        }`}
                >
                    <div className="h-24 flex flex-col items-center justify-end">
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.02"
                            value={volume}
                            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                            className="netflix-volume-slider"
                            aria-label="Volume"
                            style={{
                                writingMode: 'vertical-lr',
                                direction: 'rtl',
                                height: '80px',
                                width: '4px',
                            }}
                        />
                    </div>
                </div>
            </div>
        </>
    ), [handleVolumeEnter, handleVolumeLeave, isPlaying, onPlayPause, onSeekRelative, onVolumeChange, showVolumeSlider, volume, VolumeIcon]);

    const staticRightControls = React.useMemo(() => (
        <>
            {/* Brightness / Contrast */}
            <div className="relative">
                <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`transition-colors ${showFilters ? 'text-[#E50914]' : 'text-white hover:text-white/80'}`}
                    aria-label="Brightness and contrast"
                    aria-expanded={showFilters}
                >
                    <Sun size={20} />
                </button>

                {showFilters && (
                    <div className="absolute bottom-full right-0 mb-3 bg-black/95 border border-white/10 rounded-lg p-4 w-56 space-y-4 shadow-2xl">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-white/80 text-xs">
                                <div className="flex items-center gap-1.5">
                                    <Sun size={14} />
                                    <span>Brightness</span>
                                </div>
                                <span className="tabular-nums">{Math.round(brightness * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0.2"
                                max="2"
                                step="0.05"
                                value={brightness}
                                onChange={(e) => onBrightnessChange(parseFloat(e.target.value))}
                                className="netflix-filter-slider w-full"
                                aria-label="Brightness"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-white/80 text-xs">
                                <div className="flex items-center gap-1.5">
                                    <Contrast size={14} />
                                    <span>Contrast</span>
                                </div>
                                <span className="tabular-nums">{Math.round(contrast * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0.2"
                                max="2"
                                step="0.05"
                                value={contrast}
                                onChange={(e) => onContrastChange(parseFloat(e.target.value))}
                                className="netflix-filter-slider w-full"
                                aria-label="Contrast"
                            />
                        </div>
                        <button
                            onClick={() => {
                                onBrightnessChange(1);
                                onContrastChange(1);
                            }}
                            className="w-full text-xs text-white/60 hover:text-white transition-colors py-1"
                        >
                            Reset to default
                        </button>
                    </div>
                )}
            </div>

            {/* Audio Tracks */}
            {audioTracks.length > 1 && (
                <div className="relative">
                    <button
                        onClick={() => setShowAudioMenu(!showAudioMenu)}
                        className={`transition-colors ${showAudioMenu ? 'text-[#E50914]' : 'text-white hover:text-white/80'}`}
                        aria-label="Audio tracks"
                        aria-expanded={showAudioMenu}
                    >
                        <Music size={20} />
                    </button>
                    {showAudioMenu && (
                        <div className="absolute bottom-full mb-3 right-0 bg-black/95 border border-white/10 rounded-lg shadow-2xl overflow-hidden min-w-[180px] z-50">
                            <div className="px-3 py-2 text-xs text-white/50 uppercase tracking-wider border-b border-white/10">
                                Audio
                            </div>
                            {audioTracks.map((track) => (
                                <button
                                    key={track.index}
                                    onClick={() => {
                                        onAudioTrackChange?.(track.index);
                                        setShowAudioMenu(false);
                                    }}
                                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors ${selectedAudioIndex === track.index
                                        ? 'text-[#E50914] font-semibold'
                                        : 'text-white/80'
                                        }`}
                                >
                                    {track.label || track.language || `Track ${track.index}`}
                                    {track.language ? ` (${track.language})` : ''}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Subtitles */}
            <div className="relative">
                <button
                    onClick={() => {
                        if (subtitleTracks && subtitleTracks.length > 0) {
                            setShowSubtitleMenu(!showSubtitleMenu);
                        } else {
                            onSubtitleToggle();
                        }
                    }}
                    className={`transition-colors ${hasSubtitles || selectedSubtitleIndex !== null || showSubtitleMenu ? 'text-[#E50914]' : 'text-white hover:text-white/80'}`}
                    aria-label="Subtitles"
                >
                    <Captions size={22} />
                </button>

                {showSubtitleMenu && (
                    <div className="absolute bottom-full mb-3 right-0 bg-black/95 border border-white/10 rounded-lg shadow-2xl overflow-hidden min-w-[200px] z-50">
                        <div className="px-3 py-2 text-xs text-white/50 uppercase tracking-wider border-b border-white/10">
                            Subtitles
                        </div>

                        {/* Off Option */}
                        <button
                            onClick={() => {
                                onSubtitleTrackChange?.(null);
                                setShowSubtitleMenu(false);
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors ${selectedSubtitleIndex === null && !hasSubtitles
                                ? 'text-[#E50914] font-semibold'
                                : 'text-white/80'
                                }`}
                        >
                            Off
                        </button>

                        {/* Embedded Tracks */}
                        {subtitleTracks.map((track) => (
                            <button
                                key={track.index}
                                onClick={() => {
                                    onSubtitleTrackChange?.(track.index);
                                    setShowSubtitleMenu(false);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors ${selectedSubtitleIndex === track.index
                                    ? 'text-[#E50914] font-semibold'
                                    : 'text-white/80'
                                    }`}
                            >
                                {track.label || track.language || `Track ${track.index}`}
                                {track.codec ? ` (${track.codec})` : ''}
                            </button>
                        ))}

                        <div className="border-t border-white/10 my-1"></div>

                        {/* Load External */}
                        <button
                            onClick={() => {
                                onSubtitleToggle();
                                setShowSubtitleMenu(false);
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors ${hasSubtitles && selectedSubtitleIndex === null ? 'text-[#E50914]' : 'text-white/80'}`}
                        >
                            {hasSubtitles ? 'External Loaded' : 'Load External...'}
                        </button>
                    </div>
                )}
            </div>

            {/* Fullscreen */}
            <button
                onClick={onFullscreenToggle}
                className="text-white hover:text-white/80 transition-colors"
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
                {isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
            </button>
        </>
    ), [audioTracks, brightness, contrast, hasSubtitles, isFullscreen, onAudioTrackChange, onBrightnessChange, onContrastChange, onFullscreenToggle, onSubtitleToggle, onSubtitleTrackChange, selectedAudioIndex, selectedSubtitleIndex, showAudioMenu, showFilters, showSubtitleMenu, subtitleTracks]);

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    const bufferedPercent = duration > 0 ? (bufferedEnd / duration) * 100 : 0;
    const hoverPercent = hoverTime !== null && duration > 0 ? (hoverTime / duration) * 100 : null;

    return (
        <div
            className={`absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-500 ${isVisible || isScrubbing ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
            aria-label="Video controls"
            role="toolbar"
        >
            {/* Gradient backdrop */}
            <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />

            <div className="relative px-4 pb-3 pt-16">
                {/* ─── Progress Bar ─── */}
                <div
                    ref={progressRef}
                    className="group/progress relative w-full cursor-pointer py-2"
                    onMouseDown={handleProgressMouseDown}
                    onMouseMove={handleProgressMouseMove}
                    onMouseEnter={() => setIsHoveringProgress(true)}
                    onMouseLeave={() => {
                        setIsHoveringProgress(false);
                        setHoverTime(null);
                    }}
                    role="slider"
                    aria-label="Video progress"
                    aria-valuemin={0}
                    aria-valuemax={duration}
                    aria-valuenow={currentTime}
                    aria-valuetext={formatTime(currentTime)}
                    tabIndex={0}
                >
                    {/* Hover time tooltip */}
                    {hoverPercent !== null && isHoveringProgress && (
                        <div
                            className="absolute -top-8 transform -translate-x-1/2 bg-black/90 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap"
                            style={{ left: `${hoverPercent}%` }}
                        >
                            {formatTime(hoverTime!)}
                        </div>
                    )}

                    {/* Track background */}
                    <div
                        className={`relative w-full rounded-full overflow-hidden transition-all duration-200 ${isHoveringProgress || isScrubbing ? 'h-[6px]' : 'h-[3px]'
                            }`}
                    >
                        {/* Base track */}
                        <div className="absolute inset-0 bg-white/20 rounded-full" />

                        {/* Buffered range */}
                        <div
                            className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
                            style={{ width: `${bufferedPercent}%` }}
                        />

                        {/* Hover preview fill */}
                        {hoverPercent !== null && isHoveringProgress && (
                            <div
                                className="absolute inset-y-0 left-0 bg-white/20 rounded-full"
                                style={{ width: `${hoverPercent}%` }}
                            />
                        )}

                        {/* Played fill (Netflix red) */}
                        <div
                            className="absolute inset-y-0 left-0 bg-[#E50914] rounded-full"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>

                    {/* Scrub handle (red dot) */}
                    <div
                        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-[#E50914] shadow-lg transition-all duration-200 ${isHoveringProgress || isScrubbing
                            ? 'w-[14px] h-[14px] opacity-100'
                            : 'w-0 h-0 opacity-0'
                            }`}
                        style={{ left: `${progressPercent}%` }}
                    />
                </div>

                {/* ─── Control Row ─── */}
                <div className="flex items-center justify-between mt-1">
                    {/* Left controls */}
                    <div className="flex items-center gap-3">
                        {staticLeftControls}

                        {/* Time display */}
                        <div className="text-white/90 text-sm font-medium tabular-nums select-none ml-1">
                            <span>{formatTime(currentTime)}</span>
                            <span className="text-white/50 mx-1">/</span>
                            <span className="text-white/50">{formatRemaining(currentTime, duration)}</span>
                        </div>
                    </div>

                    {/* Right controls */}
                    <div className="flex items-center gap-3">
                        {staticRightControls}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(Controls);
