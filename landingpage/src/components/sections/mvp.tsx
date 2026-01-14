import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/layout/section";
import { Package, Monitor, Code } from "lucide-react";

export function MVP() {
  const deliverables = [
    {
      icon: Package,
      title: "OpenAR SDK (npm)",
      items: [
        "Clean, documented API",
        "Core data inputs and outputs",
      ],
    },
    {
      icon: Monitor,
      title: "Demo web app",
      items: [
        "Interactive demo experience",
        "Overlay UI showcase",
      ],
    },
    {
      icon: Code,
      title: "Developer experience",
      items: [
        "Quick start setup",
        "Example data and docs",
      ],
    },
  ];

  return (
    <Section containerSize="xl">
      <div>
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl font-semibold text-slate-900 mb-4">
            MVP deliverables
          </h2>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            What we're building for the bachelor project
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {deliverables.map((deliverable) => (
            <Card key={deliverable.title}>
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-black/5 flex items-center justify-center mb-4">
                  <deliverable.icon className="w-6 h-6 text-slate-700" />
                </div>
                <CardTitle className="text-xl">{deliverable.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {deliverable.items.map((item) => (
                    <li
                      key={item}
                      className="text-slate-600 text-sm flex items-start gap-2"
                    >
                      <span className="text-slate-400 mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}
