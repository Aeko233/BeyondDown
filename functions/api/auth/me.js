import { json } from "../../../lib/http.js";
import { readToken } from "../../../lib/session.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await readToken(request, env);

  if (!session?.login?.sessdata) return json({ loggedIn: false });

  return json({
    loggedIn: true,
    uid: session.login.uid ?? null,
    uname: session.login.uname || "",
    face: session.login.face || "",
    vip: Boolean(session.login.vip),
  });
}
