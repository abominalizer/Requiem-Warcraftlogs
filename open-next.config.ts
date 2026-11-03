import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig({});

// `npm run build` runs the OpenNext (Cloudflare) build, which in turn runs this plain Next.js build.
config.buildCommand = "npm run build:next";

export default config;
