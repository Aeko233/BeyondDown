# BeyondDown

一个轻量的 Bilibili 视频下载工具，帮助用户解析视频并导出可直接下载的任务。

## 特性

- **多种登录方式**：扫码、Cookie、`cookies.txt` / JSON 导入。
- **视频解析**：视频信息、WBI 签名、DASH 音视频轨解析。
- **灵活导出**：`.bat`、`.sh`、aria2、yt-dlp、直链下载任务。
- **低服务器带宽**：下载脚本和直链由用户端直接请求 Bilibili CDN。
- **安全会话**：AES-GCM 加密的无状态 Bearer 会话令牌。

## 快速开始

需要 [Bun](https://bun.sh/)。

```bash
bun install
bun run build
```

然后分别启动 API 和前端：

```bash
# 终端 1
bun run dev:api       # http://localhost:8788

# 终端 2
bun run dev           # http://localhost:5173
```

运行检查：

```bash
bun run check
```

## 部署

### Cloudflare Workers

```bash
bun x wrangler login
bun x wrangler secret put SESSION_SECRET
bun run deploy
```

Cloudflare 海外出口可能被 Bilibili 风控拦截。生产环境请在 `wrangler.toml` 配置可用的 `API_PROXY` 或 `BILI_PROXY`，并按需设置 `SITE_ORIGIN`。

### 支付宝云函数

```bash
bun run pack:alipay   # 生成 dist/beyonddown-fn.zip，到控制台手动上传
```

前端 `config.toml` 的 `api_base` 指向该函数直连，Cloudflare 只托管静态。

### 独立服务器

```bash
bun run build
bun server.mjs        # http://localhost:8788
```

## License

本项目采用 [GNU General Public License v3.0](./LICENSE) 授权。
