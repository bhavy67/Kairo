import Link from "next/link";

/** Every ticker in the app opens its stock page. */
export function SymbolLink({ symbol, children }: { symbol: string; children?: React.ReactNode }) {
  return (
    <Link href={`/s/${encodeURIComponent(symbol)}`} className="sym symlink">
      {children ?? symbol}
    </Link>
  );
}
