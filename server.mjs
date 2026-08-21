// 生产独立服务器（bun server.mjs）：静态 + API 单进程，复用 worker.js 路由。
// 适用于任意 VPS / 容器 / 国内函数计算的 Web 模式部署。
//
// 环境变量：
//   PORT            监听端口（默认 8788）
//   SESSION_SECRET  令牌加密密钥（生产必须设置）
//   SITE_ORIGIN     允许的前端源（CORS；缺省 *，纯 Bearer 认证下可接受）
//   BILI_PROXY      B站上游反向代理前缀（可选）
import worker from "./worker.js";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 8788);
const ROOT = join(import.meta.dir, "dist", "web");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

const env = {
  SESSION_SECRET: process.env.SESSION_SECRET,
  SITE_ORIGIN: process.env.SITE_ORIGIN,
  BILI_PROXY: process.env.BILI_PROXY,
  ASSETS: {
    fetch: async (req) => {
      const url = new URL(req.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      const safe = normalize(pathname).replace(/^([/\\])+/, "");
      if (safe.includes("..")) return new Response("Forbidden", { status: 403 });
      const file = Bun.file(join(ROOT, safe));
      if (await file.exists()) {
        return new Response(file, { headers: { "content-type": MIME[extname(safe)] || "application/octet-stream" } });
      }
      return new Response("Not Found", { status: 404 });
    },
  },
};

Bun.serve({
  port: PORT,
  fetch: (request) => worker.fetch(request, env, { waitUntil: () => {} }),
});

console.log(`beyonddown server: http://localhost:${PORT}`);
