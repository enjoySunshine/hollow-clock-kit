/**
 * SegmentTimeline seek engine.
 *
 * This is the fast timeline the preview page and the Node tooling share.
 * It models the same SegmentTimeline semantics as dash.js's
 * TimelineSegmentsGetter / TimelineConverter:
 *
 *   - S elements with @t (start time in timescale units), @d (duration),
 *     optional @r (repeat count, possibly negative);
 *   - explicit @t on a later S element creates a gap (or overlap) so every
 *     segment keeps its own declared start time and duration;
 *   - negative @r repeats until the start of the next S element / the end
 *     of the coverage window, and the last repeated segment ends exactly on
 *     that boundary;
 *   - presentation time = media time + periodStart - presentationTimeOffset;
 *   - replacement number = startNumber + zero-based segment index;
 *   - media URLs are expanded from the SegmentTemplate @media template with
 *     the segment's $Time$ (manifest t) and replacement $Number$.
 *
 * The dash.js getter walks every S element (and every repeat) on every
 * getSegmentByTime() call: O(total segments) per seek. Here the flattened
 * timeline is built once and every lookup is an integer binary search,
 * O(log n), so a seek lands in microseconds regardless of segment count.
 *
 * The engine is dependency free and runs unchanged in the browser and Node.
 */

import { processUriTemplate } from './uri-template.js';

const DEFAULT_START_NUMBER = 1;
// dash.js rounds floats to 15 significant digits before scaling to timescale.
const PRECISION_DIGITS = 15;
// When a seek lands inside a gap we resume at the start of the next
// playable segment, nudged forward by this epsilon (3720 -> 3720.001 s).
const GAP_LANDING_EPSILON_SECONDS = 0.001;

function precisionRound(value) {
    return parseFloat(value.toPrecision(PRECISION_DIGITS));
}

function scaleToTimescale(seconds, timescale) {
    return Math.round(precisionRound(seconds * timescale));
}

class SegmentTimeline {
    /**
     * @param {object} config
     * @param {string} config.id              representation id (e.g. "v1")
     * @param {number} config.timescale       timescale units per second
     * @param {string} config.mediaTemplate   SegmentTemplate @media
     * @param {Array<{t?:number,d:number,r?:number}>} config.s
     *                                        SegmentTimeline S elements
     * @param {number} [config.startNumber=1] SegmentTemplate @startNumber
     * @param {number} [config.periodStart=0] Period start in presentation seconds
     * @param {number} [config.presentationTimeOffset=0]
     * @param {number} [config.bandwidth]     representation bandwidth
     * @param {number} [config.windowStart]   coverage window start, presentation s
     * @param {number} [config.windowEnd]     coverage window end, presentation s
     */
    constructor(config) {
        if (!config || !Array.isArray(config.s)) {
            throw new Error('SegmentTimeline: config.s (S elements) is required');
        }

        this.id = config.id;
        this.timescale = config.timescale;
        this.mediaTemplate = config.mediaTemplate;
        this.startNumber = config.startNumber ?? DEFAULT_START_NUMBER;
        this.periodStart = config.periodStart ?? 0;
        this.presentationTimeOffset = config.presentationTimeOffset ?? 0;
        this.bandwidth = config.bandwidth;
        this.windowStart = config.windowStart;
        this.windowEnd = config.windowEnd;

        this._flatten(config.s);
    }

