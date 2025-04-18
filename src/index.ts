import { EventBuffer } from './EventBuffer';
import type { DurableObjectNamespace, DurableObjectStub, Request as CfRequest } from '@cloudflare/workers-types';

// Explicitly use standard types where ambiguity might arise
type StdRequest = globalThis.Request;
type StdResponse = globalThis.Response;
type StdHeaders = globalThis.Headers;

// Define env type for clarity
interface Env {
  EVENT_BUFFER: DurableObjectNamespace;
  // Add other bindings like KV, R2, Services if needed
}

export default {
  // Ensure the fetch handler returns a standard Response
  async fetch(request: StdRequest, env: Env, ctx: any): Promise<StdResponse> {
    // Dynamically allow any origin sending credentials
    const origin = request.headers.get("Origin");

    let corsHeaders = new Headers() as StdHeaders; // Rename to avoid conflict
    let isOriginAllowed = false; // Rename to avoid conflict

    // If an Origin header is present, reflect it and allow credentials
    if (origin) {
      corsHeaders.set("Access-Control-Allow-Origin", origin);
      corsHeaders.set("Access-Control-Allow-Credentials", "true");
      isOriginAllowed = true; // Consider any origin with an Origin header as allowed
    } else {
      // Handle requests without an Origin header (e.g., same-origin, curl, server-to-server)
      // These don't need explicit CORS headers for Allow-Origin or Credentials
    }

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      // Always handle OPTIONS, but only add CORS headers if Origin was present
      return handleOptions(request, corsHeaders, isOriginAllowed);
    }

    // Handle POST requests
    if (request.method === "POST") {
      // Validate and forward the request to the DO
      const doResponse = await handlePostAndForward(request, env);

      // Create new EMPTY mutable headers
      const finalHeaders = new Headers() as StdHeaders;

      // Add CORS headers ONLY if an Origin was present in the request
      if (isOriginAllowed) {
        const preparedCorsHeaders = corsHeaders; // Use the headers prepared earlier
        for (const [key, value] of preparedCorsHeaders.entries()) {
          // Set CORS headers on the new headers object
          finalHeaders.set(key, value);
        }
      }

      // Create a new response with the DO response body/status but with the final headers
      // Note: This explicitly does NOT copy headers from doResponse
      const finalResponse = new Response(doResponse.body, {
        status: doResponse.status,
        statusText: doResponse.statusText,
        headers: finalHeaders // Use the headers built from scratch
      }) as StdResponse;

      return finalResponse;

    } else {
      // Method Not Allowed for non-POST/OPTIONS
      const headers = new Headers() as StdHeaders; // Start with fresh headers
      headers.set("Allow", "POST, OPTIONS");
      // Add CORS headers only if Origin was present
      if (isOriginAllowed) {
          headers.set("Access-Control-Allow-Origin", corsHeaders.get("Access-Control-Allow-Origin")!); // Use the reflected origin
          headers.set("Access-Control-Allow-Credentials", "true");
      }
      return new Response("Method Not Allowed", {
        status: 405,
        headers: headers,
      }) as StdResponse;
    }
  }
}

// Export the Durable Object class for wrangler
export { EventBuffer };

// --- Helper Functions ---

function handleOptions(request: StdRequest, corsHeaders: StdHeaders, originPresent: boolean): StdResponse {
  // Only add CORS headers if an Origin header was present in the request
  if (!originPresent) {
    // Standard 204 response for OPTIONS without specific CORS headers
    return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } }) as StdResponse;
  }

  // Origin was present, add specific CORS headers required by browsers
  corsHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  // Allow headers the client actually sends
  const requestHeaders = request.headers.get("Access-Control-Request-Headers");
  if (requestHeaders) {
      corsHeaders.set("Access-Control-Allow-Headers", requestHeaders);
  }
  corsHeaders.set("Access-Control-Max-Age", "86400"); // Cache preflight for 1 day

  return new Response(null, {
    status: 204, // No Content
    headers: corsHeaders, // Includes Allow-Origin and Allow-Credentials set earlier
  }) as StdResponse;
}

// This function now explicitly returns a standard Response
async function handlePostAndForward(request: StdRequest, env: Env): Promise<StdResponse> {
  let data: any;
  try {
    // Ensure content type is JSON before parsing
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response("Invalid content type, expected application/json", { status: 415 }) as StdResponse;
    }

    // Clone request to read body safely
    const requestClone = request.clone();
    data = await requestClone.json();

    // Basic payload validation (ensure this matches what DO expects)
    if (!data || typeof data !== 'object' || !data.ev || !data.uid) {
      console.log("Invalid payload received:", JSON.stringify(data));
      return new Response("Invalid payload: missing required fields or incorrect format", { status: 400 }) as StdResponse;
    }

    // --- Forward to Durable Object ---
    // Use a FIXED name to ensure all requests hit the SAME DO instance
    const durableObjectName = "global-event-buffer";
    const durableObjectId = env.EVENT_BUFFER.idFromName(durableObjectName);
    const stub: DurableObjectStub = env.EVENT_BUFFER.get(durableObjectId);

    // Call stub.fetch - Cast request clone through any to satisfy CfRequest type expectation
    const doResponse = await stub.fetch(request.clone() as any as CfRequest);

    // Ensure the response from DO is treated as a standard Response by casting through unknown
    return doResponse as unknown as StdResponse;

  } catch (err: any) {
    console.error("Error processing/forwarding POST request:", err);

    // Handle JSON parsing errors specifically
    if (err instanceof SyntaxError) {
      return new Response("Invalid JSON payload", { status: 400 }) as StdResponse;
    }

    // Generic error for other issues
    return new Response("Error processing request", { status: 500 }) as StdResponse;
  }
}
