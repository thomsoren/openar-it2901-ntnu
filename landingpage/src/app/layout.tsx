import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenAR - Web Based Maritime AR Overlays",
  description:
    "A standard for web based maritime AR overlays. OpenAR unifies data vision detections and AIS into a simple contract, and renders a clean video overlay with OpenBridge components in the browser.",
  keywords: [
    "maritime",
    "augmented reality",
    "AR",
    "AIS",
    "OpenBridge",
    "vessel detection",
    "video overlay",
    "open source",
  ],
  authors: [{ name: "OpenAR Team" }],
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "OpenAR - Web Based Maritime AR Overlays",
    description:
      "Open source standard for maritime augmented reality overlays in the browser",
    type: "website",
    images: ["/logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`scroll-smooth ${fraunces.variable} ${inter.variable}`}
    >
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
