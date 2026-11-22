import { createServer } from "node:net";

// Linux only lets a second uWebSockets.js server share a port when the first bound it
// explicitly (SO_REUSEPORT); a port-0 bind gets an ephemeral port the kernel never shares.
// So these tests claim a free port number first and bind it by name.
export async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  if (address === null || typeof address === "string")
    throw new Error("No port bound");
  return address.port;
}

// Only the first server's setup belongs inside this callback.
export async function startOnExplicitPort<T>(
  start: (port: number) => Promise<T>,
  probe = freePort,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const port = await probe();
    try {
      return await start(port);
    } catch (error) {
      const message = `Unable to listen on port ${String(port)}`;
      const collision =
        error instanceof Error &&
        (error.message === message ||
          (error.message.startsWith("Server exited before listening: ") &&
            error.message.split("\n").includes(`Error: ${message}`)));
      if (!collision || attempt === 5) throw error;
    }
  }
}
