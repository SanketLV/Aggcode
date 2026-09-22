import { describe, expect, test } from "bun:test";
import WebSocket from "ws";
import { startServer } from "./server";

describe("startServer", () => {
  test("binding to port 0 resolves a real port and accepts a connection", async () => {
    let connected = false;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      onConnection: () => {
        connected = true;
      },
    });

    expect(server.port).toBeGreaterThan(0);

    const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve, reject) => {
      client.on("open", resolve);
      client.on("error", reject);
    });

    expect(connected).toBe(true);

    client.close();
    await server.close();
  });

  test("close() frees the port for reuse", async () => {
    const first = await startServer({ host: "127.0.0.1", port: 0 });
    const port = first.port;
    await first.close();

    const second = await startServer({ host: "127.0.0.1", port });
    expect(second.port).toBe(port);
    await second.close();
  });

  test("a second server on the same port rejects with kind 'in-use'", async () => {
    const first = await startServer({ host: "127.0.0.1", port: 0 });

    try {
      await expect(
        startServer({ host: "127.0.0.1", port: first.port }),
      ).rejects.toMatchObject({
        kind: "in-use",
      });
    } finally {
      await first.close();
    }
  });

  test("the in-use error names the port and AGGCODE_PORT", async () => {
    const first = await startServer({ host: "127.0.0.1", port: 0 });

    try {
      const err = await startServer({
        host: "127.0.0.1",
        port: first.port,
      }).catch((e) => e);
      expect(err.message).toContain(String(first.port));
      expect(err.message).toContain("AGGCODE_PORT");
    } finally {
      await first.close();
    }
  });
});
