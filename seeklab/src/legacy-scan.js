/**
 * Legacy seek path, kept for side-by-side comparison.
 *
 * This mirrors dash.js 5.3.0's TimelineSegmentsGetter.getSegmentByTime():
 * every call re-walks the SegmentTimeline S elements from the beginning,
 * expanding @r repeats (including negative @r) and testing each concrete
 * segment in order — O(total segments) per seek, exactly like
 * _iterateSegments() in src/dash/utils/TimelineSegmentsGetter.js.
 *
 * It also mirrors the gap recovery the GapController drives on its 250 ms
 * polling interval: a seek that lands on no segment keeps scanning forward
 * until the next playable segment, then lands on its start + 0.001 s.
 *
 * The returned values are identical to SegmentTimeline.resolve(); the only
 * difference is the cost. Nothing in the production path uses this file.
 */

import { processUriTemplate } from './uri-template.js';

const GAP_LANDING_EPSILON_SECONDS = 0.001;

function precisionRound(value) {
    return parseFloat(value.toPrecision(15));
}

export class LinearScanTimeline {
    constructor(config) {
        if (!config || !Array.isArray(config.s)) {
            throw new Error('LinearScanTimeline: config.s (S elements) is required');
        }
        this.config = config;
        this.id = config.id;
        this.timescale = config.timescale;
        this.mediaTemplate = config.mediaTemplate;
        this.startNumber = config.startNumber ?? 1;
        this.periodStart = config.periodStart ?? 0;
        this.presentationTimeOffset = config.presentationTimeOffset ?? 0;
        this.bandwidth = config.bandwidth;
    }

    /**
     * One full linear walk, re-derived on every call (dash.js does not cache
     * the flattened timeline either; negative @r is recomputed each time).
     *
     * @returns {Array<object>} concrete segments in timeline order
     * @private
     */
    _walk() {
        const { s: sElements, timescale } = this.config;
        const windowEndUnits = this.config.windowEnd === undefined
            ? undefined
            : Math.round((this.config.windowEnd - this.periodStart + this.presentationTimeOffset) * timescale);

        const segments = [];
        let mediaTime = 0;

        for (let i = 0; i < sElements.length; i++) {
            const element = sElements[i];

            if (element.t !== undefined) {
                mediaTime = element.t;
            }

            let repeat = element.r ?? 0;
            if (repeat < 0) {
                const next = sElements[i + 1];
                const boundaryUnits = next && next.t !== undefined
                    ? next.t
                    : windowEndUnits;
                const scaledTime = mediaTime / timescale;
                repeat = Math.max(
                    Math.ceil((boundaryUnits / timescale - scaledTime) / (element.d / timescale)) - 1,
                    0
                );
            }

            const firstT = mediaTime;
            for (let j = 0; j <= repeat; j++) {
                const index = segments.length;
                const manifestT = j === 0 ? firstT : mediaTime;
                const mediaStart = mediaTime / timescale;
                segments.push({
                    index,
                    startUnits: mediaTime,
                    endUnits: mediaTime + element.d,
                    durationUnits: element.d,
                    manifestT,
                    mediaStart,
                    mediaEnd: (mediaTime + element.d) / timescale,
                    presentationStart: mediaStart + this.periodStart - this.presentationTimeOffset,
                    presentationEnd: mediaStart + this.periodStart - this.presentationTimeOffset + element.d / timescale,
                });
                mediaTime += element.d;
            }
        }

        return segments;
    }

    get segmentCount() {
        return this._walk().length;
    }

    /**
     * Linear O(n) lookup: same result shape as SegmentTimeline.resolve().
     */
    resolve(presentationTime) {
        const segments = this._walk();
        if (segments.length === 0) {
            return null;
        }

        const targetUnits = Math.round(
            precisionRound((presentationTime - this.periodStart + this.presentationTimeOffset) * this.timescale)
        );

        // First segment covers (or follows) the time?
        let containing = null;
        let nextAfterGap = null;

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (targetUnits >= seg.startUnits && targetUnits < seg.endUnits) {
                containing = seg;
                break;
            }
            // First segment starting after the target: the gap landing.
            if (seg.startUnits > targetUnits && nextAfterGap === null) {
                nextAfterGap = seg;
            }
        }

        if (containing) {
            return {
                segment: this._view(containing),
                requestedTime: presentationTime,
                landedTime: presentationTime,
                inGap: false,
                gap: null,
            };
        }

        if (nextAfterGap) {
            const previous = segments[segments.indexOf(nextAfterGap) - 1];
            const gap = previous
                ? {
                    presentationStart: previous.presentationEnd,
                    presentationEnd: nextAfterGap.presentationStart,
                    duration: nextAfterGap.presentationStart - previous.presentationEnd,
                }
                : null;
            return {
                segment: this._view(nextAfterGap),
                requestedTime: presentationTime,
                landedTime: nextAfterGap.presentationStart + GAP_LANDING_EPSILON_SECONDS,
                inGap: true,
                gap,
            };
        }

        return null;
    }

    resolveWithNext(presentationTime, count = 13) {
        const result = this.resolve(presentationTime);
        if (!result) {
            return null;
        }
        const segments = this._walk();
        const sequence = [];
        for (let i = 0; i < count; i++) {
            const seg = segments[result.segment.index + i];
            if (seg) {
                sequence.push(this._view(seg));
            }
        }
        return { ...result, sequence };
    }

    _view(segment) {
        const number = this.startNumber + segment.index;
        const url = processUriTemplate(this.mediaTemplate, {
            representationId: this.id,
            number,
            time: segment.manifestT,
            bandwidth: this.bandwidth,
        });
        return {
            index: segment.index,
            number,
            presentationStart: segment.presentationStart,
            presentationEnd: segment.presentationEnd,
            duration: segment.durationUnits / this.timescale,
            mediaStart: segment.mediaStart,
            mediaEnd: segment.mediaEnd,
            manifestTime: segment.manifestT,
            url,
        };
    }
}
