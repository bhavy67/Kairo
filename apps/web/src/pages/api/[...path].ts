import type { IncomingMessage, ServerResponse } from "node:http";
import { getApi } from "@/server/api";

/**
 * Serverless adapter for Vercel. A Pages Router API route receives real Node
 * req/res objects, so Fastify handles them natively (its documented serverless
 * pattern): the body streams through Fastify's own parser, and the response
 * streams back with headers, cookies and status untouched. Routes, hooks and
 * error handling are identical to the standalone server.
 */
export const config = {
  api: { bodyParser: false, externalResolver: true, responseLimit: false },
  maxDuration: 60, // the cron route may download several NSE files in one call
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApi();
  app.server.emit("request", req, res);
}