    /**
     * Expand S elements (including repeats and negative r) into one flat,
     * sorted array of concrete segments. Gaps between S elements are stored
     * explicitly so lookup can distinguish "inside a segment" from
     * "inside a gap" without losing any segment or any duration.
     *
     * @private
     */
    _flatten(sElements) {
        const timescale = this.timescale;
        const periodStart = this.periodStart;
        const pto = this.presentationTimeOffset;
        const mediaWindowEndUnits = this.windowEnd === undefined
            ? undefined
            : Math.round((this.windowEnd - periodStart + pto) * timescale);
        const mediaWindowStartUnits = this.windowStart === undefined
            ? undefined
            : Math.round((this.windowStart - periodStart + pto) * timescale);

        const entries = [];
        let runningMediaTime = 0;

        const pushSegment = (mediaTime, durationUnits, manifestT) => {
            const index = entries.filter((e) => e.type === 'segment').length;
            const mediaStart = mediaTime / timescale;
            const presentationStart = mediaStart + periodStart - pto;
            entries.push({
                type: 'segment',
                index,
                startUnits: mediaTime,
                endUnits: mediaTime + durationUnits,
                durationUnits,
                manifestT: manifestT ?? mediaTime,
                mediaStart,
                mediaEnd: (mediaTime + durationUnits) / timescale,
                presentationStart,
                presentationEnd: presentationStart + durationUnits / timescale,
            });
        };

        const pushGap = (fromUnits, toUnits) => {
            if (toUnits <= fromUnits) {
                return;
            }
            entries.push({
                type: 'gap',
                startUnits: fromUnits,
                endUnits: toUnits,
                presentationStart: fromUnits / timescale + periodStart - pto,
                presentationEnd: toUnits / timescale + periodStart - pto,
            });
        };

        for (let i = 0; i < sElements.length; i++) {
            const element = sElements[i];
            const duration = element.d;

            let mediaTime;
            if (element.t !== undefined) {
                // Explicit @t: any space between the previous end and this
                // start is a gap (this is what the 3600 -> 3720 hole is).
                mediaTime = element.t;
                const last = entries[entries.length - 1];
                const previousEnd = last ? last.endUnits : runningMediaTime;
                if (mediaTime > previousEnd) {
                    pushGap(previousEnd, mediaTime);
                }
            } else {
                mediaTime = runningMediaTime;
            }

            let repeat = element.r ?? 0;
            if (repeat < 0) {
                const next = sElements[i + 1];
                let boundaryUnits;
                if (next && next.t !== undefined) {
                    boundaryUnits = next.t;
                } else if (mediaWindowEndUnits !== undefined) {
                    boundaryUnits = mediaWindowEndUnits;
                } else {
                    throw new Error('SegmentTimeline: negative @r requires a next S element with @t or a windowEnd');
                }
                // dash.js: Math.ceil((end - start) / d) - 1, floored at 0
                repeat = Math.max(Math.ceil((boundaryUnits - mediaTime) / duration) - 1, 0);
            }

            const firstManifestT = mediaTime;
            for (let j = 0; j <= repeat; j++) {
                // @t belongs to the first segment only; repeated segments
                // inherit the computed time (dash.js does the same).
                pushSegment(mediaTime, duration, j === 0 ? firstManifestT : mediaTime);
                mediaTime += duration;
            }
            runningMediaTime = mediaTime;
        }

        // Negative-r run stopping exactly on the next S element / window end
        // is asserted by construction; keep the window start for completeness.
        this._mediaWindowStartUnits = mediaWindowStartUnits;

        this._entries = entries;
        // Segments only, in index order, for O(log n) lookup.
        this._segments = entries.filter((e) => e.type === 'segment');
        this._gaps = entries.filter((e) => e.type === 'gap');

        // Sorted start units for the binary search.
        this._startUnits = this._segments.map((s) => s.startUnits);

        const lastSegment = this._segments[this._segments.length - 1];
        this._mediaDuration = lastSegment ? lastSegment.mediaEnd : 0;
        this._presentationEnd = lastSegment ? lastSegment.presentationEnd : 0;
    }

    get segmentCount() {
        return this._segments.length;
    }

    get segments() {
        return this._segments.map((s) => this._view(s));
    }

    get gaps() {
        return this._gaps.map((g) => ({
            presentationStart: g.presentationStart,
            presentationEnd: g.presentationEnd,
            duration: g.presentationEnd - g.presentationStart,
        }));
    }

    /** Presentation time at which the last media segment ends. */
    get mediaTimeOfLastSegmentEnd() {
        return this._presentationEnd;
    }

