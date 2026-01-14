import { Card, CardContent } from "@/components/ui/card";
import { Section } from "@/components/layout/section";
import { ArrowRight } from "lucide-react";

export function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Inputs",
      description: "Video stream + detection events + AIS data",
      details: "Standardized data sources feed into the OpenAR pipeline",
    },
    {
      number: "02",
      title: "Timeline sync",
      description: "Synchronization and replay for testing",
      details: "All data sources aligned on a common timeline",
    },
    {
      number: "03",
      title: "Output",
      description: "Web based overlay + interactive AIS UI",
      details: "Rendered in browser with OpenBridge components",
    },
  ];

  return (
    <Section containerSize="xl">
      <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl font-semibold text-slate-900 mb-4">
            How it works
          </h2>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            A simple three-step pipeline from data inputs to interactive overlay
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 relative">
          {steps.map((step, index) => (
            <div key={step.number} className="relative">
              <Card className="h-full">
                <CardContent className="p-8">
                  <div className="text-5xl font-bold text-slate-300 mb-4">
                    {step.number}
                  </div>
                  <h3 className="text-2xl font-semibold text-slate-900 mb-2">
                    {step.title}
                  </h3>
                  <p className="text-slate-700 font-medium mb-3">
                    {step.description}
                  </p>
                  <p className="text-slate-600 text-sm">{step.details}</p>
                </CardContent>
              </Card>
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                  <ArrowRight className="w-6 h-6 text-slate-400" />
                </div>
              )}
            </div>
          ))}
        </div>

    </Section>
  );
}
