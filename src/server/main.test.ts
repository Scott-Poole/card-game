import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { freePort, startOnExplicitPort } from "./occupied-port.test-support.ts";
import { decodeServerMessage } from "../protocol/messages.ts";

const children: {
  child: ChildProcess;
  closed: Promise<{ code: number | null; signal: string | null }>;
}[] = [];
const directories: string[] = [];
const indexBody = "<!doctype html><title>Entry point fixture</title>";

function launch(port: string, clientDirectory: string) {
  const child = spawn(process.execPath, ["src/server/main.ts"], {
    env: { ...process.env, PORT: port, CLIENT_DIRECTORY: clientDirectory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const closed = new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    },
  );
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const result = { child, closed, output: () => ({ stdout, stderr }) };
  children.push(result);
  return result;
}

afterEach(async () => {
  for (const { child, closed } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await closed;
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

async function fixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "card-game-main-"));
  directories.push(directory);
  await writeFile(join(directory, "index.html"), indexBody);
  return directory;
}

async function listening(server: ReturnType<typeof launch>) {
  const line = await new Promise<string>((resolve, reject) => {
    server.child.stdout.on("data", () => {
      const { stdout } = server.output();
      if (stdout.includes("\n")) resolve(stdout);
    });
    void server.closed.then(() => {
      reject(
        new Error(`Server exited before listening: ${server.output().stderr}`),
      );
    }, reject);
  });
  expect(line).toMatch(/^Listening on port [0-9]+\n$/);
  const port = Number(line.trim().split(" ").at(-1));
  expect(port).toBeGreaterThan(0);
  expect(port).toBeLessThanOrEqual(65535);
  return port;
}

test("PORT=0 announces a working WebSocket port and honours CLIENT_DIRECTORY", async () => {
  const server = launch("0", await fixtureDirectory());
  const port = await listening(server);
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
  try {
    const message = await new Promise<unknown>((resolve, reject) => {
      socket.addEventListener(
        "message",
        (event) => {
          resolve(event.data);
        },
        {
          once: true,
        },
      );
      socket.addEventListener(
        "error",
        () => {
          reject(new Error("WebSocket failed"));
        },
        { once: true },
      );
    });
    expect(decodeServerMessage(message)).toEqual({
      ok: true,
      message: { type: "welcome" },
    });
    const response = await fetch(`http://127.0.0.1:${String(port)}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(indexBody);
    expect(server.output()).toEqual({
      stdout: `Listening on port ${String(port)}\n`,
      stderr: "",
    });
  } finally {
    socket.close();
  }
});

test.each(["abc", "", "70000", "-1", "1.5"])(
  "rejects PORT=%j before listening",
  async (port) => {
    const server = launch(port, await fixtureDirectory());
    const { code, signal } = await server.closed;
    expect(code).not.toBeNull();
    expect(code).not.toBe(0);
    expect(signal).toBeNull();
    expect(server.output().stdout).toBe("");
    expect(server.output().stderr).toContain(
      "PORT must be an integer between 0 and 65535",
    );
  },
);

test.each([false, true])(
  "a second server exits without listening (setup collision: %s)",
  async (collision) => {
    const directory = await fixtureDirectory();
    const blocker = collision ? launch("0", directory) : undefined;
    const occupiedPort = blocker ? await listening(blocker) : undefined;
    let firstProbe = true;
    const port = await startOnExplicitPort(
      async (port) => {
        const first = launch(String(port), directory);
        expect(await listening(first)).toBe(port);
        return port;
      },
      async () => {
        if (firstProbe && occupiedPort !== undefined) {
          firstProbe = false;
          return occupiedPort;
        }
        return freePort();
      },
    );
    const second = launch(String(port), directory);
    const { code, signal } = await second.closed;
    expect(code).not.toBeNull();
    expect(code).not.toBe(0);
    expect(signal).toBeNull();
    const { stdout, stderr } = second.output();
    expect(stdout).not.toContain("Listening");
    expect(stderr).toContain(`Unable to listen on port ${String(port)}`);
  },
);

test.each(["SIGTERM", "SIGINT"] satisfies NodeJS.Signals[])(
  "%s exits cleanly within five seconds and releases the port",
  async (signal) => {
    const server = launch("0", await fixtureDirectory());
    const port = await listening(server);
    const deadline = AbortSignal.timeout(5000);
    const exited = new Promise<never>((_, reject) => {
      deadline.addEventListener(
        "abort",
        () => {
          reject(new Error("Shutdown exceeded five seconds"));
        },
        { once: true },
      );
    });
    expect(server.child.kill(signal)).toBe(true);
    expect(await Promise.race([server.closed, exited])).toEqual({
      code: 0,
      signal: null,
    });
    await expect(
      fetch(`http://127.0.0.1:${String(port)}/`, {
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow();
  },
  10000,
);

test("a missing CLIENT_DIRECTORY fails fast without listening", async () => {
  const directory = join(tmpdir(), "card-game-main-does-not-exist");
  const server = launch("0", directory);
  const { code, signal } = await server.closed;
  expect(code).not.toBeNull();
  expect(code).not.toBe(0);
  expect(signal).toBeNull();
  const { stdout, stderr } = server.output();
  expect(stdout).toBe("");
  expect(stderr).toContain(directory);
  expect(stderr).toContain("pnpm build");
});

test("a CLIENT_DIRECTORY without index.html fails fast without listening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "card-game-main-empty-"));
  directories.push(directory);
  const server = launch("0", directory);
  const { code, signal } = await server.closed;
  expect(code).not.toBeNull();
  expect(code).not.toBe(0);
  expect(signal).toBeNull();
  const { stdout, stderr } = server.output();
  expect(stdout).toBe("");
  expect(stderr).toContain(directory);
  expect(stderr).toContain("pnpm build");
});
