export const siteConfig = {
  name: "OpenAR",
  description:
    "A standard for web based maritime AR overlays. OpenAR unifies data vision detections and AIS into a simple contract, and renders a clean video overlay with OpenBridge components in the browser.",
  url: "https://openar.io",
  links: {
    demo: process.env.NEXT_PUBLIC_DEMO_URL || "https://demo.bridgable.ai",
    meeting:
      process.env.NEXT_PUBLIC_MEETING_URL ||
      "https://cal.com/thomas-s%C3%B8rensen-ucurtg/15min?overlayCalendar=true",
    github:
      process.env.NEXT_PUBLIC_GITHUB_URL ||
      "https://github.com/thomsoren/openar-it2901-ntnu",
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "thomanso@stud.ntnu.no",
  },
  assets: {
    baseUrl: process.env.NEXT_PUBLIC_ASSETS_BASE_URL || "",
  },
};
