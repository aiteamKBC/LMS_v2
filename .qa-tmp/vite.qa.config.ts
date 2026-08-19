// QA-only config: identical to the project config except every API proxy —
// including /curriculum_api, which the real config hardcodes to :8000 — points
// at the isolated local backend so no request can reach production Neon.
import { defineConfig, mergeConfig } from "vite";
import baseFactory from "../frontend/vite.config";

const TARGET = process.env.QA_API_TARGET || "http://127.0.0.1:8011";

const ROUTES = [
  "/curriculum_api",
  "/coach_api",
  "/quiz_api",
  "/learner_api",
  "/audit_api",
  "/hours_test_api",
  "/manual_audit_api",
  "/engagement_api",
  "/enrolment_api",
  "/api",
  "/ws",
  "/media",
];

export default defineConfig(async (env) => {
  const base = await (typeof baseFactory === "function" ? baseFactory(env) : baseFactory);
  const proxy = Object.fromEntries(
    ROUTES.map((r) => [r, { target: TARGET, changeOrigin: true, ...(r === "/ws" ? { ws: true } : {}) }]),
  );
  return mergeConfig(base, { server: { port: 3100, proxy, strictPort: true } });
});
