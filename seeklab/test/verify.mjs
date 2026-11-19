/**
 * Exhaustive checkpoint verification for every hand-checked number in the
 * requirement, plus timing measurements for the two performance limits:
 *
 *   - gap landing (after one warm-up click): median of 3 < 2 ms
 *   - the 40 back-half drags (after one warm-up): median of 3 < 200 ms
 *
 * Run: node test/verify.mjs
 */

import { performance } from 'node:perf_hooks';
import {
    createMainVideoTimeline,
    createMainAudioTimeline,
    createMixedDurationTimeline,
    createNegativeRepeatTimeline,
    createOffsetTimeline,
} from '../src/timelines.js';
import { SeekLab, SEEK_MODES, DRAG_TIMES } from '../src/lab.js';

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
    checks++;
    const ok = Object.is(actual, expected);
    if (!ok) {
        failures++;
        console.error(`  FAIL ${label}\n       expected: ${expected}\n       actual:   ${actual}`);
    }
}

function checkClose(label, actual, expected, epsilon = 1e-9) {
    checks++;
    const ok = Math.abs(actual - expected) <= epsilon;
    if (!ok) {
        failures++;
        console.error(`  FAIL ${label}\n       expected: ${expected} (+/-${epsilon})\n       actual:   ${actual}`);
    }
}

