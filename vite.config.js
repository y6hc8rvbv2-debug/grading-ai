import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 開発中（npm run dev）も /api を動かすための小さな橋渡し。本番では Vercel が同じファイルを実行する。
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      Object.assign(process.env, loadEnv('development', process.cwd(), ''));
      const readBody = (req) => new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        try {
          if (url.pathname === '/api/ai') {
            const mod = await server.ssrLoadModule('/api/ai.js');
            const body = await readBody(req);
            const response = await mod.default(new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined }));
            res.statusCode = response.status;
            response.headers.forEach((v, k) => res.setHeader(k, v));
            if (response.body) for await (const chunk of response.body) res.write(chunk);
            return res.end();
          }
          if (url.pathname === '/api/app') {
            const mod = await server.ssrLoadModule('/api/app.js');
            const body = await readBody(req);
            req.body = body ? JSON.parse(body) : {};
            req.query = Object.fromEntries(url.searchParams);
            res.status = (code) => { res.statusCode = code; return res; };
            res.json = (obj) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
            return await mod.default(req, res);
          }
        } catch (err) {
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: String(err?.message || err) }));
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApi()],
  build: { chunkSizeWarningLimit: 1500 },
});
