import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fern Cursor Overlay",
};

/**
 * Minimal transparent layout for the computer-use cursor overlay.
 * This overrides the root layout so no global styles bleed through.
 */
export default function OverlayLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        suppressHydrationWarning
        style={{
          margin: 0,
          padding: 0,
          background: 'transparent',
          overflow: 'hidden',
          width: 'var(--ef-vw)',
          height: 'var(--ef-vh)',
        }}
      >
        {children}
      </body>
    </html>
  );
}
