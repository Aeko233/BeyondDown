#!/usr/bin/env bash
# 支付宝部署包一键打包：build → 同步 index.js → 打 zip。
# 输出 dist/beyonddown-fn.zip（code/index.js + code/package.json），手动上传控制台。
set -euo pipefail
cd "$(dirname "$0")/.."
bun run build:alipay
cp dist/alipay.cjs dist/fn/code/index.js
/c/Windows/System32/tar.exe -a -c -f dist/beyonddown-fn.zip -C dist/fn code
echo "OK: dist/beyonddown-fn.zip"
