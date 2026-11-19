import { Upcoming } from "@/components/Upcoming";

export default function Markets() {
  return (
    <Upcoming
      title="Markets"
      items={[
        "Nifty 50, Bank Nifty, Sensex, India VIX",
        "Market breadth: advances / declines, % of Nifty 500 above 50 and 200 DMA",
        "Sector heatmap and top movers",
        "Watchlists and saved screeners",
      ]}
    />
  );
}