function checkNull(label, value) {
    check(label, value, null);
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

// ---------------------------------------------------------------------------
// Main timeline (video v1)
// ---------------------------------------------------------------------------
console.log('main timeline (v1)');
const video = createMainVideoTimeline();

check('main segment count = 3600', video.segmentCount, 3600);
checkClose('main last media time = 7320 s', video.mediaTimeOfLastSegmentEnd, 7320);
check('main has exactly one gap', video.gaps.length, 1);
checkClose('gap starts at 3600 s', video.gaps[0].presentationStart, 3600);
checkClose('gap ends at 3720 s', video.gaps[0].presentationEnd, 3720);
checkClose('gap duration 120 s', video.gaps[0].duration, 120);

// 3600 s and 3601 s match no segment directly (both sit in the hole).
const seek3600 = video.resolve(3600);
const seek3601 = video.resolve(3601);
check('3600 s has no containing segment (in gap)', seek3600.inGap, true);
check('3601 s has no containing segment (in gap)', seek3601.inGap, true);

// The seek itself lands on the first playable segment after the hole.
const gapSeek = seek3601;
check('3601 seek lands in gap', gapSeek.inGap, true);
checkClose('3601 seek landed time = 3720.001', gapSeek.landedTime, 3720.001);
check('landed segment 序号 = 1800', gapSeek.segment.index, 1800);
checkClose('landed segment start = 3720 s', gapSeek.segment.presentationStart, 3720);
checkClose('landed segment duration = 2 s', gapSeek.segment.duration, 2);
check('landed segment url', gapSeek.segment.url, 'media-v1-334800000.m4s');
check('landed segment 编号 = 1801', gapSeek.segment.number, 1801);

// The 3600 s seek lands on the same playable position.
const gapSeek3600 = seek3600;
check('3600 seek lands in gap', gapSeek3600.inGap, true);
checkClose('3600 seek landed time = 3720.001', gapSeek3600.landedTime, 3720.001);
check('3600 landed segment 序号 = 1800', gapSeek3600.segment.index, 1800);

// 3599.99 s -> segment 序号 1799.
const beforeHole = video.resolve(3599.99);
check('3599.99 not in gap', beforeHole.inGap, false);
check('3599.99 segment 序号 = 1799', beforeHole.segment.index, 1799);
checkClose('3599.99 segment start = 3598 s', beforeHole.segment.presentationStart, 3598);
checkClose('3599.99 segment duration = 2 s', beforeHole.segment.duration, 2);
check('3599.99 segment url', beforeHole.segment.url, 'media-v1-323820000.m4s');

// Boundary neighbours of the hole stay exactly as declared.
const lastBefore = video.getSegmentByIndex(1799);
checkClose('segment 1799 start 3598', lastBefore.presentationStart, 3598);
checkClose('segment 1799 end 3600', lastBefore.presentationEnd, 3600);
const firstAfter = video.getSegmentByIndex(1800);
checkClose('segment 1800 start 3720', firstAfter.presentationStart, 3720);

// Boundary semantics: half-open [start, end), gap edges, media end, clamp.
const exactStart = video.resolve(3720);
check('3720 exact start is a direct hit', exactStart.inGap, false);
check('3720 exact start 序号 = 1800', exactStart.segment.index, 1800);
check('3720 landed time unchanged', exactStart.landedTime, 3720);
const boundary2 = video.resolve(2);
check('2 s boundary -> 序号 1', boundary2.segment.index, 1);
const lastTickInHole = video.resolve(3719.999);
check('3719.999 still in gap', lastTickInHole.inGap, true);
checkClose('3719.999 lands 3720.001', lastTickInHole.landedTime, 3720.001);
const lastSeg = video.resolve(7319.999);
check('7319.999 -> last 序号 3599', lastSeg.segment.index, 3599);
checkNull('7320 (media end) -> null', video.resolve(7320));
checkNull('beyond media -> null', video.resolve(99999));
const beforeFirst = video.resolve(-5);
check('before first clamps to 序号 0', beforeFirst.segment.index, 0);
checkClose('before first landed at 0', beforeFirst.landedTime, 0);

// Every segment keeps its declared 2 s duration and start/duration are intact.
for (const s of video.segments) {
    checkClose(`segment ${s.index} duration 2s`, s.duration, 2);
}

// First segment.
const seg0 = video.getSegmentByIndex(0);
checkClose('segment 0 start 0', seg0.presentationStart, 0);
check('segment 0 number 1', seg0.number, 1);
check('segment 0 url', seg0.url, 'media-v1-0.m4s');

// ---------------------------------------------------------------------------
// 40 back-half drag points: 3765, 3855, ... 7275
// ---------------------------------------------------------------------------
console.log('40 back-half drag points');
const dragTimes = Array.from({ length: 40 }, (_, i) => 3765 + i * 90);
check('drag point count = 40', dragTimes.length, 40);
check('first drag time', dragTimes[0], 3765);
check('last drag time', dragTimes[39], 7275);

// First point: 3765 -> 序号 1822, start 3764, url ...338760000
const firstDrag = video.resolve(dragTimes[0]);
check('3765 segment 序号 = 1822', firstDrag.segment.index, 1822);
checkClose('3765 segment start = 3764', firstDrag.segment.presentationStart, 3764);
check('3765 segment url', firstDrag.segment.url, 'media-v1-338760000.m4s');

// 12th segment after the containing one (index +12): 序号 1834.
const firstDragWithNext = video.resolveWithNext(dragTimes[0], 13);
check('3765 sequence length 13', firstDragWithNext.sequence.length, 13);
check('3765 12th-after 序号 = 1834', firstDragWithNext.sequence[12].index, 1834);
checkClose('3765 12th-after start = 3788', firstDragWithNext.sequence[12].presentationStart, 3788);
check('3765 12th-after url', firstDragWithNext.sequence[12].url, 'media-v1-340920000.m4s');

// Last point: 7275 -> 序号 3577, start 7274, url ...654660000
const lastDrag = video.resolve(dragTimes[39]);
check('7275 segment 序号 = 3577', lastDrag.segment.index, 3577);
checkClose('7275 segment start = 7274', lastDrag.segment.presentationStart, 7274);
check('7275 segment url', lastDrag.segment.url, 'media-v1-654660000.m4s');

// All 40: behind the 120 s hole (60 missing 2 s slots) the index is
// floor(t/2) - 60: 3765 -> 1822, 7275 -> 3577.
for (const t of dragTimes) {
    const r = video.resolveWithNext(t, 13);
    const expectedIndex = Math.floor(t / 2) - 60;
    check(`drag ${t} 序号 = ${expectedIndex}`, r.segment.index, expectedIndex);
    checkClose(`drag ${t} start`, r.segment.presentationStart, (expectedIndex - 1800) * 2 + 3720);
    checkClose(`drag ${t} duration 2s`, r.segment.duration, 2);
    check(`drag ${t} gives 13 segments`, r.sequence.length, 13);
    check(`drag ${t} last sequence index`, r.sequence[12].index, expectedIndex + 12);
    // Starts must be contiguous 2 s steps (no gap inside the back half).
    for (let i = 1; i < r.sequence.length; i++) {
        checkClose(`drag ${t} sequence contiguity ${i}`,
            r.sequence[i].presentationStart - r.sequence[i - 1].presentationStart, 2);
    }
}

// ---------------------------------------------------------------------------
// Audio track a1 on the same axis; both buffers schedule the same segment
// ---------------------------------------------------------------------------
console.log('audio track (a1)');
const audio = createMainAudioTimeline();
check('audio segment count = 3600', audio.segmentCount, 3600);
checkClose('audio last media time = 7320', audio.mediaTimeOfLastSegmentEnd, 7320);

const audioLanding = audio.resolve(3720.001);
check('audio landed 序号 = 1800', audioLanding.segment.index, 1800);
checkClose('audio landed start = 3720', audioLanding.segment.presentationStart, 3720);
check('audio url', audioLanding.segment.url, 'snd-a1-334800000.m4s');
check('audio 编号 = 1801', audioLanding.segment.number, 1801);

const videoLanding = video.resolve(3720.001);
// The first segment handed to both schedulers must be identical in position.
check('a/v first scheduled index equal', audioLanding.segment.index, videoLanding.segment.index);
check('a/v first scheduled start equal',
    audioLanding.segment.presentationStart, videoLanding.segment.presentationStart);

const audioSeq = audio.resolveWithNext(3720.001, 13).sequence;
const videoSeq = video.resolveWithNext(3720.001, 13).sequence;
for (let i = 0; i < 13; i++) {
    check(`a/v sequence ${i} same index`, audioSeq[i].index, videoSeq[i].index);
    check(`a/v sequence ${i} same start`, audioSeq[i].presentationStart, videoSeq[i].presentationStart);
}

// ---------------------------------------------------------------------------
// Timeline 2: mixed durations, 101.1 s total
// ---------------------------------------------------------------------------
console.log('mixed-duration timeline');
const mixed = createMixedDurationTimeline();
check('mixed segment count = 26', mixed.segmentCount, 26);
checkClose('mixed last media time = 101.1', mixed.mediaTimeOfLastSegmentEnd, 101.1);
check('mixed no gaps', mixed.gaps.length, 0);

const m53 = mixed.resolve(53);
check('53 s 序号 = 13', m53.segment.index, 13);
checkClose('53 s start = 52.052', m53.segment.presentationStart, 52.052);
checkClose('53 s duration = 4.004', m53.segment.duration, 4.004);
check('53 s url', m53.segment.url, 'media-v1-4684680.m4s');

const m1002 = mixed.resolve(100.2);
check('100.2 s 序号 = 25', m1002.segment.index, 25);
checkClose('100.2 s start = 100.1', m1002.segment.presentationStart, 100.1);
checkClose('100.2 s duration = 1', m1002.segment.duration, 1);
check('100.2 s url', m1002.segment.url, 'media-v1-9009000.m4s');

for (let i = 0; i < 25; i++) {
    checkClose(`mixed segment ${i} duration 4.004`, mixed.getSegmentByIndex(i).duration, 4.004);
}
checkClose('mixed segment 25 duration 1', mixed.getSegmentByIndex(25).duration, 1);

// ---------------------------------------------------------------------------
// Timeline 3: negative @r repeating exactly onto the next S element
// ---------------------------------------------------------------------------
console.log('negative-r timeline');
const negR = createNegativeRepeatTimeline();
check('negR segment count = 51', negR.segmentCount, 51);
checkClose('negR last media time = 51', negR.mediaTimeOfLastSegmentEnd, 51);
check('negR no gaps', negR.gaps.length, 0);

const n495 = negR.resolve(49.5);
check('49.5 s 序号 = 49', n495.segment.index, 49);
checkClose('49.5 s duration = 1', n495.segment.duration, 1);
check('49.5 s url', n495.segment.url, 'seg-4900.m4s');

// The last repeated segment must end exactly on the next S element (5000).
const seg49 = negR.getSegmentByIndex(49);
checkClose('segment 49 start 4900 units', seg49.manifestTime, 4900);
checkClose('segment 49 media end 50 s', seg49.mediaEnd, 50);
const seg50 = negR.getSegmentByIndex(50);
checkClose('segment 50 starts exactly at 50 s', seg50.presentationStart, 50);
for (let i = 0; i < 51; i++) {
    checkClose(`negR segment ${i} duration 1s`, negR.getSegmentByIndex(i).duration, 1);
}

// ---------------------------------------------------------------------------
// Timeline 4: period start 100 s, PTO 8 s
// ---------------------------------------------------------------------------
console.log('offset timeline');
const offset = createOffsetTimeline();
check('offset segment count = 10', offset.segmentCount, 10);
// Media spans 0..20 s; presentation = media + (100 - 8) = media + 92.
checkClose('offset media end = 20 s', offset.getSegmentByIndex(9).mediaEnd, 20);
checkClose('offset last segment presentation end = 112', offset.mediaTimeOfLastSegmentEnd, 112);
checkClose('offset first segment presentation start = 92', offset.getSegmentByIndex(0).presentationStart, 92);
checkClose('offset first segment media start = 0', offset.getSegmentByIndex(0).mediaStart, 0);

const o100 = offset.resolve(100);
check('100 s 序号 = 4', o100.segment.index, 4);
checkClose('100 s presentation start = 100', o100.segment.presentationStart, 100);
checkClose('100 s media time = 8', o100.segment.mediaStart, 8);
check('100 s url', o100.segment.url, 'a-720000.m4s');
check('100 s 编号 = 5', o100.segment.number, 5);
checkClose('offset segment duration 2s', o100.segment.duration, 2);

// ---------------------------------------------------------------------------
// Timing: warm-up once, then three measured runs; median must beat the limit.
// ---------------------------------------------------------------------------
console.log('timing');

// Gap landing (one click elsewhere first, untimed, then drag to 3601).
video.resolve(100); // warm-up click at another position, not recorded
const gapRuns = [];
for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    const r = video.resolve(3601);
    const elapsed = performance.now() - t0;
    if (r.landedTime !== 3720.001) {
        throw new Error('gap landing returned wrong result during timing');
    }
    gapRuns.push(elapsed);
}
const gapMedian = median(gapRuns);
console.log(`  gap landing runs (ms): ${gapRuns.map((x) => x.toFixed(4)).join(', ')}`);
console.log(`  gap landing median: ${gapMedian.toFixed(4)} ms (limit 2 ms)`);
check('gap landing median < 2 ms', gapMedian < 2, true);

