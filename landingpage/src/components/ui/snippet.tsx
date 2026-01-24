"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";
import { Check, Copy } from "lucide-react";

const Snippet = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Root
    ref={ref}
    className={cn("overflow-hidden rounded-lg border border-slate-200", className)}
    {...props}
  />
));
Snippet.displayName = "Snippet";

const SnippetHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 rounded-t-lg",
      className
    )}
    {...props}
  />
));
SnippetHeader.displayName = "SnippetHeader";

const SnippetTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("flex items-center gap-1", className)}
    {...props}
  />
));
SnippetTabsList.displayName = TabsPrimitive.List.displayName;

const SnippetTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
));
SnippetTabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const SnippetTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-0 bg-white p-4 text-slate-900 overflow-x-auto rounded-b-lg",
      className
    )}
    {...props}
  >
    <code className="text-sm font-mono whitespace-pre">{children}</code>
  </TabsPrimitive.Content>
));
SnippetTabsContent.displayName = TabsPrimitive.Content.displayName;

interface SnippetCopyButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  onCopy?: () => void;
  onError?: () => void;
}

const SnippetCopyButton = React.forwardRef<
  HTMLButtonElement,
  SnippetCopyButtonProps
>(({ className, value, onCopy, onError, ...props }, ref) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      onError?.();
    }
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md p-2 text-sm font-medium transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-600" />
      ) : (
        <Copy className="h-4 w-4 text-slate-600" />
      )}
    </button>
  );
});
SnippetCopyButton.displayName = "SnippetCopyButton";

export {
  Snippet,
  SnippetHeader,
  SnippetTabsList,
  SnippetTabsTrigger,
  SnippetTabsContent,
  SnippetCopyButton,
};
