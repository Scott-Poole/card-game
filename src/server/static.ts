import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webp": "image/webp",
};
export function staticResponse(
  directory: string,
  rawPath: string,
): { status: string; type: string; body: Buffer | string } {
  const forbidden = {
    status: "403 Forbidden",
    type: "text/plain",
    body: "Forbidden",
  };
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return forbidden;
  }
  // Reject ambiguous encodings, Windows separators and NUL before resolution.
  if (path.includes("%") || path.includes("\\") || path.includes("\0"))
    return forbidden;
  const root = resolve(directory);
  const inside = (candidate: string) => {
    const rel = relative(root, candidate);
    return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
  };
  let target = resolve(root, `.${path}`);
  if (!inside(target)) return forbidden;
  // Check every existing ancestor too: a missing child of an external symlink
  // must not trigger the SPA fallback.
  try {
    const canonicalRoot = realpathSync(root);
    let ancestor = root;
    for (const part of relative(root, target).split("/")) {
      ancestor = resolve(ancestor, part);
      try {
        const rel = relative(canonicalRoot, realpathSync(ancestor));
        if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
          return forbidden;
      } catch {
        break;
      }
    }
    try {
      if (statSync(target).isDirectory())
        target = resolve(target, "index.html");
    } catch {
      if (!extname(path)) target = resolve(root, "index.html");
    }
    const real = realpathSync(target);
    const rel = relative(canonicalRoot, real);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
      return forbidden;
    return {
      status: "200 OK",
      type: types[extname(target)] ?? "application/octet-stream",
      body: readFileSync(real),
    };
  } catch {
    return { status: "404 Not Found", type: "text/plain", body: "Not found" };
  }
}
