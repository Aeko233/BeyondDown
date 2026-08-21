# AGENTS.md — BeyondDown-web 项目手册（合并版）

给接手本项目的模型。先通读本文再动手。用户用中文交流，快速迭代，会亲自测试并贴报错回来。
本文合并自 CLAUDE.md（行为准则）、commit格式.md（Commit 规范）、旧 AGENTS.md（交接）与 PLAN.md（设计决策精华）；源文件已删除，内容全部内嵌于此。

## 0. 行为准则（强制，源自 CLAUDE.md）

1. **先思考再动手**：不假设、不隐藏困惑。不确定就问；有歧义列出选项，别默默选一个。
2. **简单优先**：最少代码解决。不建单次使用的抽象，不写多余配置/错误处理。200 行能 50 行就重写。
3. **外科手术式修改**：只碰必须碰的，不顺手"改进"相邻代码。你改出的孤儿（未用导入/变量）要清，既有死代码只提不删。每行改动都能追溯到用户请求。
4. **目标驱动**：先定验收标准再实现（"加校验"→"写非法输入测试再让它过"）；多步任务先列 plan 与验证点。
5. **先验证再实现**：B站接口行为必须实测/查阅，不允许凭猜测补行为（§6 事实勿重新推导）。

## 1. Commit 规范（源自 commit格式.md，Conventional Commits）

格式：`<type>(<scope>): <subject>`，空行分隔 body / footer。subject 50 字内，body 72 字折行。

```text
type:  feat 新特性 | fix 修问题 | refactor 重构 | docs 文档 | style 代码格式 | test 测试 | chore 构建/依赖
scope: 影响范围（可空），如 frontend、backend、auth、download、build
```

## 2. 设计规范（强制）

- **`Design.md`（仓库根）是强制性设计规范**：所有 UI/UX 改动必须符合 Apple Style——白底 #fff、辅底 #f5f5f7、强调蓝 #0071e3、大量留白、圆角 rounded-xl/2xl、微妙阴影、无渐变。
- 绝对禁止：`bg-gradient*`、`shadow-2xl`、`shadow-inner`、`border-2/4/8`、过多颜色、花哨装饰、玻璃态作默认。
- 交互必备：hover / focus-visible 反馈、prefers-reduced-motion 备选、移动端适配。
- 完整细则：`apple-style-hard-prompt.md`（用户侧未跟踪文件）。

## 3. 项目是什么

B站视频下载 Web 应用。前端 **Vite + Vanilla TypeScript**；后端统一 Worker 路由（Cloudflare Workers / 支付宝云函数 / 独立 bun 服务器三端共用）。视频字节尽量不过服务器。

## 4. 用户环境（重要）

- Windows + Git Bash；有 bun 1.3.14，无 Node、无 Python（CF 构建环境除外）。
- ffmpeg 在 `%USERPROFILE%\beyonddown\bin\ffmpeg.exe`（无 ffprobe）。旧路径 tools/ffmpeg/ 已删，勿引用。
- gh CLI 已登录；仓库 github.com/Aeko233/BeyondDown（私有）。
- 终端中文乱码是 GBK 显示问题，文件本身 UTF-8。

## 5. 架构现状

```text
src/               Vite + Vanilla TS 前端（api / config / state / features / ui 分层）
public/            Vite 原样复制资产（config.toml / qrcode）；不放业务源码
dist/web/          前端构建产物；CF ASSETS 与独立服务器共用（入库，CF 构建依赖）
worker.js          统一路由入口（10 个 /api/* 端点 + OPTIONS/CORS 注入 + ASSETS 静态）
lib/               bili.js(B站客户端+风控激活链+WBI) / session.js(无状态令牌) / wbi / md5 / murmur3 / http
functions/api/     各端点处理器（worker.js 挂载）
adapters/alipay.js 支付宝云函数入口（FetchEvent 调度，平台不认 exports.main）
server.mjs         独立部署入口（bun，需先 bun run build）
dev-server.mjs     API + dist/web 开发服务器（DEV=1 时提供 /api/dev/token）
scripts/pack-alipay.sh  支付宝部署包一键打包（build → 同步 index.js → tar 打 zip）
```

### 核心机制

- **会话 = 无状态 Bearer 令牌**（lib/session.js）：AES-GCM（密钥 = SHA-256(SESSION_SECRET)）加密整个 session JSON（登录态 + 风控 Cookie + WBI + 扫码中间态），响应体带 token 滚动更新，前端存 sessionStorage。**无 KV 依赖**（KV 仅限流器可选使用）。
- **认证**：`Authorization: Bearer v1.xxx`；CORS 由 worker.js 路由层统一注入（SITE_ORIGIN 白名单，缺省 *）。
- **下载通道**（按流量成本排序）：
  1. `.bat` / aria2 / yt-dlp / IDM 导出——字节直连 B站，**零服务器流量**（主推）
  2. `/api/download/stream` 720P 直链移交（durl fnval=0，免登录，返回直链 + Referer/UA 头）——**零服务器流量**
- **风控激活链**（lib/bili.js activateRisk）：finger/spi → buvid3/4（失败本地自生成）→ GenWebTicket(HMAC) → ExClimbWuzhi。各环独立降级不阻断。
- **BILI_PROXY**：环境变量，设置后所有 B站上游改走 `${BILI_PROXY}/<host>/<path>`（国内反代，解 CF 出口封锁）。
- **部署拓扑**：前端 `config.toml` 直连支付宝云函数（`api_base` 非空），CF 只托管静态。`API_PROXY` 同源代理仅作兜底（CF→支付宝 TLS 间歇 520/525，勿改回默认）。

