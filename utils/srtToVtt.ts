export function srtToVtt(srt: string): string {
    // Basic SRT to VTT converter
    // 1. Remove CRLF
    // 2. Replace commas in timestamps with dots (00:00:00,000 -> 00:00:00.000)
    // 3. Trim whitespace
    // 4. Add WEBVTT header

    if (!srt) return 'WEBVTT\n\n';

    const vtt = srt
        .replace(/\r\n/g, '\n') // Normalize newlines
        .replace(/\r/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2') // Fix timestamps
        .trim();

    return `WEBVTT\n\n${vtt}`;
}
