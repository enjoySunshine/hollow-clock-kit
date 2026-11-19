/**
 * Seek lab controller — the single entry point used by both the browser
 * preview page and the Node CLI. It owns the timelines (fast binary search
 * and the legacy linear walk built from the same configs), performs seeks
 * with release-to-landing timing, and verifies that both strategies return
 * identical segments/URLs/seconds.
 */

import { SegmentTimeline } from './segment-timeline.js';
import { LinearScanTimeline } from './legacy-scan.js';
import { TIMELINE_CONFIGS } from './timelines.js';

export const SEEK_MODES = {
    FAST: 'fast',
    LEGACY: 'legacy',
};

// 40 back-half drag points: 3765, 3855, ... 7275 (every 90 s).
export const DRAG_TIMES = Array.from({ length: 40 }, (_, i) => 3765 + i * 90);

// How many segments are scheduled from the landing one on each drag.
export const SEGMENTS_PER_DRAG = 13;

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function now() {
    // Available in browsers (window.performance) and Node (perf_hooks global
    // since Node 16); imported explicitly in the CLI when needed.
    return globalThis.performance.now();
}

export class SeekLab {
    constructor() {
        this.fast = {};
        this.legacy = {};
        for (const [key, config] of Object.entries(TIMELINE_CONFIGS)) {
            this.fast[key] = new SegmentTimeline(config);
            this.legacy[key] = new LinearScanTimeline(config);
        }
    }

    get keys() {
        return Object.keys(TIMELINE_CONFIGS);
    }

    /**
     * One seek, timed from "release" (call entry) to "landing" (resolved
     * segment). Mirrors the page measurement:
     *
     *   elapsedMs = performance.now() around the timeline lookup.
     *
     * @param {string} key       timeline key
     * @param {number} time      requested presentation seconds
     * @param {string} mode      SEEK_MODES.FAST | SEEK_MODES.LEGACY
     * @param {number} [count]   segments to schedule after landing
     */
    seek(key, time, mode = SEEK_MODES.FAST, count = SEGMENTS_PER_DRAG) {
        const timeline = this._timeline(key, mode);
        const start = now();
        const result = timeline.resolveWithNext(time, count);
        const elapsedMs = now() - start;

        if (!result) {
            return { key, mode, requestedTime: time, elapsedMs, result: null };
        }

        return {
            key,
            mode,
            requestedTime: time,
            elapsedMs,
            result: {
                landedTime: result.landedTime,
                inGap: result.inGap,
                gap: result.gap,
                segment: result.segment,
                sequence: result.sequence,
            },
        };
    }

    /**
     * The measured protocol from the requirement: one untimed warm-up click
     * on the same axis, then three timed runs; report all three and their
     * median. For gap landing use a single time; for the drag batch pass the
     * 40 drag times and every run walks all of them.
     *
     * @param {string} key
     * @param {number|number[]} times  one time or an array of drag times
     * @param {string} mode
     * @param {number} warmUpTime      untimed click performed first
     */
    measure(key, times, mode = SEEK_MODES.FAST, warmUpTime) {
        const list = Array.isArray(times) ? times : [times];
        const timeline = this._timeline(key, mode);

        // One untimed click somewhere else first.
        timeline.resolveWithNext(warmUpTime, SEGMENTS_PER_DRAG);

        const runs = [];
        for (let run = 0; run < 3; run++) {
            const t0 = now();
            for (const t of list) {
                timeline.resolveWithNext(t, SEGMENTS_PER_DRAG);
            }
            runs.push(now() - t0);
        }

        return {
            key,
            mode,
            points: list.length,
            runs,
            medianMs: median(runs),
            perPointMs: median(runs) / list.length,
        };
    }

    /**
     * Run the same seek through both strategies and confirm every returned
     * field matches. Throws on the first divergence.
     */
    assertParity(key, time, count = SEGMENTS_PER_DRAG) {
        const fast = this.fast[key].resolveWithNext(time, count);
        const old = this.legacy[key].resolveWithNext(time, count);

        const a = JSON.stringify(fast);
        const b = JSON.stringify(old);
        if (a !== b) {
            throw new Error(
                `parity failure on ${key} @ ${time}s\nfast:   ${a}\nlegacy: ${b}`
            );
        }
        return true;
    }

    /** Parity across every segment boundary and gap boundary of a timeline. */
    assertFullParity(key) {
        const fast = this.fast[key];
        const probes = [];
        for (const seg of fast.segments) {
            probes.push(seg.presentationStart);
            probes.push(seg.presentationStart + seg.duration / 2);
            probes.push(seg.presentationEnd - 0.001);
        }
        for (const gap of fast.gaps) {
            probes.push(gap.presentationStart);
            probes.push((gap.presentationStart + gap.presentationEnd) / 2);
            probes.push(gap.presentationEnd - 0.001);
        }
        for (const t of probes) {
            this.assertParity(key, t);
        }
        return probes.length;
    }

    _timeline(key, mode) {
        const set = mode === SEEK_MODES.LEGACY ? this.legacy : this.fast;
        if (!set[key]) {
            throw new Error(`unknown timeline "${key}"`);
        }
        return set[key];
    }
}