// 40 back-half drags as one batch; warm-up batch first, then three measured.
video.resolveWithNext(1234, 13); // one warm-up click
const batchRuns = [];
for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    for (const t of dragTimes) {
        video.resolveWithNext(t, 13);
    }
    batchRuns.push(performance.now() - t0);
}
const batchMedian = median(batchRuns);
console.log(`  40-drag batch runs (ms): ${batchRuns.map((x) => x.toFixed(4)).join(', ')}`);
console.log(`  40-drag batch median: ${batchMedian.toFixed(4)} ms (limit 200 ms)`);
check('40-drag median < 200 ms', batchMedian < 200, true);

// ---------------------------------------------------------------------------
// Fast vs legacy: identical results on every boundary/gap probe, and the
// legacy linear walk is observably slower on the same machine.
// ---------------------------------------------------------------------------
console.log('fast/legacy parity');
const lab = new SeekLab();
let probeTotal = 0;
for (const key of lab.keys) {
    const probes = lab.assertFullParity(key);
    probeTotal += probes;
    console.log(`  ${key}: ${probes} probe points identical`);
}
check('parity probes > 0', probeTotal > 0, true);

// The specific checkpoint seeks must match through both paths.
for (const [key, t] of [
    ['mainVideo', 3601],
    ['mainVideo', 3720.001],
    ['mainVideo', 3599.99],
    ['mainVideo', 3765],
    ['mainVideo', 7275],
    ['mainAudio', 3720.001],
    ['mixed', 53],
    ['mixed', 100.2],
    ['negativeRepeat', 49.5],
    ['offset', 100],
]) {
    lab.assertParity(key, t);
}
check('checkpoint parity all equal', true, true);

// Legacy path measured with the same protocol (it must give the same answers;
// its cost is reported to show why the old seek was slow).
const legacyGap = lab.measure('mainVideo', 3601, SEEK_MODES.LEGACY, 100);
const legacyBatch = lab.measure('mainVideo', DRAG_TIMES, SEEK_MODES.LEGACY, 1234);
console.log(`  legacy gap landing median: ${legacyGap.medianMs.toFixed(4)} ms (fast: ${gapMedian.toFixed(4)} ms)`);
console.log(`  legacy 40-drag median:     ${legacyBatch.medianMs.toFixed(4)} ms (fast: ${batchMedian.toFixed(4)} ms)`);
check('legacy returns same answer (parity above)', true, true);
check('fast gap landing beats legacy', gapMedian <= legacyGap.medianMs, true);
check('fast batch beats legacy', batchMedian <= legacyBatch.medianMs, true);

console.log(`\n${checks} checks, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
