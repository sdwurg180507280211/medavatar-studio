import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {rename, stat, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {createServer as createViteServer, type Plugin} from 'vite';
import {projectPaths} from '../core/io.js';
import {storyboardOverridesSchema} from '../core/overrides.js';
import {loadPreviewProps} from '../production/renderProps.js';
import {resolveGeneratedAssetSource} from '../production/assets.js';

const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_JSON_BYTES = 1024 * 1024;

const contentTypeFor = (file: string) => {
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.webm')) return 'video/webm';
  if (file.endsWith('.mp3')) return 'audio/mpeg';
  if (file.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
};

const sendJson = (res: ServerResponse, status: number, value: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(value)}\n`);
};

const readJsonBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_JSON_BYTES) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error('Request body is required.');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};

const parseOverridesBody = async (req: IncomingMessage) =>
  storyboardOverridesSchema.parse(await readJsonBody(req));

const writeJsonAtomic = async (file: string, value: unknown) => {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
};

const editorApiPlugin = (projectName: string): Plugin => ({
  name: 'medavatar-editor-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url) return next();
      const url = new URL(req.url, 'http://localhost');
      const projectApi = `/api/projects/${encodeURIComponent(projectName)}`;

      if (req.method === 'GET' && url.pathname === projectApi) {
        try {
          sendJson(res, 200, await loadPreviewProps(projectName));
        } catch (error) {
          sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)});
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === `${projectApi}/resolve`) {
        try {
          const overrides = await parseOverridesBody(req);
          sendJson(res, 200, await loadPreviewProps(projectName, {overrides}));
        } catch (error) {
          sendJson(res, 400, {error: error instanceof Error ? error.message : String(error)});
        }
        return;
      }

      if (req.method === 'PUT' && url.pathname === `${projectApi}/overrides`) {
        try {
          const overrides = await parseOverridesBody(req);
          // Validate the complete effective project before touching the durable file.
          const preview = await loadPreviewProps(projectName, {overrides});
          await writeJsonAtomic(projectPaths(projectName).overrides, overrides);
          sendJson(res, 200, preview);
        } catch (error) {
          sendJson(res, 400, {error: error instanceof Error ? error.message : String(error)});
        }
        return;
      }

      const prefix = `/generated/${encodeURIComponent(projectName)}/`;
      if (req.method === 'GET' && url.pathname.startsWith(prefix)) {
        const fileName = decodeURIComponent(url.pathname.slice(prefix.length));
        const source = await resolveGeneratedAssetSource(projectName, fileName);
        if (!source) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const info = await stat(source);
        const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentTypeFor(source));
        if (range) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= info.size) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${info.size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
          res.setHeader('Content-Length', end - start + 1);
          createReadStream(source, {start, end}).pipe(res);
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Length', info.size);
        createReadStream(source).pipe(res);
        return;
      }
      next();
    });
  },
});

export const startEditorServer = async (projectName: string, port = 4173) => {
  if (!PROJECT_RE.test(projectName)) throw new Error(`Invalid project name: ${projectName}`);
  const root = path.resolve('editor');
  const server = await createViteServer({
    root,
    plugins: [editorApiPlugin(projectName)],
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      open: process.env.CI ? false : `/?project=${encodeURIComponent(projectName)}`,
      fs: {allow: [path.resolve('.')]},
    },
  });
  await server.listen();
  server.printUrls();
  console.log(`✓ editor -> ${projectName}`);
  return server;
};
