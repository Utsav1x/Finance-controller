import { Logo } from '@/components/logo'
import { LinkButton } from '@/components/ui/link-button'

export function SiteNavbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav className="ml-auto hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a className="transition-colors hover:text-foreground" href="#how">How it works</a>
          <a className="transition-colors hover:text-foreground" href="#accuracy">Accuracy</a>
          <a className="transition-colors hover:text-foreground" href="#features">Features</a>
        </nav>
        <LinkButton
          href="/run"
          size="lg"
          className="ml-auto h-9 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground md:ml-0"
        >
          Run a reconciliation
        </LinkButton>
      </div>
    </header>
  )
}
