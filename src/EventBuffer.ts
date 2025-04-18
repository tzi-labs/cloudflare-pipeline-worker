import type { DurableObjectState } from "@cloudflare/workers-types";

export class EventBuffer {
    state: DurableObjectState;
    env: Env;
    buffer: any[] = [];
    flushTimer: number | null = null;
    FLUSH_INTERVAL = 300 * 1000; // flush every 300 seconds - 5 minutes
    MAX_BATCH_SIZE = 1000;
  
    constructor(state: DurableObjectState, env: Env) {
      this.state = state;
      this.env = env;
  
      // Load previous buffer if any
      state.blockConcurrencyWhile(async () => {
        const stored = await this.state.storage.get("buffer");
        // Ensure stored value is an array before assigning
        this.buffer = Array.isArray(stored) ? stored : []; 
      });
    }
  
    async fetch(request: Request): Promise<Response> {
      const { method } = request;
  
      if (method !== "POST") {
        return new Response("Only POST allowed", { status: 405 });
      }
  
      try {
        const data = await request.json();
  
        // Estimate size before adding
        const approximateSize = JSON.stringify(this.buffer).length + JSON.stringify(data).length;
        const STORAGE_SIZE_LIMIT = 120 * 1024; // 120 KiB - leave some headroom

        if (approximateSize > STORAGE_SIZE_LIMIT && this.buffer.length > 0) {
          // Flush existing buffer if adding the new event would exceed the limit
          await this.flush();
        }
  
        // Add to buffer
        this.buffer.push(data);
  
        if (this.buffer.length >= this.MAX_BATCH_SIZE) {
          await this.flush();
        } else {
          // Save current buffer
          await this.state.storage.put("buffer", this.buffer);
  
          // Schedule flush if not already scheduled
          if (!this.flushTimer) {
            await this.state.storage.setAlarm(Date.now() + this.FLUSH_INTERVAL);
            this.flushTimer = Date.now() + this.FLUSH_INTERVAL;
          }
        }
  
        return new Response("Buffered", { status: 202 });
      } catch (err) {
        console.error("Error buffering event:", err);
        return new Response("Invalid payload", { status: 400 });
      }
    }
  
    async alarm() {
      await this.flush();
    }
  
    async flush() {
      if (this.buffer.length === 0) return;
  
      const batch = [...this.buffer];
      this.buffer = [];
      this.flushTimer = null;
      await this.state.storage.delete("buffer");
  
      // Send to pipeline (or R2, KV, log, etc.)
      try {
        console.log("Flushing batch:", batch.length);
        // Example: replace this with real pipeline call
        await this.env.PIPELINE.send(batch);
      } catch (err) {
        console.error("Flush failed, restoring buffer");
        this.buffer = batch;
        await this.state.storage.put("buffer", this.buffer);
      }
    }
  }
  