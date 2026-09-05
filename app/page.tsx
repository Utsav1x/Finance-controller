import { SiteNavbar } from '@/components/landing/site-navbar'
import { Hero } from '@/components/landing/hero'
import { HowItWorks } from '@/components/landing/how-it-works'
import { Accuracy } from '@/components/landing/accuracy'
import { Features } from '@/components/landing/features'
import { CTA, SiteFooter } from '@/components/landing/cta'

export default function LandingPage() {
  return (
    <div className="min-h-svh">
      <SiteNavbar />
      <main>
        <Hero />
        <HowItWorks />
        <Accuracy />
        <Features />
        <CTA />
      </main>
      <SiteFooter />
    </div>
  )
}
