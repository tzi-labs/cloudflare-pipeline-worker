import { EventBuffer } from './EventBuffer';
import type { DurableObjectNamespace, DurableObjectStub, Request as CfRequest } from '@cloudflare/workers-types';

interface Env {
  EVENT_BUFFER: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get("Origin");
    const corsHeaders = new Headers();

    if (origin) {
      corsHeaders.set("Access-Control-Allow-Origin", origin);
      corsHeaders.set("Access-Control-Allow-Credentials", "true");
    }

    // Preflight CORS request
    if (request.method === "OPTIONS") {
      corsHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      corsHeaders.set("Access-Control-Allow-Headers", request.headers.get("Access-Control-Request-Headers") || "*");
      corsHeaders.set("Access-Control-Max-Age", "86400");
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      const headers = new Headers(corsHeaders);
      headers.set("Allow", "POST, OPTIONS");
      return new Response("Method Not Allowed", { status: 405, headers });
    }

    // Route to DO (fixed instance)
    try {
      const name = "global-event-buffer";
      const id = env.EVENT_BUFFER.idFromName(name);
      const stub: DurableObjectStub = env.EVENT_BUFFER.get(id);

      const res = await stub.fetch(request.clone() as unknown as CfRequest);

      // Wrap with CORS
      const wrapped = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: new Headers(corsHeaders),
      });

      return wrapped;
    } catch (err) {
      console.error("Routing error:", err);
      return new Response("Error routing to DO", { status: 500, headers: corsHeaders });
    }
  }
};

export { EventBuffer };