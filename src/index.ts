import { EventBuffer } from './EventBuffer';

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    // Dynamically allow any origin sending credentials
    const origin = request.headers.get("Origin");

    let responseHeaders = new Headers();
    let isAllowedOrigin = false;

    // If an Origin header is present, reflect it and allow credentials
    if (origin) {
      responseHeaders.set("Access-Control-Allow-Origin", origin);
      responseHeaders.set("Access-Control-Allow-Credentials", "true");
      isAllowedOrigin = true; // Consider any origin with an Origin header as allowed
    } else {
      // Handle requests without an Origin header (e.g., same-origin, curl, server-to-server)
      // These don't need explicit CORS headers for Allow-Origin or Credentials
    }

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      // Always handle OPTIONS, but only add CORS headers if Origin was present
      return handleOptions(request, responseHeaders, isAllowedOrigin);
    }

    // Handle POST requests
    if (request.method === "POST") {
      // Handle the actual POST request - no origin check needed here anymore
      let response = await handlePost(request, env);
      // Add CORS headers ONLY if an Origin was present in the request
      if (isAllowedOrigin) {
        for (const [key, value] of responseHeaders.entries()) {
          response.headers.append(key, value);
        }
      }
      return response;
    } else {
      // Method Not Allowed for non-POST/OPTIONS
      const headers = new Headers(); // Start with fresh headers
      headers.set("Allow", "POST, OPTIONS");
      // Add CORS headers only if Origin was present
      if (isAllowedOrigin) {
          headers.set("Access-Control-Allow-Origin", responseHeaders.get("Access-Control-Allow-Origin")!); // Use the reflected origin
          headers.set("Access-Control-Allow-Credentials", "true");
      }
      return new Response("Method Not Allowed", {
        status: 405,
        headers: headers,
      });
    }
  }
}

// Export the Durable Object class
export { EventBuffer };

function handleOptions(request: Request, corsHeaders: Headers, originPresent: boolean): Response {
  // Only add CORS headers if an Origin header was present in the request
  if (!originPresent) {
    // Standard 204 response for OPTIONS without specific CORS headers
    return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
  }

  // Origin was present, add specific CORS headers
  corsHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  corsHeaders.set("Access-Control-Allow-Headers", "Content-Type"); // Add others like Authorization if needed
  corsHeaders.set("Access-Control-Max-Age", "86400"); // Optional: cache preflight response for 1 day

  return new Response(null, {
    status: 204, // No Content
    headers: corsHeaders,
  });
}

async function handlePost(request: Request, env: any): Promise<Response> {
  try {
    // Ensure content type is JSON before parsing
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response("Invalid content type, expected application/json", { status: 415 });
    }

    const data = await request.json()

    // Basic validation
    if (!data || typeof data !== 'object' || !data.ev || !data.uid) {
      return new Response("Invalid payload: missing required fields or incorrect format", { status: 400 })
    }

    // Consider adding more specific validation based on expected data types/formats

    // Forward data to the Durable Object
    const key = `buffer-${data.uid}` // Partition by user ID (or use hourly, etc.)
    const id = env.EVENT_BUFFER.idFromName(key)
    const stub = env.EVENT_BUFFER.get(id)

    // We need to clone the original request to forward it, including its body
    // Note: If you need to *modify* the data before sending, create a new Request object
    const forwardRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers, // Forward original headers
      body: JSON.stringify(data) // Reserialize the validated data
    })

    // Forward the request to the DO
    await stub.fetch(forwardRequest)

    // Return successful response (CORS headers added in the main fetch handler if Origin was present)
    return new Response("OK", { status: 200 })

  } catch (err: any) {
    console.error("Error processing POST request:", err);

    // Handle JSON parsing errors specifically
    if (err instanceof SyntaxError) {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    // Generic error for other issues
    return new Response("Error processing request", { status: 500 })
  }
}
