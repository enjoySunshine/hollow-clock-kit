/**
 * URI template expansion checks ($RepresentationID$, $Number$, $Time$,
 * $Bandwidth$, $$ escaping, unknown identifiers).
 *
 * Run: node test/uri-template.test.mjs
 */

import { processUriTemplate } from '../src/uri-template.js';

let failures = 0;
function eq(label, actual, expected) {
    if (actual !== expected) {
        failures++;
        console.error(`FAIL ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
    } else {
        console.log(`ok   ${label}`);
    }
}

const values = { representationId: 'v1', number: 1801, time: 334800000, bandwidth: 500000 };

eq('video template',
    processUriTemplate('media-$RepresentationID$-$Time$.m4s', values),
    'media-v1-334800000.m4s');

eq('audio template',
    processUriTemplate('snd-$RepresentationID$-$Time$.m4s', { ...values, representationId: 'a1' }),
    'snd-a1-334800000.m4s');

eq('number template',
    processUriTemplate('chunk-$Number$.m4s', values),
    'chunk-1801.m4s');

eq('bandwidth template',
    processUriTemplate('b-$Bandwidth$-$RepresentationID$.m4s', values),
    'b-500000-v1.m4s');

eq('dollar escaping',
    processUriTemplate('cost-$$5-$Time$.mp4', values),
    'cost-$5-334800000.mp4');

eq('unknown identifier ignored',
    processUriTemplate('x-$Unknown$-$Time$.mp4', values),
    'x--334800000.mp4');

eq('falsy-ish zero time kept',
    processUriTemplate('media-v1-$Time$.m4s', { ...values, time: 0 }),
    'media-v1-0.m4s');

eq('empty template passthrough', processUriTemplate('', values), '');
eq('null template passthrough', processUriTemplate(null, values), null);
eq('plain string unchanged', processUriTemplate('plain.mp4', values), 'plain.mp4');

if (failures) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
}
console.log('\nall uri-template checks passed');
