// 站点能力声明。
import { json } from "../../lib/http.js";

export async function onRequestGet(context) {
  const { env } = context;
  return json({ proxyConfigured: Boolean(env.BILI_PROXY) });
}
