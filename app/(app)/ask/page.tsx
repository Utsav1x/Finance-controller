'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, MessagesSquare, Send, TriangleAlert, Wrench } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/app/page-header'

interface AskResponse {
  answer: string
  toolsUsed: { tool: string; arg: string }[]
  citations: string[]
  usage: { calls: number; inputTokens: number; outputTokens: number }
  runId: string
}

const SUGGESTIONS = [
  'How did this run actually do, and what did it miss?',
  'Which payouts never landed in the bank?',
  'Are we being overcharged on gateway fees?',
  'What is sitting in the exception queue and how much is at stake?',
  'Why is any payout smaller than the payments it contains?',
]

export default function AskPage() {
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<{ q: string; a: AskResponse }[]>([])

  async function ask(text: string) {
    const q = text.trim()
    if (!q || asking) return

    setAsking(true)
    setError(null)
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'the question could not be answered')
      setHistory((h) => [{ q, a: data as AskResponse }, ...h])
      setQuestion('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Ask the ledger"
        title="Questions, answered from the records"
        description="The model picks which typed queries to run; the queries run locally against the reconciled data; the answer is written from the rows that come back. Every figure is traceable and every record it names can be opened."
      />

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask(question)
                }
              }}
              placeholder="Why is the payout on 14 Aug short?"
              className="h-11 flex-1 rounded-lg border border-border bg-card/60 px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
            <Button
              size="lg"
              onClick={() => ask(question)}
              disabled={asking || question.trim().length < 3}
              className="h-11 gap-2 bg-gradient-to-r from-primary to-accent px-5 text-primary-foreground"
            >
              {asking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Ask
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                disabled={asking}
                className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm text-destructive">{error}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Ask the Ledger is the one feature that needs a key. The reconciliation engine, the
                scorecard and the exception queue all work without one — see{' '}
                <Link href="/scorecard" className="text-primary hover:underline">
                  the scorecard
                </Link>{' '}
                for numbers produced with no model involved at all.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {history.length === 0 && !error && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-2xl border border-border bg-muted/50 text-muted-foreground">
              <MessagesSquare className="size-6" />
            </span>
            <h3 className="text-lg font-semibold">Ask about the latest run</h3>
            <p className="max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground">
              Answers come from eight typed queries over the run&apos;s own records — not from
              retrieval over text. If the rows do not contain what you asked, it says so rather
              than filling the gap with a plausible number.
            </p>
          </CardContent>
        </Card>
      )}

      {history.map((entry, i) => (
        <Card key={`${entry.q}-${i}`}>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-primary">{entry.q}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{entry.a.answer}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wrench className="size-3" />
                Queries run
              </span>
              {entry.a.toolsUsed.map((t, j) => (
                <Badge key={`${t.tool}-${j}`} variant="outline" className="amount text-[0.65rem]">
                  {t.tool}
                  {t.arg ? `(${t.arg})` : '()'}
                </Badge>
              ))}
              {entry.a.citations.length > 0 && (
                <>
                  <span className="ml-2 text-xs text-muted-foreground">Cited</span>
                  {entry.a.citations.map((c) => (
                    <Link
                      key={c}
                      href={`/runs/${entry.a.runId}`}
                      className="amount rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.65rem] text-primary transition-colors hover:bg-primary/20"
                    >
                      {c}
                    </Link>
                  ))}
                </>
              )}
              <span className="amount ml-auto text-[0.65rem] text-muted-foreground">
                {entry.a.usage.calls} call(s) · {entry.a.usage.inputTokens + entry.a.usage.outputTokens} tokens
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
