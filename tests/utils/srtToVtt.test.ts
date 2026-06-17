import { expect, test, describe } from "bun:test";
import { srtToVtt } from "@/utils/srtToVtt";

describe("srtToVtt", () => {
  test("converts basic SRT to VTT correctly", () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Subtitle text`;
    const expected = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Subtitle text`;
    expect(srtToVtt(srt)).toBe(expected);
  });

  test("handles multiple cues", () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
First line

2
00:00:05,000 --> 00:00:08,000
Second line`;
    const expected = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
First line

2
00:00:05.000 --> 00:00:08.000
Second line`;
    expect(srtToVtt(srt)).toBe(expected);
  });

  test("normalizes CRLF to LF", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:04,000\r\nSubtitle text";
    const expected = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Subtitle text`;
    expect(srtToVtt(srt)).toBe(expected);
  });

  test("handles empty input", () => {
    expect(srtToVtt("")).toBe("WEBVTT\n\n");
  });

  test("handles whitespace only input", () => {
    expect(srtToVtt("   \n   ")).toBe("WEBVTT\n\n");
  });

  test("handles timestamps with hours", () => {
     const srt = `1
01:30:00,500 --> 01:30:04,500
Subtitle text`;
    const expected = `WEBVTT

1
01:30:00.500 --> 01:30:04.500
Subtitle text`;
    expect(srtToVtt(srt)).toBe(expected);
  });
});
