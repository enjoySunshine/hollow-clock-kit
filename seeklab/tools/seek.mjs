#!/usr/bin/env node
/**
 * Node entry point for the seek lab — the exact same engine and timelines
 * the preview page runs (src/lab.js), so the index/url/seconds printed here
 * match the page's landing result field for field.
 *
 * Usage:
 *   node tools/seek.mjs list
 *   node tools/seek.mjs seek <timeline> <seconds> [--legacy] [--count N]
 *   node tools/seek.mjs measure [--timeline mainVideo]
 *   node tools/seek.mjs parity
 *
 * Timelines: mainVideo, mainAudio, mixed, negativeRepeat, offset
 */

import { performance } from 'node:perf_hooks';
import { SeekLab, SEEK_MODES, DRAG_TIMES, SEGMENTS_PER_DRAG } from '../src/lab.js';

// Node's perf_hooks does not install a global automatically on every setup;
// lab.js reads globalThis.performance, so wire it once here.
if (!globalThis.performance) {
    globalThis.performance = performance;
}

const lab = new SeekLab();
const [command, ...args] = process.argv.slice(2);

function parseFlags(argv) {
    const flags = { legacy: false, count: SEGMENTS_PER_DRAG, timeline: 'mainVideo' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--legacy') {
            flags.legacy = true;
        } else if (argv[i] === '--count') {
            flags.count = Number(argv[++i]);
        } else if (argv[i] === '--timeline') {
            flags.timeline = argv[++i];
        }
    }
    return flags;
}

function printSeek(out) {
    if (!out || !out.result) {
        console.log(`no playable segment at ${out ? out.requestedTime : '?'} s`);
        return;
    }
    const r = out.result;
    const s = r.segment;
    console.log(`timeline        : ${out.key} (${out.mode})`);
    console.log(`requested (s)   : ${out.requestedTime}`);
    console.log(`landed (s)      : ${r.landedTime}${r.inGap ? `  [gap ${r.gap.presentationStart}..${r.gap.presentationEnd}]` : ''}`);
    console.log(`elapsed (ms)    : ${out.elapsedMs.toFixed(4)}`);
    console.log(`segment 序号    : ${s.index}`);
    console.log(`segment 编号    : ${s.number}`);
    console.log(`start (s)       : ${s.presentationStart}`);
    console.log(`duration (s)    : ${s.duration}`);
    console.log(`media time (s)  : ${s.mediaStart}`);
    console.log(`url             : ${s.url}`);
    if (r.sequence.length > 1) {
        console.log(`next ${r.sequence.length - 1} scheduled:`);
        for (let i = 1; i < r.sequence.length; i++) {
            const seg = r.sequence[i];
            console.log(`  +${String(i).padStart(2, ' ')} 序号 ${seg.index}  start ${seg.presentationStart}  ${seg.url}`);
        }
    }
}

switch (command) {
    case 'list': {
        for (const key of lab.keys) {
            const t = lab.fast[key];
            const gaps = t.gaps.map((g) => `${g.presentationStart}..${g.presentationEnd}`).join(', ');
            console.log(
                `${key.padEnd(16)} segments=${t.segmentCount}  end=${t.mediaTimeOfLastSegmentEnd}s` +
                (gaps ? `  gaps=[${gaps}]` : '')
            );
        }
        break;
    }

    case 'seek': {
        const key = args[0];
        const time = Number(args[1]);
        const flags = parseFlags(args.slice(2));
        if (!key || Number.isNaN(time)) {
            console.error('usage: seek <timeline> <seconds> [--legacy] [--count N]');
            process.exit(2);
        }
        const out = lab.seek(key, time, flags.legacy ? SEEK_MODES.LEGACY : SEEK_MODES.FAST, flags.count);
        printSeek(out);
        break;
    }

    case 'measure': {
        const flags = parseFlags(args);
        const key = flags.timeline;
        console.log(`measurement protocol on "${key}" (warm-up click, then 3 timed runs; median reported)\n`);

        // Gap landing: warm-up click at 100 s, then seeks to 3601 s.
        for (const mode of [SEEK_MODES.FAST, SEEK_MODES.LEGACY]) {
            const m = lab.measure(key, 3601, mode, 100);
            console.log(
                `gap landing  ${mode.padEnd(6)} runs=[${m.runs.map((x) => x.toFixed(4)).join(', ')}] ms` +
                `  median=${m.medianMs.toFixed(4)} ms  limit 2 ms  ${m.medianMs < 2 ? 'PASS' : 'FAIL'}`
            );
        }

        // 40 back-half drags: warm-up click at 1234 s, then all 40 points.
        for (const mode of [SEEK_MODES.FAST, SEEK_MODES.LEGACY]) {
            const m = lab.measure(key, DRAG_TIMES, mode, 1234);
            console.log(
                `40 drags     ${mode.padEnd(6)} runs=[${m.runs.map((x) => x.toFixed(4)).join(', ')}] ms` +
                `  median=${m.medianMs.toFixed(4)} ms  limit 200 ms  ${m.medianMs < 200 ? 'PASS' : 'FAIL'}`
            );
        }
        break;
    }

    case 'parity': {
        let total = 0;
        for (const key of lab.keys) {
            const n = lab.assertFullParity(key);
            total += n;
            console.log(`${key.padEnd(16)} parity OK over ${n} probe points`);
        }
        console.log(`\nall ${total} probes identical between fast and legacy paths`);
        break;
    }

    default:
        console.error('commands: list | seek <timeline> <seconds> [--legacy] [--count N] | measure [--timeline mainVideo] | parity');
        process.exit(2);
}
