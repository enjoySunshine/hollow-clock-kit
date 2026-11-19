/**
 * The four verified timelines, encoded exactly to the checked values:
 *
 *  1. main   - 90000 timescale, 180000-unit (2 s) segments, a two-minute
 *              hole between 3600 s and 3720 s, 1800 segments before it and
 *              1800 after. Video "v1" and audio "a1" share the same axis.
 *  2. mixed  - timescale 90000, 25 segments of 360360 units (4.004 s) plus a
 *              final 90000-unit (1 s) segment, total 101.1 s.
 *  3. negR   - timescale 100, 100-unit segments with @r=-1 repeating until
 *              the next S element at 5000; the last repeated segment ends
 *              exactly on 5000, plus the second segment, total 51 s.
 *  4. offset - timescale 90000, 10 segments of 2 s, period start 100 s and
 *              presentationTimeOffset 8 s, window coverage starts at
 *              presentation 100 s (media 0).
 *
 * Every number below is taken from the hand-verified checkpoints; the test
 * suite (test/verify.mjs) asserts all of them.
 */

import { SegmentTimeline } from './segment-timeline.js';

const TIMESCALE_90K = 90000;
const SEG_2S = 180000;

/**
 * Raw SegmentTimeline configs. Both the binary-search engine and the legacy
 * linear scanner are built from these exact same objects, so a result
 * difference can only come from the lookup strategy, never the data.
 */
export const TIMELINE_CONFIGS = {
    mainVideo: {
        id: 'v1',
        timescale: TIMESCALE_90K,
        mediaTemplate: 'media-$RepresentationID$-$Time$.m4s',
        startNumber: 1,
        periodStart: 0,
        presentationTimeOffset: 0,
        windowEnd: 7320,
        s: [
            // First 1800 segments, media times 0 .. 3598 (2 s each).
            { t: 0, d: SEG_2S, r: 1799 },
            // Explicit @t after the 120 s hole: media 3720 .. 7318.
            { t: 3720 * TIMESCALE_90K, d: SEG_2S, r: 1799 },
        ],
    },
    mainAudio: {
        id: 'a1',
        timescale: TIMESCALE_90K,
        mediaTemplate: 'snd-$RepresentationID$-$Time$.m4s',
        startNumber: 1,
        periodStart: 0,
        presentationTimeOffset: 0,
        windowEnd: 7320,
        s: [
            { t: 0, d: SEG_2S, r: 1799 },
            { t: 3720 * TIMESCALE_90K, d: SEG_2S, r: 1799 },
        ],
    },
    mixed: {
        id: 'v1',
        timescale: TIMESCALE_90K,
        mediaTemplate: 'media-$RepresentationID$-$Time$.m4s',
        startNumber: 1,
        periodStart: 0,
        presentationTimeOffset: 0,
        windowEnd: 101.1,
        s: [
            // 25 repeats: media 0 .. 100.1, last one ends at 100.1.
            { t: 0, d: 360360, r: 24 },
            // Final 1 s segment, media 100.1 .. 101.1.
            { t: 9009000, d: 90000 },
        ],
    },
    negativeRepeat: {
        id: 'v1',
        timescale: 100,
        mediaTemplate: 'seg-$Time$.m4s',
        startNumber: 1,
        periodStart: 0,
        presentationTimeOffset: 0,
        windowEnd: 51,
        s: [
            { t: 0, d: 100, r: -1 },
            { t: 5000, d: 100 },
        ],
    },
    offset: {
        id: 'a1',
        timescale: TIMESCALE_90K,
        mediaTemplate: 'a-$Time$.m4s',
        startNumber: 1,
        periodStart: 100,
        presentationTimeOffset: 8,
        windowStart: 100,
        windowEnd: 112,
        s: [
            { t: 0, d: SEG_2S, r: 9 },
        ],
    },
};

/**
 * Main timeline: segments at media [0,3600) and [3720,7320), a 120 s gap.
 * 3600 segments in total, final media time 7320 s.
 */
export function createMainVideoTimeline() {
    return new SegmentTimeline(TIMELINE_CONFIGS.mainVideo);
}

/**
 * Audio track on the same axis: same S elements, own id/template.
 * First scheduled segment after landing at 3720.001 must be the same
 * segment (index 1800) as video.
 */
export function createMainAudioTimeline() {
    return new SegmentTimeline(TIMELINE_CONFIGS.mainAudio);
}

/**
 * 101.1 s timeline: 25 x 4.004 s (360360 units) then 1 x 1 s (90000 units).
 * 26 segments, final media time 101.1 s.
 */
export function createMixedDurationTimeline() {
    return new SegmentTimeline(TIMELINE_CONFIGS.mixed);
}

/**
 * 51 s timeline: timescale 100, @r=-1 repeats 100-unit segments until the
 * next S element starts at 5000 (50 s); its last segment ends exactly on
 * 5000. One more 1 s segment gives 51 segments and 51 s total.
 */
export function createNegativeRepeatTimeline() {
    return new SegmentTimeline(TIMELINE_CONFIGS.negativeRepeat);
}

/**
 * Offset timeline: period starts at presentation 100 s, PTO 8 s, 10
 * segments of 2 s (media 0 .. 20). Presentation coverage is 92 s..112 s
 * with media time = presentation - 92; at presentation 100 s media = 8 s.
 */
export function createOffsetTimeline() {
    return new SegmentTimeline(TIMELINE_CONFIGS.offset);
}

export function createAllTimelines() {
    const video = createMainVideoTimeline();
    const audio = createMainAudioTimeline();
    return {
        mainVideo: video,
        mainAudio: audio,
        mixed: createMixedDurationTimeline(),
        negativeRepeat: createNegativeRepeatTimeline(),
        offset: createOffsetTimeline(),
    };
}
