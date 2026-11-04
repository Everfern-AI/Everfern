import type { Metadata } from "next";
import { Figtree, JetBrains_Mono, Fira_Code, Geist } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import "./onboarding.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/ThemeProvider";
import UpdateNotification from "@/components/UpdateNotification";
import { AnnouncementPopup } from "@/components/AnnouncementPopup";
import { MaterialSymbolsLoader } from "@/components/MaterialSymbolsLoader";
import { SmoothScroll } from "@/components/SmoothScroll";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  weight: ["300", "400", "500", "600", "700", "800", "900"],
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

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-code",
  weight: ["300", "400", "500", "600", "700"],
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
        jetbrainsMono.variable,
        firaCode.variable,
        figtree.variable,
        "font-sans",
        geist.variable
      )}
    >
      <head>
        {/* EverFern v2 type: Satoshi (body) + General Sans (titles), Fontshare free license */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&f[]=general-sans@500,600&display=swap"
        />
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
          `,
          }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-background text-on-surface">
        <ThemeProvider>
          {children}
          <MaterialSymbolsLoader />
          <SmoothScroll />
          <UpdateNotification />
          <AnnouncementPopup />
        </ThemeProvider>
      </body>
    </html>
  );
}

