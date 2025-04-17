
export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Only POST supported", { status: 405 })
    }

    try {
      const data = await request.json()

      // Basic validation
      if (!data || !data.ev || !data.uid) {
        return new Response("Invalid payload", { status: 400 })
      }

      await env.PIPELINE.send([data])

      return new Response("OK", { status: 200 })
    } catch (err) {
      return new Response("Error processing request", { status: 500 })
    }
  }
}
