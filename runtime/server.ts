import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, relative } from "node:path";
import { DiskStore } from "./store.ts";
import { AnalysisService } from "./service.ts";

export function startRuntime(
  options: {
    port?: number;
    directory?: string;
    workspaceId?: string;
    serve?: boolean;
  } = {},
) {
  const workspaceId =
      options.workspaceId ?? process.env.RIVERLINE_WORKSPACE ?? "local",
    directory =
      options.directory ??
      process.env.RIVERLINE_DATA ??
      resolve(".data/riverline-s1", workspaceId);
  const service = new AnalysisService(new DiskStore(directory, workspaceId)),
    token = randomUUID();
  const server = createServer(async (req, res) => {
    const respond = (code: number, value: unknown) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    const origin = req.headers.origin;
    if (
      !/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(req.headers.host ?? "") ||
      (origin &&
        origin !== `http://${req.headers.host}` &&
        !/^http:\/\/(127\.0\.0\.1|localhost):(5173|4173)$/.test(origin))
    ) {
      respond(403, {
        ok: false,
        code: "INFORMATION_RESTRICTED",
        message: "不允许此来源",
      });
      return;
    }
    if (
      options.serve &&
      req.method === "GET" &&
      !req.url?.startsWith("/api/")
    ) {
      try {
        const root = resolve("dist"),
          path = resolve(
            root,
            "." +
              decodeURIComponent(
                new URL(req.url ?? "/", "http://localhost").pathname,
              ),
          );
        if (relative(root, path).startsWith("..")) {
          res.writeHead(403);
          res.end();
          return;
        }
        const target =
          existsSync(path) && statSync(path).isFile()
            ? path
            : extname(path)
              ? undefined
              : resolve(root, "index.html");
        if (!target || !existsSync(target)) {
          res.writeHead(404);
          res.end("请先运行 npm run build");
          return;
        }
        const mime: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
          ".woff2": "font/woff2",
        };
        res.writeHead(200, {
          "Content-Type": mime[extname(target)] ?? "application/octet-stream",
          "Cache-Control":
            extname(target) === ".html" ? "no-cache" : "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        });
        res.end(readFileSync(target));
        return;
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
    }
    if (req.url === "/api/analysis/session" && req.method === "GET") {
      respond(200, { workspaceId, token, revision: service.state.revision });
      return;
    }
    if (req.url === "/api/analysis/health") {
      respond(200, { workspaceId, ready: true });
      return;
    }
    if (req.headers["x-riverline-session"] !== token) {
      respond(403, {
        ok: false,
        code: "INFORMATION_RESTRICTED",
        message: "本地会话已失效，请重新连接",
      });
      return;
    }
    if (req.method !== "POST") {
      respond(405, {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "需要 POST",
      });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 1048576) {
          respond(413, {
            ok: false,
            code: "RESOURCE_LIMIT",
            message: "请求超过1MiB，请使用分块导入",
          });
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        tool?: string;
        input?: unknown;
        uri?: string;
      };
      if (req.url === "/api/analysis/resources") {
        respond(200, { resources: service.resources() });
        return;
      }
      if (req.url === "/api/analysis/resource") {
        respond(200, service.readResource(body.uri ?? ""));
        return;
      }
      respond(200, await service.executeAsync(body.tool ?? "", body.input));
    } catch (error) {
      respond(400, {
        ok: false,
        code: "VALIDATION_ERROR",
        message: error instanceof Error ? error.message : "输入无效",
      });
    }
  });
  server.listen(
    options.port ?? Number(process.env.RIVERLINE_PORT ?? 5174),
    "127.0.0.1",
  );
  return {
    server,
    service,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          service.close();
          resolve();
        });
      }),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const runtime = startRuntime({ serve: process.argv.includes("--serve") });
  runtime.server.on("listening", () => {
    const address = runtime.server.address();
    if (address && typeof address !== "string")
      process.send?.({ ready: true, port: address.port });
  });
  console.log("Riverline 本地分析运行时已启动");
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      void runtime.close().then(() => process.exit(0));
    });
}
