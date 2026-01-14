export interface Partner {
  name: string;
  logo: string;
  description: string;
  url?: string;
}

export const partners: Partner[] = [
  {
    name: "OpenBridge",
    logo: "/openbridge.webp",
    description: "Design system for maritime user interfaces",
    url: "https://openbridge.no",
  },
];
