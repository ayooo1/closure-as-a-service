import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Closure as a Service",
  description: "Say goodbye with grace. AI-crafted breakup messages, streamed in real time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
