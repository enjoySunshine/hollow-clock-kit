#!/usr/bin/env node
/**
 * Zero-dependency static server for the preview page.
 *
 *   node tools/serve.mjs [port]
 *
 * Serves the seeklab directory as ESM with correct JS MIME types so
 * preview/index.html can import ../src/lab.js directly.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8123;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
    try {
        let path = decodeURIComponent(new URL(req.url, `http://localhost`).pathname);
        if (path === '/') {
            path = '/preview/index.html';
        }
        const filePath = normalize(join(root, path));
        if (!filePath.startsWith(root)) {
            res.writeHead(403).end('forbidden');
            return;
        }
        const data = await readFile(filePath);
        res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
}).listen(port, () => {
    console.log(`seek lab preview: http://localhost:${port}/preview/index.html`);
});
