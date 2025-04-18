import { EventBuffer } from './EventBuffer';
import type { DurableObjectNamespace, DurableObjectStub, Request as CfRequest, ExecutionContext } from '@cloudflare/workers-types';

// Define the specific interface for the Pipeline binding used by the Worker
interface PipelineBinding {
	send(data: Array<any>): Promise<void>; // Expects an array of objects
}

interface Env {
	EVENT_BUFFER: DurableObjectNamespace;
	PIPELINE: PipelineBinding; // Add Pipeline binding for direct sending
	USE_DURABLE_OBJECT?: boolean | string; // Environment variable to control DO usage (string because wrangler vars can be strings)
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

		// Check if Durable Object should be used
		// Convert string 'true'/'false' from env var to boolean
		const useDO = env.USE_DURABLE_OBJECT === true || String(env.USE_DURABLE_OBJECT).toLowerCase() === 'true';

		if (useDO) {
			// Route to DO (fixed instance)
			try {
				const name = "global-event-buffer";
				const id = env.EVENT_BUFFER.idFromName(name);
				const stub: DurableObjectStub = env.EVENT_BUFFER.get(id);

				const res = await stub.fetch(request.clone() as unknown as CfRequest);

				// Pass status/headers from DO response, handle body type carefully
				const wrapped = new Response(res.body ? res.body : null, {
					status: res.status,
					statusText: res.statusText,
					headers: res.headers, // Use headers directly from DO response first
				});

				// Apply CORS headers, potentially overwriting DO headers if needed
				corsHeaders.forEach((value, key) => {
					wrapped.headers.set(key, value);
				});

				return wrapped;
			} catch (err) {
				console.error("Routing error:", err);
				return new Response("Error routing to DO", { status: 500, headers: corsHeaders });
			}
		} else {
			// Send directly to Pipeline (no DO buffering)
			try {
				const data = await request.json();
				// Ensure data is an array for the pipeline
				const batch = Array.isArray(data) ? data : [data];
				
				// Use ctx.waitUntil to allow the send operation to complete after the response
				ctx.waitUntil(env.PIPELINE.send(batch));

				console.log(`Directly sent ${batch.length} event(s) to pipeline.`);
				return new Response("Sent directly to pipeline", { status: 202, headers: corsHeaders });

			} catch (err: any) {
				console.error("Error sending directly to pipeline:", err);
				if (err instanceof SyntaxError) {
					return new Response("Invalid JSON payload", { status: 400, headers: corsHeaders });
				}
				return new Response("Error processing direct request", { status: 500, headers: corsHeaders });
			}
		}
	}
};

export { EventBuffer };