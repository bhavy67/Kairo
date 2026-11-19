import type { ReactNode } from "react";
import { PageTitle } from "@/components/PageTitle";
import { SubNav } from "@/components/SubNav";

export default function PortfolioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageTitle title="Portfolio" />
      <SubNav
        label="Portfolio"
        items={[
          { href: "/portfolio", label: "Holdings" },
          { href: "/portfolio/funds", label: "Funds" },
          { href: "/portfolio/returns", label: "Returns" },
        ]}
      />
      {children}
    </>
  );
}
