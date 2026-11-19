import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/jetbrains-mono";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Kairo", template: "%s · Kairo" },
  description: "A personal market desk: holdings, real returns from your tradebook, NSE breadth, screens and alerts.",
  robots: { index: false, follow: false },
  applicationName: "Kairo",
  appleWebApp: { title: "Kairo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0e" },
  ],
};

/**
 * Runs before first paint so a dark-theme visitor never sees a white flash.
 * Kept tiny and inline on purpose; the toggle component owns all later changes.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("kairo-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
