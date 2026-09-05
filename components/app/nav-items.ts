import {
  LayoutDashboard,
  PlayCircle,
  Layers,
  TriangleAlert,
  Gauge,
  MessagesSquare,
  Wallet,
  SlidersHorizontal,
  Database,
} from 'lucide-react'

export type NavItem = {
  label: string
  href: string
  icon: typeof LayoutDashboard
}

export const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Reconcile',
    items: [
      { label: 'Overview',    href: '/dashboard',  icon: LayoutDashboard },
      { label: 'New Run',     href: '/run',        icon: PlayCircle      },
      { label: 'Runs',        href: '/runs',       icon: Layers          },
      { label: 'Exceptions',  href: '/exceptions', icon: TriangleAlert   },
    ],
  },
  {
    title: 'Analyze',
    items: [
      { label: 'Scorecard',     href: '/scorecard', icon: Gauge          },
      { label: 'Ask the Ledger',href: '/ask',       icon: MessagesSquare },
      { label: 'Cash Position', href: '/cash',      icon: Wallet         },
    ],
  },
  {
    title: 'Configure',
    items: [
      { label: 'Rules & Tolerances', href: '/rules', icon: SlidersHorizontal },
      { label: 'Data Studio',        href: '/data',  icon: Database          },
    ],
  },
]