    /** Zero-based segment directly by index (the user's 序号). */
    getSegmentByIndex(index) {
        if (index < 0 || index >= this._segments.length) {
            return null;
        }
        return this._view(this._segments[index]);
    }

    /**
     * Find the segment covering a presentation time.
     *
     * Binary search on integer timescale start units. A time that falls in a
     * gap is mapped to the first segment after the gap, landing on its start
     * + GAP_LANDING_EPSILON_SECONDS (e.g. 3720 -> 3720.001). Times before the
     * first segment clamp to the first segment; times after the end return
     * null.
     *
     * @param {number} presentationTime seconds on the program timeline
     * @returns {{segment:object, requestedTime:number, landedTime:number,
     *            inGap:boolean, gap:object|null}|null}
     */
    resolve(presentationTime) {
        if (this._segments.length === 0) {
            return null;
        }

        const first = this._segments[0];
        const last = this._segments[this._segments.length - 1];

        // Beyond the end of the last segment: nothing playable afterwards.
        if (presentationTime >= last.presentationEnd) {
            return null;
        }

        // Before the first segment: clamp onto the first segment.
        if (presentationTime < first.presentationStart) {
            return {
                segment: this._view(first),
                requestedTime: presentationTime,
                landedTime: first.presentationStart,
                inGap: false,
                gap: null,
            };
        }

        const targetUnits = scaleToTimescale(
            presentationTime - this.periodStart + this.presentationTimeOffset,
            this.timescale
        );

        // Largest index whose startUnits <= targetUnits.
        let lo = 0;
        let hi = this._segments.length - 1;
        let found = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (this._startUnits[mid] <= targetUnits) {
                found = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        const candidate = this._segments[found];

        // Half-open [start, end): inside the segment itself.
        if (targetUnits < candidate.endUnits) {
            return {
                segment: this._view(candidate),
                requestedTime: presentationTime,
                landedTime: presentationTime,
                inGap: false,
                gap: null,
            };
        }

        // Past the candidate's end: a gap (or the tail). Find the next
        // segment and land on its start plus the epsilon.
        const next = this._segments[found + 1];
        if (!next) {
            return null;
        }

        const gapEntry = this._gaps.find(
            (g) => g.startUnits === candidate.endUnits && g.endUnits === next.startUnits
        );
        const gap = gapEntry
            ? {
                presentationStart: gapEntry.presentationStart,
                presentationEnd: gapEntry.presentationEnd,
                duration: gapEntry.presentationEnd - gapEntry.presentationStart,
            }
            : {
                presentationStart: candidate.presentationEnd,
                presentationEnd: next.presentationStart,
                duration: next.presentationStart - candidate.presentationEnd,
            };

        return {
            segment: this._view(next),
            requestedTime: presentationTime,
            landedTime: next.presentationStart + GAP_LANDING_EPSILON_SECONDS,
            inGap: true,
            gap,
        };
    }

    /**
     * Seek result plus the `count` segments scheduled from the landing
     * segment onwards (the segment containing the landed time first).
     */
    resolveWithNext(presentationTime, count = 13) {
        const result = this.resolve(presentationTime);
        if (!result) {
            return null;
        }
        const sequence = [];
        for (let i = 0; i < count; i++) {
            const seg = this.getSegmentByIndex(result.segment.index + i);
            if (seg) {
                sequence.push(seg);
            }
        }
        return { ...result, sequence };
    }

    /**
     * Public view of a flattened segment with URL expansion applied.
     * @private
     */
    _view(segment) {
        const number = this.startNumber + segment.index;
        const url = processUriTemplate(this.mediaTemplate, {
            representationId: this.id,
            number,
            time: segment.manifestT,
            bandwidth: this.bandwidth,
        });
        return {
            // 序号: zero-based position on the timeline (dash.js segment.index)
            index: segment.index,
            // 编号: replacement $Number$ (startNumber + index)
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

export { SegmentTimeline, GAP_LANDING_EPSILON_SECONDS };
