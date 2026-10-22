import { test as base, expect, type Route } from '@playwright/test';

type Reply = { status?: number; body: unknown };
type Handler = (route: Route) => Reply | Promise<Reply>;
export type MockApi = {
  on: (method: string, path: string, handler: Handler) => void;
  requests: { method: string; path: string; body: unknown }[];
};

export const test = base.extend<{ api: MockApi }>({
  api: async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const handlers = new Map<string, Handler>();
    const requests: MockApi['requests'] = [];
    const unexpected: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (request.url() === 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/16480272afc94729b2911a62d1bbf85d.webp') {
        // Known login logo: synthetic image served entirely from interception.
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
        return;
      }
      if (url.origin !== origin) {
        unexpected.push(`External ${method} ${url.origin}`);
        await route.abort('blockedbyclient');
        return;
      }
      const key = `${method} ${url.pathname}`;
      const handler = handlers.get(key);
      if (handler) {
        let body: unknown = null;
        try { body = request.postDataJSON(); } catch { body = request.postData(); }
        requests.push({ method, path: url.pathname, body });
        const reply = await handler(route);
        await route.fulfill({ status: reply.status ?? 200, json: reply.body });
        return;
      }
      const staticAsset = method === 'GET' && (
        request.resourceType() === 'document' ||
        /^\/(assets\/|favicon\.|login-open-book\.)/.test(url.pathname));
      // A same-origin API navigation is never a permitted static document.
      if (staticAsset && !/^\/(login_api|learner_api|curriculum_api|enrolment_api|coach_api|api)\//.test(url.pathname)) {
        await route.continue();
        return;
      }
      unexpected.push(key);
      await route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => {
      unexpected.push(`WebSocket ${new URL(socket.url()).origin}`);
      socket.close();
    });
    await use({ on: (method, path, handler) => handlers.set(`${method} ${path}`, handler), requests });
    expect(unexpected, 'Every unexpected request must be reviewed; never add a blanket success response').toEqual([]);
  },
});
export { expect };
