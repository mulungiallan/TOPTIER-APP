// src/components/emails/SignalEmail.tsx
import * as React from 'react'
import {
  Html,
  Body,
  Container,
  Section,
  Text,
  Button,
  Head,
  Preview,
  Hr,
} from '@react-email/components'

interface SignalEmailProps {
  signal: {
    asset: string
    direction: 'BUY' | 'SELL'
    entryPrice: number
    stopLoss: number
    takeProfit1: number
    confidence: number
    strategy?: string
    timeframe?: string
    reason?: string
  }
  dashboardUrl: string
}

export const SignalEmail: React.FC<SignalEmailProps> = ({ signal, dashboardUrl }) => {
  const isBuy = signal.direction === 'BUY'
  const accentColor = isBuy ? '#10b981' : '#ef4444'

  return (
    <Html>
      <Head />
      <Preview>
        New {signal.direction} signal: {signal.asset} at {String(signal.entryPrice)}
      </Preview>
      <Body style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f4f4f4', padding: '20px' }}>
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
                color: accentColor,
                textAlign: 'center',
              }}
            >
              New Trading Signal
            </Text>
            <Hr />
          </Section>

          <Section>
            <Text style={{ fontSize: '16px', color: '#333', textAlign: 'center' }}>
              <strong style={{ color: accentColor }}>{signal.direction}</strong> on{' '}
              <strong>{signal.asset}</strong>
              {signal.timeframe && ` (${signal.timeframe})`}
            </Text>

            <Text
              style={{
                fontSize: '32px',
                fontWeight: 'bold',
                textAlign: 'center',
                color: accentColor,
              }}
            >
              {signal.asset}
            </Text>

            <Hr style={{ margin: '20px 0' }} />

            <table
              width="100%"
              cellPadding="0"
              cellSpacing="0"
              style={{ fontSize: '14px', color: '#333' }}
            >
              <tbody>
                <tr>
                  <td style={{ padding: '6px 0', color: '#888' }}>Direction</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 'bold', color: accentColor }}>
                    {signal.direction}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '6px 0', color: '#888' }}>Entry Price</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'monospace' }}>
                    {signal.entryPrice}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '6px 0', color: '#888' }}>Stop Loss</td>
                  <td
                    style={{
                      padding: '6px 0',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      color: '#ef4444',
                    }}
                  >
                    {signal.stopLoss}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '6px 0', color: '#888' }}>Take Profit</td>
                  <td
                    style={{
                      padding: '6px 0',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      color: '#10b981',
                    }}
                  >
                    {signal.takeProfit1}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '6px 0', color: '#888' }}>Confidence</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 'bold' }}>
                    {signal.confidence}%
                  </td>
                </tr>
                {signal.strategy && (
                  <tr>
                    <td style={{ padding: '6px 0', color: '#888' }}>Strategy</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{signal.strategy}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {signal.reason && (
              <>
                <Hr style={{ margin: '20px 0' }} />
                <Text style={{ fontSize: '14px', color: '#555' }}>
                  <strong>Analysis:</strong> {signal.reason}
                </Text>
              </>
            )}
          </Section>

          <Section style={{ textAlign: 'center', marginTop: '30px' }}>
            <Button
              href={dashboardUrl}
              style={{
                backgroundColor: accentColor,
                color: '#ffffff',
                padding: '12px 24px',
                borderRadius: '6px',
                textDecoration: 'none',
                fontWeight: 'bold',
              }}
            >
              View All Signals
            </Button>
          </Section>

          <Hr style={{ marginTop: '30px' }} />
          <Section>
            <Text style={{ fontSize: '12px', color: '#888', textAlign: 'center' }}>
              Trading involves substantial risk. Past performance is not indicative of future results.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default SignalEmail
