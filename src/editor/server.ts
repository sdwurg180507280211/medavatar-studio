import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import type {ServerResponse} from 'node:http';
import {createServer as createViteServer, type Plugin} from 'vite';
import {loadPreviewProps} from '../production/renderProps.js';
import {resolveGeneratedAssetSource} from '../production/assets.js';

const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

const editorApiPlugin = (projectName: string): Plugin => ({
  name: 'medavatar-editor-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url) return next();
      const url = new URL(req.url, 'http://localhost');
      const expectedApi = `/api/projects/${encodeURIComponent(projectName)}`;
      if (req.method === 'GET' && url.pathname === expectedApi) {
        try {
          sendJson(res, 200, await loadPreviewProps(projectName));
        } catch (error) {
          sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)});
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
      open: `/?project=${encodeURIComponent(projectName)}`,
      fs: {allow: [path.resolve('.')]},
    },
  });
  await server.listen();
  server.printUrls();
  console.log(`✓ editor -> ${projectName}`);
  return server;
};
