export class EventBuffer {
  buffer: any[] = []
  lastFlush = Date.now()
  MAX_BUFFER = 500
  FLUSH_INTERVAL = 1000 * 30 // Changed to 30 seconds for testing

  constructor(readonly state: DurableObjectState, readonly env: { PIPELINE: any, R2_BUCKET?: any }) {
    // We don't await this promise, allowing the constructor to return immediately.
    // The flush operation will happen in the background.
    this.scheduleFlushIfNeeded()
  }

  // Helper to ensure scheduled alarm only happens once
  async scheduleFlushIfNeeded() {
    const currentAlarm = await this.state.storage.getAlarm()
    if (currentAlarm === null) {
        console.log("Scheduling initial alarm.");
        this.state.storage.setAlarm(Date.now() + this.FLUSH_INTERVAL);
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Assuming the worker forwarded the request after validating JSON
    try {
        // Clone the request to read the body, as it can only be read once
        const data = await request.clone().json(); // Clone before reading body
        this.buffer.push(data);
        console.log(`Buffered event. Buffer size: ${this.buffer.length}`);

        if (this.buffer.length >= this.MAX_BUFFER) {
            console.log("Buffer limit reached, flushing to pipeline...");
            // Don't await flush here in the fetch path to respond quickly
            this.state.waitUntil(this.flushToPipeline());
        }

        // Consider returning 202 Accepted as buffering is asynchronous
        return new Response("Buffered", { status: 202 });
    } catch (e) {
        console.error("Error processing fetch in DO:", e);
        // Avoid exposing internal errors directly
        return new Response("Error buffering event", { status: 500 })
    }
  }

  // alarm() is invoked by the runtime when a scheduled alarm is due
  async alarm() {
    console.log("Alarm triggered, flushing buffer to pipeline...");
    await this.flushToPipeline(); // Await flush in alarm handler
    // Schedule the next alarm *after* the current one has successfully run (or attempted)
    this.state.storage.setAlarm(Date.now() + this.FLUSH_INTERVAL);
    console.log("Next alarm scheduled.");
  }

  // Renamed from flushToR2
  async flushToPipeline() {
    if (this.buffer.length === 0) {
        console.log("Buffer empty, nothing to flush to pipeline.");
        return;
    }

    // Reference the buffer to send.
    const batchToSend = [...this.buffer]; // Shallow copy the current buffer contents

    try {
        if (!this.env.PIPELINE) {
            console.error("PIPELINE binding missing in Durable Object environment.");
            // Consider how to handle this - maybe retry later?
            return; // Stop if pipeline isn't bound
        }

        // Pipelines API expects an array of events
        await this.env.PIPELINE.send(batchToSend);

        console.log(`Successfully flushed ${batchToSend.length} events to pipeline.`);
        // Clear the buffer ONLY after successful send
        // Remove the elements that were successfully sent
        this.buffer.splice(0, batchToSend.length);
        this.lastFlush = Date.now(); // Update last flush time

    } catch (error) {
        console.error(`Failed to flush batch of size ${batchToSend.length} events to pipeline: ${error}`);
        // DO NOT clear the buffer here. The events remain in this.buffer for the next attempt.
        // Optional: Implement more sophisticated retry logic (e.g., exponential backoff)
        // or dead-letter queue if sends consistently fail.
    }
  }
}

// Define DurableObjectState type if not globally available (e.g., in older projects or for clarity)
// You might need to install @cloudflare/workers-types
// npm install --save-dev @cloudflare/workers-types
interface DurableObjectState {
    storage: DurableObjectStorage;
    waitUntil(promise: Promise<any>): void;
    id: DurableObjectId;
    // Add other properties/methods if needed based on your usage
}

interface DurableObjectStorage {
    get<T = unknown>(key: string, options?: DurableObjectGetOptions): Promise<T | undefined>;
    get<T = unknown>(keys: string[], options?: DurableObjectGetOptions): Promise<Map<string, T>>;
    put<T>(key: string, value: T, options?: DurableObjectPutOptions): Promise<void>;
    put<T>(entries: Record<string, T>, options?: DurableObjectPutOptions): Promise<void>;
    delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
    delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
    deleteAll(options?: DurableObjectPutOptions): Promise<void>;
    list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>;
    // Alarms
    getAlarm(options?: DurableObjectGetAlarmOptions): Promise<number | null>;
    setAlarm(scheduledTime: number | Date, options?: DurableObjectSetAlarmOptions): Promise<void>;
    deleteAlarm(options?: DurableObjectSetAlarmOptions): Promise<void>;
    // Transactions (if needed)
    // transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T>;
    // sync(): Promise<void>;
}

interface DurableObjectId {
    readonly name?: string;
    toString(): string;
    equals(other: DurableObjectId): boolean;
}

// Define options interfaces if needed
interface DurableObjectGetOptions {
    allowConcurrency?: boolean;
    noCache?: boolean;
}

interface DurableObjectPutOptions {
    allowConcurrency?: boolean;
    allowUnconfirmed?: boolean;
    noCache?: boolean;
}

interface DurableObjectListOptions extends DurableObjectGetOptions {
    start?: string;
    startAfter?: string;
    end?: string;
    prefix?: string;
    reverse?: boolean;
    limit?: number;
}

interface DurableObjectGetAlarmOptions {
    allowConcurrency?: boolean;
}

interface DurableObjectSetAlarmOptions {
    allowConcurrency?: boolean;
    allowUnconfirmed?: boolean;
} 