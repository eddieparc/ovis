import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { appName, CONTENT_SECURITY_POLICY, contentSecurityPolicy, DEFAULT_FRAME_ANCESTORS, frameAncestors, manifestBody, parseFrameAncestors, relateManifest, renameManifest, renameShell, requestOrigin } from "./static.ts";

// The sources Vite builds from: public/ is copied into dist/ as it is, and the meta survives the build.
const root = join(import.meta.dir, "..");
const manifest = readFileSync(join(root, "public", "manifest.webmanifest"), "utf8");
const shell = readFileSync(join(root, "index.html"), "utf8");

describe("OVIS_APP_NAME", () => {
  const previous = process.env["OVIS_APP_NAME"];
  afterEach(() => {
    if (previous === undefined) delete process.env["OVIS_APP_NAME"]; else process.env["OVIS_APP_NAME"] = previous;
  });

  it("is off when unset or blank", () => {
    delete process.env["OVIS_APP_NAME"];
    expect(appName()).toBeNull();
    process.env["OVIS_APP_NAME"] = "   ";
    expect(appName()).toBeNull();
    process.env["OVIS_APP_NAME"] = "  work laptop ";
    expect(appName()).toBe("work laptop");
  });

  it("renames the manifest and keeps everything else, the id included", () => {
    const renamed = JSON.parse(renameManifest(manifest, "laptop")) as Record<string, unknown>;
    const original = JSON.parse(manifest) as Record<string, unknown>;
    expect(renamed).toEqual({ ...original, name: "laptop", short_name: "laptop" });
    expect(renamed["id"]).toBe("/");
  });

  it("relates the manifest to its own absolute id and keeps everything else", () => {
    const related = JSON.parse(relateManifest(manifest, "http://127.0.0.1:7317")) as Record<string, unknown>;
    const original = JSON.parse(manifest) as Record<string, unknown>;
    expect(related).toEqual({ ...original, related_applications: [{ platform: "webapp", id: "http://127.0.0.1:7317/" }] });
    expect(original["related_applications"]).toBeUndefined();
  });

  it("relates the manifest after the rename, and without one", () => {
    delete process.env["OVIS_APP_NAME"];
    const plain = JSON.parse(manifestBody(manifest, "https://pc.example")) as Record<string, unknown>;
    expect(plain["name"]).toBe((JSON.parse(manifest) as Record<string, unknown>)["name"]);
    expect(plain["related_applications"]).toEqual([{ platform: "webapp", id: "https://pc.example/" }]);
    process.env["OVIS_APP_NAME"] = "laptop";
    const named = JSON.parse(manifestBody(manifest, "https://pc.example")) as Record<string, unknown>;
    expect(named).toMatchObject({ name: "laptop", short_name: "laptop", id: "/" });
    expect(named["related_applications"]).toEqual([{ platform: "webapp", id: "https://pc.example/" }]);
  });

  it("takes the origin from the Host header and the proxy's scheme", () => {
    expect(requestOrigin(new Request("http://127.0.0.1:7317/manifest.webmanifest"))).toBe("http://127.0.0.1:7317");
    expect(requestOrigin(new Request("http://127.0.0.1:7317/x", { headers: { host: "pc.tailnet.ts.net", "x-forwarded-proto": "https" } })))
      .toBe("https://pc.tailnet.ts.net");
    expect(requestOrigin(new Request("http://127.0.0.1:7317/x", { headers: { "x-forwarded-proto": "wss" } }))).toBe("http://127.0.0.1:7317");
  });

  it("renames the iOS home-screen title in the shell and nothing else", () => {
    const renamed = renameShell(shell, "laptop");
    expect(renamed).toContain('<meta name="apple-mobile-web-app-title" content="laptop" />');
    expect(renamed.replace("content=\"laptop\"", "content=\"Ovis\"")).toBe(shell);
  });

  it("frames the other ports of the request's own host and no other host", () => {
    expect(contentSecurityPolicy("http://100.123.228.51:7317")).toContain("frame-src 'self' http://100.123.228.51:* https://100.123.228.51:*;");
    expect(contentSecurityPolicy("https://pc.tailnet.ts.net")).toContain("frame-src 'self' http://pc.tailnet.ts.net:* https://pc.tailnet.ts.net:*;");
    expect(contentSecurityPolicy("http://[::1]:7317")).toContain("frame-src 'self' http://[::1]:* https://[::1]:*;");
    expect(contentSecurityPolicy("http://100.123.228.51:7317").replace(/ http:\/\/\S+ https:\/\/\S+;/, ";")).toBe(CONTENT_SECURITY_POLICY);
  });

  it("keeps frame-src to itself without an origin or with a host that is no host name", () => {
    expect(contentSecurityPolicy()).toBe(CONTENT_SECURITY_POLICY);
    expect(contentSecurityPolicy("not a url")).toBe(CONTENT_SECURITY_POLICY);
    expect(contentSecurityPolicy("http://a_b;script-src *")).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toContain("frame-src 'self';");
  });

  it("fetches the manifest with the page's cookies, so a sign-in proxy lets it through", () => {
    expect(shell).toMatch(/<link rel="manifest" href="[^"]+" crossorigin="use-credentials" \/>/);
  });

  it("escapes the name in the shell", () => {
    const renamed = renameShell(shell, `a"b<c>&$1 $&`);
    expect(renamed).toContain('content="a&quot;b&lt;c&gt;&amp;$1 $&amp;"');
  });
});

