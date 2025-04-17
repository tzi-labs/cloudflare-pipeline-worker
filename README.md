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

### 2. Create a Pipeline

To create a pipeline using Wrangler, run the following command in a terminal, and specify:

*   The name of your pipeline
*   The name of the R2 bucket you created in step 1

```bash
npx wrangler pipelines create my-clickstream-pipeline --r2-bucket my-bucket --batch-max-seconds 5 --compression none
```

After running this command, you will be prompted to authorize Cloudflare Workers Pipelines to create an R2 API token on your behalf. These tokens are used by your pipeline when loading data into your bucket. You can approve the request through the browser link which will open automatically.

**Choosing a pipeline name:**

You will notice two optional flags are set while creating the pipeline: `--batch-max-seconds` and `--compression`. These flags are added to make it faster for you to see the output of your first pipeline. For production use cases, we recommend keeping the default settings.

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

Open the [R2 dashboard](https://dash.cloudflare.com/?to=/:account/r2) ↗, and navigate to the R2 bucket you created in step 1. You will see a directory, labeled with today's date (such as `event_date=2025-04-05`). Click on the directory, and you'll see a sub-directory with the current hour (such as `hr=04`). You should see a newline delimited JSON file, containing the data you posted in step 3. Download the file, and open it in a text editor of your choice, to verify that the data posted in step 3 is present.

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