## 6. 关键事实（实测结论，勿重新推导）

1. **B站封锁 CF 海外出口**：api.bilibili.com 对 CF Workers 返回 412 / -352。国内数据中心出口正常。CF 后端不可用，必须 BILI_PROXY 或国内函数。
2. **浏览器无法直连 B站 CDN**：Referer 强校验（伪造是 forbidden header、不发实测 403）+ CORS。所有"浏览器直接下载"方案死于此，勿再试。
3. durl（fnval=0）是唯一"预混流整文件"接口，封顶 720P（档位 64/16）；常被调度到 PCDN 域（mountaintoys.cn / szbdyd.com），直链需带头下载。
4. WBI 签名、md5、murmur3(buvid_fp) 纯 JS 实现，经真实接口验证。
5. **扫码登录直连模式已实测正常**；Set-Cookie 被剥仅曾现于 API_PROXY 代理链。
6. ToS：CF 现行自助协议无视频代理限制，但版权面（DMCA 封号）仍是主要风险——中转通道仅限自用，勿公开宣传。

## 7. 已验证清单（不要重复验证）

- `bun run check`：typecheck + 前端单测 3/3 + 真实接口回归 14/14 + Vite 构建
- 720P 直链移交：stream 端点返回 durl 单文件直链 + Referer/UA 头
- .bat 脚本：首次自动下载安装 ffmpeg（含 for /r 通配符修复）→ 下载 → 合并 → 清理
- Bearer 令牌 / OPTIONS 204 / CORS 头 / 401 门控 / host 白名单拒绝
- 支付宝云函数：FetchEvent 调度 + HTTP 触发透传 + 直连 B站风控链（qrcode 出真码）
- 前端直连链路：扫码 / Cookie 登录、视频解析、playurl、五种导出、stream 全通

## 8. 常用命令

```bash
bun run dev            # Vite 前端 http://localhost:5173（/api 代理到 8788；DEV 模式 api_base=""）
DEV=1 bun run dev:api  # API + dist/web http://localhost:8788（含 /api/dev/token）
bun run check          # TS 严格检查 + 前端单测 + 14 项真实接口回归 + Vite 构建
bun run pack:alipay    # 支付宝部署包一键打包 → dist/beyonddown-fn.zip（控制台手动上传）
git push               # CF 自动构建部署 worker
```

## 9. 安全与红线

- `SESSION_SECRET` 只活环境变量（CF Secret / .dev.vars / 平台 env），**不进仓库**；dev-server 默认占位符仅限本地。
- 令牌内含 SESSDATA（B站登录态），XSS 面靠"页面零用户内容 + 不透明加密 + 7 天 TTL"缓解。
- 中转通道版权面敏感：仅自用，登录门控 + 限流不可拆。
- **不做**：TV/App 接口（appkey，违反 ToS）、密码登录（geetest 风控）、DASH 全量代理/落盘缓存（唧唧老路，版权必死）。
- 导出任务默认不含 Cookie；错误信息脱敏；SESSDATA / bili_jct / refresh_token 不入日志。

## 10. 坑与教训（血泪清单，勿重蹈）

1. cmd 65001 吞多字节字符后的一个字节 → .bat 内容全 ASCII，文件名用 BV号_cid；`%` 写 `%%`。
2. `for /r` 对不含通配符的文件名不检查存在性 → 找文件必须 `ffmpeg*.exe`。
3. PowerShell Compress-Archive 的 zip 用反斜杠分隔符 → 打 zip 用 `/c/Windows/System32/tar.exe -a -c -f`。
4. nav 未登录时顶层 code=-101 但 data 完整（含 wbi_img）——不当异常。
5. Workers/Node 读多条 Set-Cookie 必须 `headers.getSetCookie()`。
6. MD5 words 数组按 16 字块×16 预置零分配（防 undefined→NaN）。
7. 支付宝部署包需三步（build → 同步 dist/fn/code/index.js → tar 打 zip），漏一步 = 线上跑旧包；已封装 `pack:alipay`。

## 11. 前端 TypeScript 约定

- 严格模式：`strict` / `exactOptionalPropertyTypes` / `noUnusedLocals` / `useUnknownInCatchVariables` / `moduleResolution: Bundler`。
- 分层：api（HTTP+令牌）/ config（TOML）/ state / features（auth/video/exports）/ ui（DOM）；DTO 集中 `src/api/types.ts`，类型与运行时代码分开。
- DOM 查询统一 `byId` 运行时校验（缺元素抛错），不用 any 断言静默。
- 生成物（dist/web、alipay.cjs、zip）不人工维护；dist/web 入库是 CF 构建需要，支付宝手工产物 gitignore。
- 工程实践：模块边界、严格务实 TS、构建产物不入手（迁移时参考过 Vite 源码，目录已删）。

## 12. 用户侧未跟踪文件

- `apple-style-hard-prompt.md`、交接 md——勿动勿删。（`参考/` 目录已按用户要求删除：含 Bili23 风控实证源码与 vite-main，其结论已内化在 §6/§11）

## 13. 仓库里还有什么

- `README.md` 部署与 API 文档 / `Design.md` 强制设计规范。
- 进行中任务：无。支付宝部署完成、扫码登录正常、前端为 Apple 风格模态 UI。
