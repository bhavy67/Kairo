import { unzipSync, strFromU8 } from "fflate";
import { nseDateParts } from "@kairo/core";
import { UpstreamError } from "../errors.js";
import type { Fetch } from "../kite/client.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Client for NSE's public EOD archive. These are static files, not an API:
 * we fetch each file at most once per day, sequentially, with a browser-like
 * User-Agent (the CDN rejects blank ones) and a short backoff on 5xx.
 * A 404 means "no file for that date": a holiday, or not published yet.
 */
export class NseArchive {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly retryDelayMs = 1_000,
  ) {}

  /** Full CM bhavcopy CSV for a trading date, or null if NSE has none. */
  async bhavcopy(date: string): Promise<string | null> {
    const { ymd } = nseDateParts(date);
    const buf = await this.get(`/content/cm/BhavCopy_NSE_CM_0_0_0_${ymd}_F_0000.csv.zip`);
    if (!buf) return null;
    const files = unzipSync(new Uint8Array(buf));
    const csv = Object.entries(files).find(([name]) => name.endsWith(".csv"));
    if (!csv) throw new UpstreamError(`Bhavcopy zip for ${date} has no CSV`);
    return strFromU8(csv[1]);
  }

  /** Corporate actions (bc<DDMMYYYY>.csv) from the daily PR archive, or null if none was published. */
  async corporateActions(date: string): Promise<string | null> {
    const { dmy } = nseDateParts(date);
    const ddmmyy = dmy.slice(0, 4) + dmy.slice(6);
    const buf = await this.get(`/archives/equities/bhavcopy/pr/PR${ddmmyy}.zip`);
    if (!buf) return null;
    const files = unzipSync(new Uint8Array(buf), { filter: (f) => /^bc\d{8}\.csv$/i.test(f.name) });
    const bc = Object.values(files)[0];
    return bc ? strFromU8(bc) : "";
  }

  async indexClose(date: string): Promise<string | null> {
    const { dmy } = nseDateParts(date);
    const buf = await this.get(`/content/indices/ind_close_all_${dmy}.csv`);
    return buf && new TextDecoder().decode(buf);
  }

  async constituents(list: "nifty50" | "nifty500"): Promise<string> {
    const buf = await this.get(`/content/indices/ind_${list}list.csv`);
    if (!buf) throw new UpstreamError(`NSE constituent list ${list} not found`);
    return new TextDecoder().decode(buf);
  }

  private async get(path: string, attempt = 0): Promise<ArrayBuffer | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; kairo/0.1; personal EOD archive reader)", Accept: "*/*" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt < 2) return sleep(this.retryDelayMs * 3 ** attempt).then(() => this.get(path, attempt + 1));
      throw new UpstreamError(`NSE archive unreachable: ${(err as Error).message}`);
    }
    if (res.status === 404) return null;
    if (res.status >= 500 && attempt < 2) return sleep(this.retryDelayMs * 3 ** attempt).then(() => this.get(path, attempt + 1));
    if (!res.ok) throw new UpstreamError(`NSE archive HTTP ${res.status} for ${path}`);
    return res.arrayBuffer();
  }
}
