import { json } from "../../../lib/http.js";

// 无状态会话：退出 = 客户端丢弃令牌，服务端无需处理（保留端点做兼容）
export async function onRequestPost() {
  return json({ status: "ok" });
}
