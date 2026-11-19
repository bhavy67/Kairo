import { getApi } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The cron route may download several NSE files in one call.
export const maxDuration = 60;

const HOP_BY_HOP = new Set(["connection", "content-length", "transfer-encoding", "keep-alive"]);

/**
 * Serverless adapter: hands the request to Fastify in-process via inject(),
 * so routes, validation, hooks and error handling are identical to the
 * standalone server and covered by the same tests. No extra network hop.
 */
async function handle(req: Request): Promise<Response> {
  const api = await getApi();
  const url = new URL(req.url);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const res = await api.inject({
    method: req.method as "GET",
    url: url.pathname + url.search,
    headers: Object.fromEntries(req.headers),
    ...(hasBody ? { payload: Buffer.from(await req.arrayBuffer()) } : {}),
    remoteAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1",
  });

  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined || HOP_BY_HOP.has(key)) continue;
    // set-cookie arrives as an array; each must stay a separate header.
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, String(v));
  }
  const empty = res.statusCode === 204 || res.statusCode === 304 || req.method === "HEAD";
  return new Response(empty ? null : new Uint8Array(res.rawPayload), { status: res.statusCode, headers });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
