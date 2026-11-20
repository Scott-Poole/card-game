import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get, request as httpRequest } from "node:http";
import { afterEach, beforeEach, expect, test } from "vitest";
import { startServer, type ServerHandle } from "./index.ts";
let root: string;
let server: ServerHandle;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "static-"));
  const client = join(root, "client");
  await mkdir(client);
  await writeFile(join(root, "secret.txt"), "private");
  for (const name of [
    "index.html",
    "app.js",
    "app.css",
    "logo.svg",
    "data.json",
    "image.png",
    "font.woff2",
  ])
    await writeFile(join(client, name), name);
  await symlink(join(root, "secret.txt"), join(client, "leak.txt"));
  await symlink(root, join(client, "outside"));
  server = await startServer({ port: 0, clientDirectory: client });
});
afterEach(async () => {
  server.close();
  await rm(root, { recursive: true, force: true });
});
function request(path: string): Promise<{
  status: number | undefined;
  type: string | undefined;
  length: string | undefined;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    get({ hostname: "localhost", port: server.port, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          type: res.headers["content-type"],
          length: res.headers["content-length"],
          body,
        });
      });
    }).on("error", reject);
  });
}
test.each([
  ["/", "text/html"],
  ["/app.js", "text/javascript"],
  ["/app.css", "text/css"],
  ["/logo.svg", "image/svg+xml"],
  ["/data.json", "application/json"],
  ["/image.png", "image/png"],
  ["/font.woff2", "font/woff2"],
  ["/route/nested", "text/html"],
])("serves %s", async (path, type) => {
  const response = await request(path);
  expect(response.status).toBe(200);
  expect(response.type).toContain(type);
  expect(response.body).toBe(
    path === "/" || path === "/route/nested" ? "index.html" : path.slice(1),
  );
});
test.each([
  "/../secret.txt",
  "/%2e%2e/secret.txt",
  "/%2E%2E%2Fsecret.txt",
  "/..%5csecret.txt",
  "/%252e%252e/secret.txt",
  "/leak.txt",
  "/outside/secret.txt",
  "/outside/missing",
  "/%00",
  "/%ZZ",
])("rejects raw traversal %s", async (path) => {
  const response = await request(path);
  expect(response.status).toBe(403);
  expect(response.body).not.toContain("private");
});
test.each(["/waiting", "/match", "/result", "/unknown"])(
  "client route %s serves the app entry",
  async (path) => {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.type).toContain("text/html");
    expect(response.body).toBe("index.html");
  },
);
test.each([
  "/missing.js",
  "/missing.css",
  "/assets/missing.png",
  "/missing.json",
])("missing asset %s is 404", async (path) => {
  expect((await request(path)).status).toBe(404);
});

test.each([
  ["/app.js", 200],
  ["/missing.js", 404],
])(
  "HEAD %s matches GET headers without a response body",
  async (path, status) => {
    const getResponse = await request(path);
    const response = await new Promise<{
      status: number | undefined;
      type: string | undefined;
      length: string | undefined;
      body: string;
    }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "localhost",
          port: server.port,
          path,
          method: "HEAD",
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on("end", () => {
            resolve({
              status: res.statusCode,
              type: res.headers["content-type"],
              length: res.headers["content-length"],
              body,
            });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(getResponse.status).toBe(status);
    expect(response.status).toBe(getResponse.status);
    expect(response.type).toBe(getResponse.type);
    expect(getResponse.length).toBeDefined();
    expect(response.length).toBe(getResponse.length);
    expect(response.body).toBe("");
  },
);

test.each(
  (["POST", "PUT", "DELETE", "PATCH"] as const).flatMap((method) =>
    (["/", "/app.js"] as const).map((path) => [method, path] as const),
  ),
)(
  "%s %s is 405 with an Allow header and no file contents",
  async (method, path) => {
    const response = await new Promise<{
      status: number | undefined;
      allow: string | undefined;
      body: string;
    }>((resolve, reject) => {
      const req = httpRequest(
        { hostname: "localhost", port: server.port, path, method },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({
              status: res.statusCode,
              allow: res.headers.allow,
              body,
            });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(response.status).toBe(405);
    expect(response.allow).toBe("GET, HEAD");
    expect(response.body).not.toContain(path === "/" ? "index.html" : "app.js");
  },
);
