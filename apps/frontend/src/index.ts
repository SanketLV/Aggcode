import { serve } from "bun";
import index from "./index.html";
import { buildSocketConfig, resolveWebPort } from "./serverConfig";

let socketConfig: ReturnType<typeof buildSocketConfig>;
let webPort: number;
try {
  socketConfig = buildSocketConfig(process.env);
  webPort = resolveWebPort(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const server = serve({
  port: webPort,
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/config": {
      async GET() {
        return Response.json(socketConfig);
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
