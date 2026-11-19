import type { ReactNode } from "react";
import { PageTitle } from "@/components/PageTitle";
import { SubNav } from "@/components/SubNav";

export default function MarketsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageTitle title="Markets" />
      <SubNav label="Markets" items={[{ href: "/markets", label: "India" }, { href: "/markets/global", label: "Global" }]} />
      {children}
    </>
  );
}
