import mongoose from "mongoose";
import { isLoopbackHost, resolveServerConfig } from "./config";
import { ServerStartError, startServer } from "./server";
import { UserManager } from "./UserManager";

async function main() {
  // Resolved before touching Mongo, so a bad AGGCODE_PORT fails fast instead
  // of connecting to the database and only then discovering the port is bad.
  let config: ReturnType<typeof resolveServerConfig>;
  try {
    config = resolveServerConfig(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (!isLoopbackHost(config.host)) {
    console.warn(
      `AGGCODE_HOST=${config.host} is not loopback. The agent is reachable ` +
        "from other machines on this network and is unauthenticated.",
    );
  }

  try {
    await mongoose.connect(process.env.DB_URL!);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  try {
    const server = await startServer({
      host: config.host,
      port: config.port,
      onConnection: (ws) => {
        UserManager.getInstance().addUser(ws);
      },
    });
    console.log(
      `WebSocket server listening on ws://${config.host}:${server.port}`,
    );
  } catch (err) {
    if (err instanceof ServerStartError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

main();
