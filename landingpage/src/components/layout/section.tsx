import { cn } from "@/lib/cn";

interface SectionProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
  background?: "gradient" | "dark" | "light" | "transparent";
  containerSize?: "sm" | "md" | "lg" | "xl" | "full";
}

export function Section({
  children,
  className,
  id,
  background = "transparent",
  containerSize = "lg",
}: SectionProps) {
  const bgClass = {
    gradient: "hero-gradient",
    dark: "bg-[#0B1224]",
    light: "bg-[#060A12]",
    transparent: "bg-transparent",
  }[background];

  const containerClass = {
    sm: "max-w-3xl",
    md: "max-w-4xl",
    lg: "max-w-5xl",
    xl: "max-w-6xl",
    full: "max-w-7xl",
  }[containerSize];

  return (
    <section
      id={id}
      className={cn("py-20 md:py-32", bgClass, className)}
    >
      <div className={cn("page-container", containerClass)}>{children}</div>
    </section>
  );
}
