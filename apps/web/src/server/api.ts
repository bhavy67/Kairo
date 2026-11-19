import { buildApp, loadConfig, openDb } from "@kairo/api";

type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * One Fastify instance per warm function instance. Cold start pays for
 * config validation, the DB pool and migrations once; warm requests reuse it.
 * Caching the promise (not the app) means concurrent cold requests share the boot.
 */
let app: Promise<App> | undefined;

export function getApi(): Promise<App> {
  app ??= (async () => {
    const config = loadConfig(process.env);
    const db = await openDb(config);
    const instance = await buildApp({ config, db });
    await instance.ready();
    return instance;
  })().catch((err) => {
    app = undefined; // let the next request retry instead of caching the failure
    throw err;
  });
  return app;
}
