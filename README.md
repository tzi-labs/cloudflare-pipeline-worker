# Cloudflare Pipelines Setup and Usage

This guide explains how to set up and use Cloudflare Pipelines to send data to an R2 bucket.

## Prerequisites

To use Pipelines, you will need:

*   Sign up for a [Cloudflare account](https://dash.cloudflare.com/sign-up).
*   Install [Node.js](https://nodejs.org/).
*   A Node.js version manager (optional but recommended).

## Steps

### 1. Set up an R2 bucket

Create a bucket by following the [get started guide for R2](https://developers.cloudflare.com/r2/get-started/), or by running the command below:

```bash
npx wrangler r2 bucket create my-bucket
```

Save the bucket name for the next step.

### 2. Create or Update a Pipeline

If creating a new pipeline, use `create`. If updating an existing one, use `update`.
Specify your pipeline name and the target R2 bucket.

**Example Update Command:**
Use this command to set the R2 bucket, batching parameters (max 300 seconds), and enable gzip compression:

```bash
npx wrangler pipelines update my-clickstream-pipeline --r2-bucket pipeline-test-1 --batch-max-seconds 300   --batch-max-mb 100   --batch-max-rows 10000000 --compression gzip
```

After running this command, you may be prompted to authorize Cloudflare Workers Pipelines to access your R2 bucket.

Once you create your pipeline, you will receive a summary of your pipeline's configuration, as well as an HTTP endpoint which you can post data to:

```
🌀 Authorizing R2 bucket "my-bucket"
🌀 Creating pipeline named "my-clickstream-pipeline"
✅ Successfully created pipeline my-clickstream-pipeline

Id:    [PIPELINE-ID]
Name:  my-clickstream-pipeline
Sources:
  HTTP:
    Endpoint:        https://[PIPELINE-ID].pipelines.cloudflare.com/
    Authentication:  off
    Format:          JSON
  Worker:
    Format:  JSON
Destination:
  Type:         R2
  Bucket:       my-bucket
  Format:       newline-delimited JSON
  Compression:  GZIP
Batch hints:
  Max bytes:     100 MB
  Max duration:  300 seconds
  Max records:   100,000

🎉 You can now send data to your Pipeline!

Send data to your Pipeline's HTTP endpoint:
curl "https://[PIPELINE-ID].pipelines.cloudflare.com/" -d '[{ ...JSON_DATA... }]'

To send data to your Pipeline from a Worker, add the following configuration to your config file:
{
  "pipelines": [
    {
      "pipeline": "my-clickstream-pipeline",
      "binding": "PIPELINE"
    }
  ]
}
```

### 3. Post data to your pipeline

Use a `curl` command in your terminal to post an array of JSON objects to the endpoint you received in step 2. Replace `<HTTP-ENDPOINT>` with the actual endpoint URL.

```bash
curl -H "Content-Type:application/json" \
    -d '[{"event":"viewedCart", "timestamp": "2025-04-03T15:42:30Z"},{"event":"cartAbandoned", "timestamp": "2025-04-03T15:42:37Z"}]' \
    <HTTP-ENDPOINT>
```

Once the pipeline successfully accepts the data, you will receive a success message.

You can continue posting data to the pipeline. The pipeline will automatically buffer ingested data. Based on the batch settings (`--batch-max-seconds`) specified in step 2, a batch will be generated every 5 seconds, turned into a file, and written out to your R2 bucket.

### 4. Verify in R2

Open the [R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2) ↗, and navigate to the R2 bucket you created in step 1. You will see a directory, labeled with today's date (such as `event_date=2025-04-05`). Click on the directory, and you'll see a sub-directory with the current hour (such as `hr=04`). You should see files (e.g., `.json.gz` if compression is enabled) containing the data posted in step 3. Download a file, decompress if necessary, and open it in a text editor to verify that the data posted in step 3 is present.

## Alternative: In-Worker Batching with Durable Objects

This project also includes an `EventBuffer` Durable Object (DO) which provides an alternative batching mechanism *within* the Worker itself, before data is even sent to the Cloudflare Pipeline service.

**How it works:**

*   When enabled, incoming requests are routed to a single instance of the `EventBuffer` DO.
*   The DO collects events in an internal buffer (`this.buffer`).
*   It sends the accumulated batch to the Cloudflare Pipeline service (`env.PIPELINE.send(batch)`) only when either:
    *   The number of buffered events reaches `MAX_BATCH_SIZE` (currently 1000 in `src/EventBuffer.ts`).
    *   A flush timer (`FLUSH_INTERVAL`, currently 5 minutes) expires.
    *   A size limit check prevents the buffer stored in DO Storage from exceeding ~120KB (to stay under the 128KB limit per value in DO storage).

**Benefits:**

*   Can reduce the number of `send` calls to the Pipeline service, potentially lowering costs if those calls are billed.
*   Allows for batching logic independent of the Pipeline service's own batching rules.

**Limitations:**

*   **DO Storage Limit:** The buffer is periodically saved to DO storage. Cloudflare Durable Objects have a limit of 128 KiB per key-value pair. The code attempts to flush the buffer *before* saving if adding a new event would exceed ~120 KiB, but extremely large individual events could still pose a challenge.
*   **Single Instance:** This implementation uses a single DO instance (`idFromName("global-event-buffer")`). High traffic volumes might overwhelm a single DO instance.

**How to Enable/Disable:**

*   The behavior is controlled by the `USE_DURABLE_OBJECT` variable in `wrangler.toml`:
    ```toml
    [vars]
    USE_DURABLE_OBJECT = true  # Set to true to use DO batching, false to send directly
    ```
*   Set to `true` to use the Durable Object batching.
*   Set to `false` (the current default) to bypass the DO and send data from each request directly to the Pipeline service (the Pipeline service will still batch based on its own settings before writing to R2).
*   Remember to redeploy (`npx wrangler deploy`) after changing this value.

## Next steps

*   Learn about how to set up [authentication](https://developers.cloudflare.com/pipelines/reference/authentication/) or [CORS settings](https://developers.cloudflare.com/pipelines/reference/http-sources/#cors-configuration) on your HTTP endpoint.
*   Send data to your Pipeline from a Cloudflare Worker using the [Workers API documentation](https://developers.cloudflare.com/pipelines/reference/workers-api/).
*   If you have any feature requests or notice any bugs, share your feedback directly with the Cloudflare team by joining the [Cloudflare Developers community on Discord](https://discord.gg/cloudflaredev).

### Integrating with a Tracking Pixel

If you are using a tracking pixel solution like [tzi-labs/tracking-pixel](https://github.com/tzi-labs/tracking-pixel), follow these steps after creating your pipeline:

1.  Once you have successfully created your pipeline using the steps above, you will receive an HTTP endpoint URL (e.g., `https://[PIPELINE-ID].pipelines.cloudflare.com/`).
2.  In your clone of the `tzi-labs/tracking-pixel` repository, locate or create the `.env` file.
3.  Add or update the `OPIX_PIXEL_ENDPOINT` variable in the `.env` file, setting its value to the HTTP endpoint URL you obtained in step 1:

    ```dotenv
    OPIX_PIXEL_ENDPOINT=https://[PIPELINE-ID].pipelines.cloudflare.com/
    ```

4.  Follow the build and deployment instructions within the `tzi-labs/tracking-pixel` repository to use this endpoint for sending tracking data. 