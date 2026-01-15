import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { Github, Mail } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-white border-t border-black/10">
      <div className="page-container py-8 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Brand */}
          <div>
            <h3 className="text-lg font-semibold text-black mb-1">OpenAR Maritime</h3>
            <p className="text-slate-600 text-sm max-w-md">
              Open standard for maritime AR overlays. Built by seven informatics
              students in collaboration with OpenBridge.
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-col gap-4 md:items-end">
            <div className="flex flex-wrap gap-4 text-sm">
              <Link
                href={siteConfig.links.demo}
                className="text-slate-600 hover:text-black transition-colors"
              >
                Demo
              </Link>
              <Link
                href="#partners"
                className="text-slate-600 hover:text-black transition-colors"
              >
                Partners
              </Link>
              <Link
                href="#contact"
                className="text-slate-600 hover:text-black transition-colors"
              >
                Contact
              </Link>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link
                href={siteConfig.links.github}
                className="text-slate-600 hover:text-black transition-colors flex items-center gap-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github className="w-4 h-4" />
                GitHub
              </Link>
              <Link
                href={`mailto:${siteConfig.links.email}`}
                className="text-slate-600 hover:text-black transition-colors flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                {siteConfig.links.email}
              </Link>
            </div>
          </div>
        </div>

      </div>
    </footer>
  );
}
