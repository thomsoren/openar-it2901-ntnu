import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/layout/section";
import { AlertCircle, Timer, Box } from "lucide-react";
import { Check } from "lucide-react";

export function WhyNow() {
  const problems = [
    {
      icon: AlertCircle,
      title: "Proprietary stacks",
      description:
        "Custom overlay systems require unique integrations for each implementation",
    },
    {
      icon: Timer,
      title: "Sync challenges",
      description:
        "Difficult to reliably synchronize video, detections, and AIS data",
    },
    {
      icon: Box,
      title: "No shared standard",
      description:
        "Reusable components exist, but lack a unified overlay contract",
    },
  ];

  const outcomes = [
    {
      icon: Check,
      title: "Faster prototyping",
      description: "Build and test maritime AR applications rapidly",
    },
    {
      icon: Check,
      title: "Reduced rework",
      description: "Shared contract minimizes custom integration code",
    },
    {
      icon: Check,
      title: "Consistent UI",
      description: "OpenBridge components ensure familiar maritime interfaces",
    },
  ];

  return (
    <Section containerSize="xl">
      <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl font-semibold text-slate-900 mb-4">
            Why now?
          </h2>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            Maritime AR overlays face common challenges. OpenAR provides a
            standard solution.
          </p>
        </div>

        {/* Problems */}
        <div className="mb-12">
          <h3 className="text-xl font-semibold text-slate-900 mb-6">Challenges</h3>
          <div className="grid md:grid-cols-3 gap-6">
            {problems.map((problem) => (
              <Card key={problem.title}>
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-red-500/10 flex items-center justify-center mb-4">
                    <problem.icon className="w-6 h-6 text-red-400" />
                  </div>
                  <CardTitle className="text-lg">{problem.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600 text-sm">{problem.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Outcomes */}
        <div>
          <h3 className="text-xl font-semibold text-slate-900 mb-6">Solutions</h3>
          <div className="grid md:grid-cols-3 gap-6">
            {outcomes.map((outcome) => (
              <Card key={outcome.title}>
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center mb-4">
                    <outcome.icon className="w-6 h-6 text-green-400" />
                  </div>
                  <CardTitle className="text-lg">{outcome.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600 text-sm">{outcome.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
    </Section>
  );
}
