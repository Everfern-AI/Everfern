import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./onboarding.css";
import "./route-transition.css";
import { cn } from "@/lib/utils";
import { AppMotionProvider } from "@/components/AppMotionProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import UpdateNotification from "@/components/UpdateNotification";
import { AnnouncementPopup } from "@/components/AnnouncementPopup";
import { MaterialSymbolsLoader } from "@/components/MaterialSymbolsLoader";
import { SmoothScroll } from "@/components/SmoothScroll";
import { WorkerScheduleHost } from "@/components/WorkerScheduleHost";

const satoshi = localFont({
  src: [
    { path: "../../public/fonts/satoshi/Satoshi-Variable.woff2", weight: "300 900", style: "normal" },
    { path: "../../public/fonts/satoshi/Satoshi-VariableItalic.woff2", weight: "300 900", style: "italic" },
  ],
  variable: "--font-sans",
  display: "swap",
});

const loretta = localFont({
  src: [
    {
      path: "../../public/fonts/loretta-light/loretta-light.otf",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../public/fonts/loretta-light/loretta-light.otf",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EverFern",
  description: "Your autonomous AI workplace agent.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-body",
        "h-full",
        "antialiased",
        loretta.variable,
        "font-sans",
        satoshi.variable
      )}
    >
      <head>
        <link rel="preload" href="/fonts/satoshi/Satoshi-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
            try {
              const theme = localStorage.getItem('everfern_theme') || 'light';
              if (theme === 'dark') {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }
              const font = localStorage.getItem('everfern_font') || 'default';
              document.documentElement.setAttribute('data-font', font);
              if (font === 'sf-pro') {
                document.documentElement.classList.add('font-sf-pro');
              } else if (font === 'segoe-ui') {
                document.documentElement.classList.add('font-segoe-ui');
              } else {
                document.documentElement.classList.add('font-default');
              }
            } catch (_) {}
            try {
              // Workers <-> Chat after a full page load: play the arrival from the first paint.
              const enter = sessionStorage.getItem('ef-route-enter');
              if (enter === 'to-chat' || enter === 'to-workers') {
                sessionStorage.removeItem('ef-route-enter');
                document.documentElement.setAttribute('data-ef-enter', enter);
                setTimeout(function () { document.documentElement.removeAttribute('data-ef-enter'); }, 450);
              }
            } catch (_) {}
          `,
          }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-background text-on-surface">
        <ThemeProvider>
          <WorkerScheduleHost />
          <AppMotionProvider>{children}</AppMotionProvider>
          <MaterialSymbolsLoader />
          <SmoothScroll />
          <UpdateNotification />
          <AnnouncementPopup />
        </ThemeProvider>
      </body>
    </html>
  );
}

