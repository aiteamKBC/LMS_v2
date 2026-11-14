import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import AutoImport from 'unplugin-auto-import/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// This server intentionally does not load vite.config.ts, .env files or a backend proxy.
// The fixture renders the real shared shell with an isolated, synthetic AuthContext.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Tailwind's existing PostCSS plugin resolves its config from the working folder.
process.chdir(root);
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https://jokdxsdbxorzciulkdyl.supabase.co; connect-src 'self'; form-action 'none'; frame-src 'none'";
const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Delivery — local design review</title></head><body><div id="root"></div><script>
const previewFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (target.origin !== location.origin || !['GET', 'HEAD'].includes(method) || /^\\/(?:[a-z_]+_api|api|ws|media)(?:\\/|$)/.test(target.pathname)) {
    return Promise.reject(new Error('Backend actions are disabled in this local design preview.'));
  }
  return previewFetch(input, init);
};
</script><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/scripts/delivery-workspace-preview.tsx"></script></body></html>`;

const server = await createServer({
  configFile: false,
  envDir: false,
  root,
  plugins: [
    react(),
    AutoImport({ imports: ['react', { 'react-router-dom': ['Link', 'NavLink', 'useNavigate', 'useLocation', 'useParams', 'useSearchParams'] }, { '@/components/feature/AppIcon': ['AppIcon'] }], dts: false }),
    { name: 'isolated-delivery-preview', configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        response.setHeader('Content-Security-Policy', csp);
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        if (!['GET', 'HEAD'].includes(request.method || 'GET') || /^\/(?:[a-z_]+_api|api|ws|media)(?:\/|$)/.test(url.pathname)) {
          response.statusCode = 503;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'No backend is connected to this design preview.' }));
          return;
        }
        if (url.pathname === '/__delivery-preview') {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(html);
          return;
        }
        next();
      });
    } },
  ],
  define: { __BASE_PATH__: JSON.stringify('/'), __IS_PREVIEW__: 'true', __READDY_PROJECT_ID__: '""', __READDY_VERSION_ID__: '""', __READDY_AI_DOMAIN__: '""' },
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { host: '127.0.0.1', port: 4328, strictPort: true, hmr: false, proxy: {} },
});
await server.listen();
console.log('Isolated Delivery preview: http://127.0.0.1:4328/__delivery-preview');
console.log('No .env, backend proxy, database or live API. Stop with Ctrl+C.');
const close = async () => { await server.close(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
