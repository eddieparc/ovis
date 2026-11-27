import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The real static handler derives dist from its module directory: copy its exact source into an
// owned fixture rather than building or replacing the checkout's client (as static-encoding.test.ts).
let root = "";
let serve: (path: string, encoding?: string | null, origin?: string) => Promise<Response>;
const previous = process.env["OVIS_FRAME_ANCESTORS"];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "ovis-frame-ancestors-"));
  mkdirSync(join(root, "server")); mkdirSync(join(root, "dist", "assets"), { recursive: true });
  writeFileSync(join(root, "server", "static.ts"), readFileSync(join(import.meta.dir, "static.ts")));
  writeFileSync(join(root, "dist", "index.html"), "<html>fixture shell</html>");
  writeFileSync(join(root, "dist", "sw.js"), "self;\n");
  writeFileSync(join(root, "dist", "manifest.webmanifest"), "{}");
  writeFileSync(join(root, "dist", "assets", "app-hash.js"), "1;\n");
  serve = (await import(join(root, "server", "static.ts"))).serveStatic;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  if (previous === undefined) delete process.env["OVIS_FRAME_ANCESTORS"]; else process.env["OVIS_FRAME_ANCESTORS"] = previous;
});

const ancestorsOf = (response: Response): string | undefined =>
  response.headers.get("content-security-policy")?.split("; ").find((directive) => directive.startsWith("frame-ancestors"));
const ORIGIN = "https://pc.tailnet.ts.net";

test("the app shell may be framed by the project board's origins by default, and by nothing else", async () => {
  delete process.env["OVIS_FRAME_ANCESTORS"];
  for (const path of ["/", "/index.html", "/some/deep/link"]) {
    const shell = await serve(path, null, ORIGIN);
    expect(ancestorsOf(shell)).toBe("frame-ancestors https://pms.oliveline.app http://127.0.0.1:2969 http://pms.localhost:2969");
    expect(shell.headers.get("x-frame-options")).toBeNull();
  }
});

test("every answer that is not the shell keeps frame-ancestors 'none'", async () => {
  delete process.env["OVIS_FRAME_ANCESTORS"];
  for (const path of ["/sw.js", "/manifest.webmanifest", "/assets/app-hash.js", "/assets/missing.js", "/icons/missing.png"]) {
    expect(ancestorsOf(await serve(path, null, ORIGIN))).toBe("frame-ancestors 'none'");
  }
});

test("the shell follows OVIS_FRAME_ANCESTORS and never carries a wildcard or an origin not listed", async () => {
  process.env["OVIS_FRAME_ANCESTORS"] = "https://board.example * https://*.example.com https:";
  const shell = await serve("/", null, ORIGIN);
  expect(ancestorsOf(shell)).toBe("frame-ancestors https://board.example");
  expect(shell.headers.get("content-security-policy")).not.toContain("pms.oliveline.app");
  expect(shell.headers.get("content-security-policy")).not.toContain("*.example.com");
  process.env["OVIS_FRAME_ANCESTORS"] = "";
  expect(ancestorsOf(await serve("/", null, ORIGIN))).toBe("frame-ancestors 'none'");
});
