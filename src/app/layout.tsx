import type { Metadata } from "next";
import { Figtree, EB_Garamond, JetBrains_Mono, Fira_Code, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/ThemeProvider";
import UpdateNotification from "@/components/UpdateNotification";
import { AnnouncementPopup } from "@/components/AnnouncementPopup";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600", "700"],
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
    <html lang="en" suppressHydrationWarning className={cn("font-body", "h-full", "antialiased", ebGaramond.variable, jetbrainsMono.variable, firaCode.variable, "font-sans", geist.variable)}>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&display=swap" rel="stylesheet" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Fira+Code:wght@300..700&display=swap" rel="stylesheet" />
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
            } catch (_) {}
          `,
          }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-background text-on-surface">
        <ThemeProvider>
          {children}
          <UpdateNotification />
          <AnnouncementPopup />
        </ThemeProvider>
      </body>
    </html>
  );
}
