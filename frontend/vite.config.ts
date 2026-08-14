import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import AutoImport from "unplugin-auto-import/vite";
// import { readdyJsxRuntimeProxyPlugin } from "./vite.jsx-runtime-proxy";

const base = process.env.BASE_PATH || "/";
const isPreview = process.env.IS_PREVIEW ? true : false;
//const proxyPlugins = isPreview ? [readdyJsxRuntimeProxyPlugin()] : [];
// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BASE_PATH__: JSON.stringify(base),
    __IS_PREVIEW__: JSON.stringify(isPreview),
    __READDY_PROJECT_ID__: JSON.stringify(process.env.PROJECT_ID || ""),
    __READDY_VERSION_ID__: JSON.stringify(process.env.VERSION_ID || ""),
    __READDY_AI_DOMAIN__: JSON.stringify(process.env.READDY_AI_DOMAIN || ""),
  },
  plugins: [
    // ...proxyPlugins,
    react(),
    AutoImport({
      imports: [
        {
          react: [
            ["default", "React"],
            "useState",
            "useEffect",
            "useContext",
            "useReducer",
            "useCallback",
            "useMemo",
            "useRef",
            "useImperativeHandle",
            "useLayoutEffect",
            "useDebugValue",
            "useDeferredValue",
            "useId",
            "useInsertionEffect",
            "useSyncExternalStore",
            "useTransition",
            "startTransition",
            "lazy",
            "memo",
            "forwardRef",
            "createContext",
            "createElement",
            "cloneElement",
            "isValidElement",
          ],
        },
        {
          "react-router-dom": [
            "useNavigate",
            "useLocation",
            "useParams",
            "useSearchParams",
            "Link",
            "NavLink",
            "Navigate",
            "Outlet",
          ],
        },
        // React i18n
        {
          "react-i18next": ["useTranslation", "Trans"],
        },
        {
          "@/components/feature/AppIcon": ["AppIcon"],
        },
      ],
      dts: true,
    }),
  ],
  base,
  build: {
    // Production ships no source maps. The bundle previously emitted 297 .map files
    // (~22 MB, 71% of the build output) reachable from the deployed site, which hands
    // any visitor the original TypeScript — component logic, code comments, internal
    // file paths and API route names included. No error-monitoring service is wired
    // up (there is no Sentry/Bugsnag/Rollbar/Datadog dependency), so nothing consumes
    // them; if one is added later, switch this to 'hidden' so the maps are emitted for
    // upload but no sourceMappingURL comment points browsers at them.
    //
    // `vite dev` is unaffected: the dev server always serves inline source maps.
    sourcemap: mode === 'production' ? false : true,
    outDir: 'out',
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
    server: {
    port: 3000,
    host: "0.0.0.0",
    // Forward API calls to the Django backend so the browser sees them as
    // same-origin (no CORS). Django runs on :8000 by default.
    proxy: {
      "/curriculum_api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/coach_api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/quiz_api": {
        target: process.env.VITE_API_PROXY || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      // 127.0.0.1, NOT localhost: on Windows, Node resolves localhost to ::1
      // first and Django listens on IPv4 only — the failed IPv6 attempt costs
      // ~2.3s on EVERY proxied request.
      "/learner_api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/audit_api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/manual_audit_api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/engagement_api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/enrolment_api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,
      },
      "/media": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
}));
