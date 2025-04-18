export class EventBuffer {
  buffer: any[] = []
  lastFlush = Date.now()
  MAX_BUFFER = 500 // Reverted to original value
  FLUSH_INTERVAL = 1000 * 60 * 60 // 1 hour - Reverted to original value

  constructor(readonly state: DurableObjectState, readonly env: any) {
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
        const data = await request.json();
        this.buffer.push(data);
        console.log(`Buffered event. Buffer size: ${this.buffer.length}`);

        if (this.buffer.length >= this.MAX_BUFFER) {
            console.log("Buffer limit reached, flushing...");
            await this.flushToR2();
        }

        return new Response("Buffered", { status: 202 });
    } catch (e) {
        console.error("Error processing fetch in DO:", e);
        return new Response("Internal Server Error in DO", { status: 500 })
    }
  }

  // alarm() is invoked by the runtime when a scheduled alarm is due
  async alarm() {
    console.log("Alarm triggered, flushing...");
    await this.flushToR2();
    // Schedule the next alarm after the current one has run
    this.state.storage.setAlarm(Date.now() + this.FLUSH_INTERVAL);
    console.log("Next alarm scheduled.");
  }

  async flushToR2() {
    if (this.buffer.length === 0) {
        console.log("Buffer empty, nothing to flush.");
        return;
    }

    const now = new Date();
    // Use UTC time for consistency, format as YYYY-MM-DD/HH
    const year = now.getUTCFullYear();
    const month = (now.getUTCMonth() + 1).toString().padStart(2, '0'); // Month is 0-indexed
    const day = now.getUTCDate().toString().padStart(2, '0');
    const hour = now.getUTCHours().toString().padStart(2, '0');

    const key = `events/${year}-${month}-${day}/${hour}.ndjson`; // hourly partition
    const body = this.buffer.map(e => JSON.stringify(e)).join('\n');

    try {
        await this.env.R2_BUCKET.put(key, body, {
            httpMetadata: { contentType: 'application/x-ndjson' } // Set content type
        });
        console.log(`Flushed ${this.buffer.length} events to R2 key: ${key}`);

        // Clear the buffer *after* successful upload
        this.buffer = [];
        this.lastFlush = Date.now(); // Update last flush time (optional)

    } catch (error) {
        console.error(`Failed to flush events to R2: ${error}`);
        // Optional: Implement retry logic or error handling here
        // Consider *not* clearing the buffer if the put fails, to retry later.
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