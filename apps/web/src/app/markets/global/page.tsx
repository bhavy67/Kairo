import { Upcoming } from "@/components/Upcoming";

export default function Global() {
  return (
    <Upcoming
      title="Global"
      items={[
        "S&P 500, Nasdaq, Dow, FTSE, DAX, Nikkei, Hang Seng",
        "USD/INR, US 10Y yield, Brent",
        "Overnight cues summary before the Indian open",
        "US stock watchlist",
      ]}
    />
  );
}