describe("OVIS_FRAME_ANCESTORS", () => {
  const previous = process.env["OVIS_FRAME_ANCESTORS"];
  afterEach(() => {
    if (previous === undefined) delete process.env["OVIS_FRAME_ANCESTORS"]; else process.env["OVIS_FRAME_ANCESTORS"] = previous;
  });

  it("defaults to exactly the project board's origins", () => {
    expect(DEFAULT_FRAME_ANCESTORS).toEqual(["https://pms.oliveline.app", "http://127.0.0.1:2969", "http://pms.localhost:2969"]);
    expect(parseFrameAncestors(undefined)).toEqual({ origins: [...DEFAULT_FRAME_ANCESTORS], rejected: [] });
    delete process.env["OVIS_FRAME_ANCESTORS"];
    expect(frameAncestors()).toEqual([...DEFAULT_FRAME_ANCESTORS]);
    expect(contentSecurityPolicy(undefined, frameAncestors()))
      .toContain("; frame-ancestors https://pms.oliveline.app http://127.0.0.1:2969 http://pms.localhost:2969");
  });

  it("takes exact origins separated by spaces or commas, normalized and once each", () => {
    expect(parseFrameAncestors("https://board.example, http://127.0.0.1:2969  HTTPS://Board.Example/ https://board.example:8443"))
      .toEqual({ origins: ["https://board.example", "http://127.0.0.1:2969", "https://board.example:8443"], rejected: [] });
  });

  it("drops wildcards, bare schemes, keywords and anything that is not an origin", () => {
    const rejected = ["*", "https://*.example.com", "https://example.com:*", "*.example.com", "https:", "http:", "https://",
      "'self'", "'none'", "'unsafe-inline'", "data:", "blob:", "ftp://example.com", "javascript:alert(1)",
      "https://example.com/path", "https://example.com/.", "https://example.com?x", "https://example.com#x",
      "https://user:pass@example.com", "example.com", "https://a_b", "https://example.com;script-src"];
    expect(parseFrameAncestors(rejected.join(" "))).toEqual({ origins: [], rejected });
    expect(parseFrameAncestors(`* https://pms.example https://*.example.com`)).toEqual({ origins: ["https://pms.example"], rejected: ["*", "https://*.example.com"] });
  });

  it("frames nothing when set empty or to none, and warns once about what it dropped", () => {
    expect(parseFrameAncestors("")).toEqual({ origins: [], rejected: [] });
    expect(parseFrameAncestors("none")).toEqual({ origins: [], rejected: [] });
    process.env["OVIS_FRAME_ANCESTORS"] = "";
    expect(contentSecurityPolicy(undefined, frameAncestors())).toBe(CONTENT_SECURITY_POLICY);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env["OVIS_FRAME_ANCESTORS"] = "https://*.example.com *";
      expect(frameAncestors()).toEqual([]);
      expect(frameAncestors()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("https://*.example.com");
      expect(contentSecurityPolicy(undefined, frameAncestors())).toContain("frame-ancestors 'none'");
    } finally {
      warn.mockRestore();
    }
  });

  it("puts only the allowed origins into frame-ancestors and leaves every other directive as it was", () => {
    const policy = contentSecurityPolicy("https://pc.tailnet.ts.net", ["https://pms.example", "https://*.evil.example", "*", "'self'"]);
    expect(policy).toContain("; frame-ancestors https://pms.example");
    expect(policy.split("; ").find((directive) => directive.startsWith("frame-ancestors"))).toBe("frame-ancestors https://pms.example");
    expect(policy).not.toContain("evil");
    expect(policy).not.toContain("frame-ancestors 'none'");
    expect(policy.replace("frame-ancestors https://pms.example", "frame-ancestors 'none'")).toBe(contentSecurityPolicy("https://pc.tailnet.ts.net"));
    expect(contentSecurityPolicy(undefined, ["*"])).toBe(CONTENT_SECURITY_POLICY);
  });
});
