/**
 * FRED relay (Supabase Edge Function).
 *
 * FRED drops connections from some cloud ranges, including Vercel's Mumbai
 * region, while Supabase's edge network reaches it in well under a second.
 * This relay fetches one whitelisted FRED series and returns the CSV untouched.
 *
 * Not an open proxy: only the series Kairo uses, a validated start date, and a
 * token in the x-relay-token header. Only the token's SHA-256 lives here (safe to
 * publish: a 40-character random token cannot be recovered from its hash); the
 * token itself is the FRED_RELAY_TOKEN env var on the Vercel project.
 * Deployed with verify_jwt = false because the token check replaces it. See ADR 10.
 */
const TOKEN_SHA256 = "30b79c3235628dbb2f0da7ea1124107511930824d8d145fc6cb4aadda32de40d";
const SERIES = new Set(["SP500", "NASDAQCOM", "DJIA", "NIKKEI225", "DGS10", "DCOILBRENTEU"]);

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (!safeEqual(await sha256Hex(req.headers.get("x-relay-token") ?? ""), TOKEN_SHA256)) {
    return new Response("unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const cosd = url.searchParams.get("cosd") ?? "";
  if (!SERIES.has(id) || !/^\d{4}-\d{2}-\d{2}$/.test(cosd)) {
    return new Response("bad request", { status: 400 });
  }
  try {
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}`, {
      headers: { "User-Agent": "kairo/0.1 (personal dashboard)" },
      signal: AbortSignal.timeout(15000),
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "text/csv" } });
  } catch (err) {
    return new Response(`upstream error: ${String(err)}`, { status: 502 });
  }
});
