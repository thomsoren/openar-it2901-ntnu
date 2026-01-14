import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/layout/section";
import { siteConfig } from "@/lib/site";
import { Github, Play, MousePointer2 } from "lucide-react";

export function Demo() {
  const features = [
    {
      icon: Play,
      text: "Play video and toggle overlay",
    },
    {
      icon: MousePointer2,
      text: "Select an AIS target",
    },
    {
      icon: MousePointer2,
      text: "See matched overlay state",
    },
  ];

  return (
    <Section id="demo" containerSize="xl">
      <div>
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl font-semibold text-slate-900 mb-4">
            Try the demo
          </h2>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            Experience OpenAR in action with our interactive demonstration
          </p>
        </div>

        {/* Demo Visual */}
        <div className="glass rounded-2xl overflow-hidden mb-8 shadow-2xl">
          <div className="aspect-video bg-gradient-to-br from-slate-100 to-slate-200">
            <img
              src="/OpenbridgeAR.png"
              alt="OpenAR demo frame"
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        {/* What to try */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-slate-900 mb-4 text-center">
            What to try:
          </h3>
          <div className="flex flex-wrap justify-center gap-4">
            {features.map((feature) => (
              <div
                key={feature.text}
                className="flex items-center gap-2 text-slate-600 text-sm"
              >
                <feature.icon className="w-4 h-4 text-slate-500" />
                <span>{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button size="lg" asChild>
            <Link href={siteConfig.links.demo}>
              <Play className="w-5 h-5" />
              Demo
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href={siteConfig.links.github} target="_blank" rel="noopener noreferrer">
              <Github className="w-5 h-5" />
              View on GitHub
            </Link>
          </Button>
        </div>

        {/* Disclaimer */}
        <p className="text-slate-500 text-xs text-center mt-8">
          Early prototype. Limitations and features are documented as the project
          evolves.
        </p>
      </div>
    </Section>
  );
}
