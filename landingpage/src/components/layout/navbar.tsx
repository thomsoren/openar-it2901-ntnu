"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

export function Navbar() {
  return (
    <nav className="fixed top-4 left-0 right-0 z-50">
      <div className="mx-auto w-full max-w-2xl px-4">
        <div className="rounded-full border border-black/10 bg-white/80 backdrop-blur-lg shadow-lg">
          <div className="flex items-center justify-between px-6 py-3">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2">
              <span className="text-base md:text-lg font-semibold text-black">
                OpenAR Maritime
              </span>
            </Link>

            {/* Right Actions */}
            <div className="flex items-center gap-4">
              <Button variant="outline" asChild>
                <Link href="#contact">Contact</Link>
              </Button>
              <Button asChild>
                <Link href={siteConfig.links.demo}>Demo</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
