/**
 * DASH media URI template expansion.
 *
 * Implements the $...$ identifiers used by SegmentTemplate@media in the
 * timelines of this project: $RepresentationID$, $Number$, $Time$ and $Bandwidth$.
 * A literal dollar sign is written as $$. The expansion semantics match
 * dash.js (processUriTemplate) / the MPEG-DASH spec for these identifiers.
 *
 * No third-party dependency, so the exact same code runs in the browser and
 * in Node without a build step.
 */

const IDENTIFIERS = {
    RepresentationID: 'representationId',
    Number: 'number',
    Time: 'time',
    Bandwidth: 'bandwidth',
};

/**
 * @param {string} template  e.g. "media-$RepresentationID$-$Time$.m4s"
 * @param {object} values    { representationId, number, time, bandwidth }
 * @returns {string} expanded URL
 */
export function processUriTemplate(template, values = {}) {
    if (!template) {
        return template;
    }

    let out = '';
    for (let i = 0; i < template.length; i++) {
        const ch = template[i];

        if (ch !== '$') {
            out += ch;
            continue;
        }

        // Escaped literal dollar: "$$"
        if (template[i + 1] === '$') {
            out += '$';
            i += 1;
            continue;
        }

        const close = template.indexOf('$', i + 1);
        if (close === -1) {
            // Malformed template; keep the rest untouched.
            out += template.slice(i);
            break;
        }

        const token = template.slice(i + 1, close);
        const key = IDENTIFIERS[token];
        if (key !== undefined && values[key] !== undefined && values[key] !== null) {
            out += String(values[key]);
        }
        // Unknown identifiers are ignored (same lenient behaviour as dash.js).
        i = close;
    }

    return out;
}
