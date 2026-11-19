import type { ReactNode } from "react";
import { PageTitle } from "@/components/PageTitle";
import { SubNav } from "@/components/SubNav";

export default function WatchLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageTitle title="Watch" />
      <SubNav label="Watch" items={[{ href: "/watch", label: "Watchlist" }, { href: "/watch/alerts", label: "Alerts" }]} />
      {children}
    </>
  );
}
