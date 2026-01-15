import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/layout/section";
import { siteConfig } from "@/lib/site";
import { Mail, Github, Calendar } from "lucide-react";

export function Contact() {
  const contactReasons = [
    "Discuss integration possibilities",
    "Access to maritime data and APIs",
    "Feedback on the OpenAR standard",
    "Collaboration opportunities",
  ];

  return (
    <Section id="contact" containerSize="xl">
      <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl font-semibold text-slate-900 mb-4">
            Get in touch
          </h2>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            We'd love to hear from you about OpenAR
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          {/* Left: Contact Info */}
          <div>
            <h3 className="text-xl font-semibold text-slate-900 mb-6">
              Contact information
            </h3>

            <div className="space-y-6 mb-8">
              <Link
                href={`mailto:${siteConfig.links.email}`}
                className="flex items-center gap-3 text-slate-700 hover:text-black transition-colors group"
              >
                <div className="w-12 h-12 rounded-lg bg-black/5 flex items-center justify-center group-hover:bg-black/10 transition-colors">
                  <Mail className="w-5 h-5 text-slate-700" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Email</p>
                  <p className="font-medium">{siteConfig.links.email}</p>
                </div>
              </Link>

              <Link
                href={siteConfig.links.github}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 text-slate-700 hover:text-black transition-colors group"
              >
                <div className="w-12 h-12 rounded-lg bg-black/5 flex items-center justify-center group-hover:bg-black/10 transition-colors">
                  <Github className="w-5 h-5 text-slate-700" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">GitHub</p>
                  <p className="font-medium">View repository</p>
                </div>
              </Link>
            </div>

            <div>
              <h4 className="text-lg font-semibold text-slate-900 mb-4">
                What we want to talk about:
              </h4>
              <ul className="space-y-2">
                {contactReasons.map((reason) => (
                  <li
                    key={reason}
                    className="text-slate-600 text-sm flex items-start gap-2"
                  >
                    <span className="text-slate-400 mt-1">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right: Scheduling */}
          <div>
            <h3 className="text-xl font-semibold text-slate-900 mb-6">
              Contact
            </h3>

            <div className="p-8 rounded-xl border border-black/10 bg-black/5 backdrop-blur-sm">
              <div className="text-center mb-6">
                <Calendar className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                <p className="text-slate-600 text-sm mb-6">
                  Book a time to discuss OpenAR, integrations, or potential
                  collaborations.
                </p>
              </div>

              <Button size="lg" className="w-full" asChild>
                <Link href={siteConfig.links.meeting}>
                  <Calendar className="w-5 h-5" />
                  Contact
                </Link>
              </Button>

              <p className="text-slate-500 text-xs text-center mt-4">
                Typically respond within 24 hours
              </p>
            </div>
          </div>
        </div>
    </Section>
  );
}
