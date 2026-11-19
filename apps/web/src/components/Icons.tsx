/** Minimal 20px line icons, 1.75 stroke, drawn for this app. */
const base = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const IconToday = () => (
  <svg {...base}><rect x="3" y="3" width="14" height="14" rx="4" /><path d="M6.5 12 9 9.5l2 1.8L13.5 8" /><circle cx="13.6" cy="7.9" r=".6" fill="currentColor" /></svg>
);
export const IconPortfolio = () => (
  <svg {...base}><path d="M10 3a7 7 0 1 0 7 7h-7z" /><path d="M12.5 3.4A7 7 0 0 1 16.6 7.5h-4.1z" /></svg>
);
export const IconMarkets = () => (
  <svg {...base}><path d="M5 4v12M10 6v10M15 3v13" /><rect x="3.5" y="7" width="3" height="5" rx="1" /><rect x="8.5" y="9" width="3" height="4" rx="1" /><rect x="13.5" y="5" width="3" height="6" rx="1" /></svg>
);
export const IconScreener = () => (
  <svg {...base}><path d="M3 5h14M5.5 10h9M8.5 15h3" /></svg>
);
export const IconWatch = () => (
  <svg {...base}><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5z" /><circle cx="10" cy="10" r="2.3" /></svg>
);
export const IconSun = () => (
  <svg {...base} width={15} height={15}><circle cx="10" cy="10" r="3.4" /><path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" /></svg>
);
export const IconMoon = () => (
  <svg {...base} width={15} height={15}><path d="M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2z" /></svg>
);
export const IconSystem = () => (
  <svg {...base} width={15} height={15}><rect x="2.5" y="3.5" width="15" height="10" rx="2" /><path d="M7 16.5h6" /></svg>
);
export const IconSignOut = () => (
  <svg {...base} width={16} height={16}><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M12 13.5 15.5 10 12 6.5M15.5 10H8" /></svg>
);
