import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/layout/section";
import { partners } from "@/data/partners";
import { siteConfig } from "@/lib/site";

export function Hero() {
  return (
    <Section
      containerSize="full"
      className="mt-6 md:mt-20 pt-32 pb-16 min-h-[80vh] flex items-center"
    >
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-16">
        <div className="flex flex-col gap-6 text-left lg:w-[48%]">
          {/* Main Heading */}
          <h1 className="font-heading text-4xl md:text-5xl lg:text-6xl font-semibold text-slate-900 leading-tight">
            Open standard for maritime AR
          </h1>

          {/* Subheading */}
          <p className="text-base md:text-lg text-slate-700 leading-relaxed max-w-xl">
            OpenAR unifies detections and AIS into a simple contract and renders
            a clean browser overlay. We are 7 informatics students building this
            bachelor project.
          </p>

          {/* CTAs */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              asChild
            >
              <Link href={siteConfig.links.meeting}>Contact</Link>
            </Button>
            <Button size="sm" className="w-full sm:w-auto" asChild>
              <Link href={siteConfig.links.demo}>Demo</Link>
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Partner
            </p>
            <div className="flex items-center gap-4">
              {partners.map((partner) => (
                <img
                  key={partner.name}
                  src={partner.logo}
                  alt={`${partner.name} logo`}
                  className="h-8 w-auto opacity-80"
                />
              ))}
            </div>
          </div>

        </div>

        {/* Hero Visual - Glass Video Frame */}
        <div className="lg:w-[52%]">
          <div className="glass rounded-2xl overflow-hidden shadow-2xl">
            <div className="aspect-video bg-gradient-to-br from-slate-100 to-slate-200">
              <img
                src="/OpenbridgeAR.png"
                alt="OpenAR demo frame"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
