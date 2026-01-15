import { Card, CardContent } from "@/components/ui/card";
import { Section } from "@/components/layout/section";
import { Video, Database, Layout } from "lucide-react";

export function Overview() {
  const features = [
    {
      icon: Video,
      title: "Standardized inputs",
      description: "Video, detections, and AIS data unified in a simple contract",
    },
    {
      icon: Database,
      title: "Web based overlay",
      description: "Video overlay rendering directly in the browser",
    },
    {
      icon: Layout,
      title: "OpenBridge components",
      description: "Reference implementation with maritime UI standards",
    },
  ];

  return (
    <Section containerSize="xl">
      <div className="grid md:grid-cols-2 gap-12 items-center">
        {/* Left: Description */}
        <div>
          <h2 className="font-heading text-4xl md:text-5xl font-semibold text-slate-900 mb-4">
            What is OpenAR?
          </h2>
          <p className="text-slate-600 text-lg mb-4 leading-relaxed">
            OpenAR is an open source standard for maritime augmented reality
            overlays that run in web browsers.
          </p>
          <p className="text-slate-600 text-lg leading-relaxed">
            It provides a unified interface for combining video feeds, object
            detection data, and AIS information into interactive visual overlays
            using established maritime design patterns.
          </p>
        </div>

        {/* Right: Feature cards */}
        <div className="grid gap-4">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardContent className="p-6 flex items-start gap-4">
                <div className="p-3 rounded-lg bg-black/5">
                  <feature.icon className="w-6 h-6 text-slate-700" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-slate-600 text-sm">{feature.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}
