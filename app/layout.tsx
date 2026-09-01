import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIPS Simulator",
  description: "A classic Mac OS styled MIPS assembly IDE and simulator",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
