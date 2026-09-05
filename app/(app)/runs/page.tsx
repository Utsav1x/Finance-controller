import Link from 'next/link'
import { Layers, Play } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { LinkButton } from '@/components/ui/link-button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/app/page-header'
import { EmptyState } from '@/components/recon/empty-state'
import { listRuns } from '@/lib/db/queries'
import { formatDuration, formatRelative } from '@/lib/format-date'

export const dynamic = 'force-dynamic'

export default async function RunsPage() {
  const runs = listRuns(50)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Runs"
        title="Every reconciliation, kept"
        description="Runs are immutable. Each records what the engine concluded under a named tolerance profile from a named seed, so a change in the numbers can always be traced to a change you made."
        actions={
          <LinkButton
            href="/run"
            size="lg"
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            <Play className="size-4" />
            New run
          </LinkButton>
        }
      />

      {runs.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No runs yet"
          body="Reconcile a batch and it will be stored here with its full evidence trail, metrics and exception list."
          action={{ href: '/run', label: 'Reconcile a batch' }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="p-4 font-medium">Run</th>
                    <th className="p-4 font-medium">Seed</th>
                    <th className="p-4 font-medium">Auto-matched</th>
                    <th className="p-4 font-medium">Precision</th>
                    <th className="p-4 font-medium">Recall</th>
                    <th className="p-4 font-medium">FP</th>
                    <th className="p-4 font-medium">Open</th>
                    <th className="p-4 font-medium">Time</th>
                    <th className="p-4 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {runs.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-muted/40">
                      <td className="p-4">
                        <Link href={`/runs/${r.id}`} className="font-medium hover:text-primary">
                          {r.label}
                        </Link>
                        <div className="mt-1 flex items-center gap-2">
                          {r.adjudicator ? (
                            <Badge variant="accent" className="text-[0.65rem]">
                              {r.adjudicator}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[0.65rem]">
                              rules only
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="amount p-4 text-muted-foreground">{r.seed}</td>
                      <td className="amount p-4 text-success">
                        {(r.autoMatchRate * 100).toFixed(1)}%
                      </td>
                      <td className="amount p-4">
                        {(r.metrics.overall.precision * 100).toFixed(1)}%
                      </td>
                      <td className="amount p-4">{(r.metrics.overall.recall * 100).toFixed(1)}%</td>
                      <td
                        className={`amount p-4 ${r.metrics.resolution.falsePositives > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                      >
                        {r.metrics.resolution.falsePositives}
                      </td>
                      <td className="amount p-4 text-warning">{r.openExceptions}</td>
                      <td className="amount p-4 text-muted-foreground">
                        {formatDuration(r.metrics.throughput.wallMs)}
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">
                        {formatRelative(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
