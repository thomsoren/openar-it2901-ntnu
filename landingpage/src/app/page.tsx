import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Hero } from "@/components/sections/hero";
import { Overview } from "@/components/sections/overview";
import { WhyNow } from "@/components/sections/why-now";
import { HowItWorks } from "@/components/sections/how-it-works";
import { MVP } from "@/components/sections/mvp";
import { Contact } from "@/components/sections/contact";

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="page-sections mx-auto">
        <Hero />
        <Overview />
        <WhyNow />
        <HowItWorks />
        <MVP />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
