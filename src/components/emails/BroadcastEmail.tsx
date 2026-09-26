// src/components/emails/BroadcastEmail.tsx
// Admin announcement email. The body is authored as plain text (blank line =
// paragraph break, "- " = bullet) and rendered here as real paragraphs so
// line breaks survive HTML — a raw <Text> would collapse every "\n" and
// deliver the announcement as one run-on block.
// `toPlainText` produces the text/plain alternative leg for the same content.

import * as React from 'react'
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
} from '@react-email/components'

export interface ParsedBlock {
  type: 'p' | 'ul' | 'ol' | 'h'
  text?: string
  items?: string[]
}

/** Parse the admin's plain-text body into renderable blocks. */
export function parseBroadcastBody(body: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const joined = paragraph.join(' ').trim()
    if (joined) blocks.push({ type: 'p', text: joined })
    paragraph = []
  }

  for (const rawLine of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      continue
    }

    // Headings: "# Title" (or "Title" on its own line followed by "---").
    if (trimmed.startsWith('# ')) {
      flushParagraph()
      blocks.push({ type: 'h', text: trimmed.slice(2).trim() })
      continue
    }

    // Bullets: "- item" / "• item"
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      flushParagraph()
      const item = trimmed.slice(2).trim()
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'ul') last.items!.push(item)
      else blocks.push({ type: 'ul', items: [item] })
      continue
    }

    // Numbered list: "1. item"
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed)
    if (ordered) {
      flushParagraph()
      const item = ordered[2].trim()
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'ol') last.items!.push(item)
      else blocks.push({ type: 'ol', items: [item] })
      continue
    }

    // Soft-wrapped continuation of the current paragraph.
    paragraph.push(trimmed)
  }

  flushParagraph()
  return blocks
}

/** Plain-text alternative leg — mirrors the HTML blocks 1:1. */
export function toPlainText(subject: string, body: string, actionUrl?: string, actionLabel?: string): string {
  const lines: string[] = [subject, '']
  for (const block of parseBroadcastBody(body)) {
    if (block.type === 'h') {
      lines.push(block.text!.toUpperCase(), '')
    } else if (block.type === 'ul') {
      lines.push(...block.items!.map((i) => `  - ${i}`), '')
    } else if (block.type === 'ol') {
      lines.push(...block.items!.map((i, idx) => `  ${idx + 1}. ${i}`), '')
    } else {
      lines.push(block.text!, '')
    }
  }
  if (actionUrl) {
    lines.push(`${actionLabel || 'Open'}: ${actionUrl}`, '')
  }
  return lines.join('\n').trim()
}

interface BroadcastEmailProps {
  subject: string
  body: string
  actionUrl?: string
  actionLabel?: string
  unsubscribeUrl?: string
}

export const BroadcastEmail: React.FC<BroadcastEmailProps> = ({
  subject,
  body,
  actionUrl,
  actionLabel = 'View Now',
  unsubscribeUrl,
}) => {
  const blocks = React.useMemo(() => parseBroadcastBody(body), [body])

  return (
    <Html>
      <Head />
      <Preview>{subject}</Preview>
      <Body style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f4f4f4', padding: '20px', margin: 0 }}>
        <Container
          style={{
            maxWidth: '600px',
            margin: '0 auto',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            padding: '40px',
          }}
        >
          <Section>
            <Text
              style={{
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#10b981',
                textAlign: 'center',
                margin: 0,
              }}
            >
              TOP<span style={{ color: '#333' }}>TIER</span>
            </Text>
            <Hr />
          </Section>

          <Section>
            <Text style={{ fontSize: '20px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 16px' }}>
              {subject}
            </Text>

            {blocks.map((block, i) => {
              if (block.type === 'h') {
                return (
                  <Text
                    key={i}
                    style={{
                      fontSize: '13px',
                      fontWeight: 'bold',
                      color: '#10b981',
                      letterSpacing: '0.06em',
                      margin: '24px 0 8px',
                    }}
                  >
                    {block.text}
                  </Text>
                )
              }
              if (block.type === 'ul') {
                return (
                  <ul key={i} style={{ fontSize: '15px', color: '#374151', lineHeight: '1.7', paddingLeft: '20px', margin: '0 0 16px' }}>
                    {block.items!.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                )
              }
              if (block.type === 'ol') {
                return (
                  <ol key={i} style={{ fontSize: '15px', color: '#374151', lineHeight: '1.7', paddingLeft: '20px', margin: '0 0 16px' }}>
                    {block.items!.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ol>
                )
              }
              return (
                <Text key={i} style={{ fontSize: '15px', color: '#374151', lineHeight: '1.7', margin: '0 0 16px' }}>
                  {block.text}
                </Text>
              )
            })}

            {actionUrl && (
              <Section style={{ textAlign: 'center', margin: '32px 0 8px' }}>
                <Button
                  href={actionUrl}
                  style={{
                    backgroundColor: '#10b981',
                    color: '#ffffff',
                    padding: '12px 24px',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    fontWeight: 'bold',
                    display: 'inline-block',
                  }}
                >
                  {actionLabel}
                </Button>
              </Section>
            )}
          </Section>

          <Hr style={{ marginTop: '30px' }} />

          <Section>
            <Text style={{ fontSize: '12px', color: '#6b7280', textAlign: 'center', lineHeight: '1.6' }}>
              You are receiving this announcement from TOPTIER because you have an account here.
              <br />
              <a href={unsubscribeUrl} style={{ color: '#10b981', textDecoration: 'underline' }}>
                Manage your notification preferences
              </a>
            </Text>
            <Text style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', margin: '12px 0 0' }}>
              Trading involves substantial risk. Past performance is not indicative of future results.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default BroadcastEmail
