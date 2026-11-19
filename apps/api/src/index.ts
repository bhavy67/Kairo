/** Library entry: lets a host (the Next.js app on Vercel) run the API in-process. */
export { buildApp } from "./app.js";
export { loadConfig, type Config } from "./config.js";
export { openDb } from "./db/open.js";
