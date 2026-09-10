import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIPS Simulator",
  description: "A classic Mac OS styled MIPS assembly IDE and simulator",
  icons: {
    icon: { url: "/mips-logo.png?v=20260910-2", type: "image/png" },
    shortcut: "/mips-logo.png?v=20260910-2",
    apple: "/mips-logo.png?v=20260910-2",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
