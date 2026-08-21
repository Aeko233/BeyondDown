// 本地开发服务器（DEV=1 bun dev-server.mjs）：复用 worker.js 生产路由。
// DEV=1 时额外提供 /api/dev/token——签发一个伪造登录态的令牌，用于测试登录门控的端点
// （伪造 SESSDATA 会触发 -101 匿名降级分支，正好一并覆盖）。
import worker from "./worker.js";
import { newSession, issueToken } from "./lib/session.js";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 8788);
const ROOT = join(import.meta.dir, "dist", "web");
const DEV = process.env.DEV === "1" || process.env.DEV === "true";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
};

const env = {
    SESSION_SECRET:
        process.env.SESSION_SECRET || "beyonddown-dev-secret-change-me",
    SITE_ORIGIN: process.env.SITE_ORIGIN,
    BILI_PROXY: process.env.BILI_PROXY,
    API_PROXY: process.env.API_PROXY,
    ASSETS: {
        fetch: async (req) => {
            const url = new URL(req.url);
            let pathname = decodeURIComponent(url.pathname);
            if (pathname === "/") pathname = "/index.html";
            const safe = normalize(pathname).replace(/^([/\\])+/, "");
            if (safe.includes(".."))
                return new Response("Forbidden", { status: 403 });
            const file = Bun.file(join(ROOT, safe));
            if (await file.exists()) {
                return new Response(file, {
                    headers: {
                        "content-type":
                            MIME[extname(safe)] || "application/octet-stream",
                    },
                });
            }
            return new Response("Not Found", { status: 404 });
        },
    },
};

Bun.serve({
    port: PORT,
    async fetch(request) {
        if (DEV && new URL(request.url).pathname === "/api/dev/token") {
            const session = newSession();
            session.login = {
                sessdata: "dev-seed-invalid",
                bili_jct: "",
                dedeuserid: "",
                ckmd5: "",
                uid: 1,
                uname: "dev测试",
                face: "",
                vip: false,
            };
            return Response.json({ token: await issueToken(session, env) });
        }
        return worker.fetch(request, env, { waitUntil: () => {} });
    },
});

console.log(
    `dev server: http://localhost:${PORT}${DEV ? "（DEV 模式：GET /api/dev/token 可取测试令牌）" : ""}`,
);
