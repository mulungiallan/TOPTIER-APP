// src/components/emails/WeeklyReportEmail.tsx
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

interface WeeklyReportEmailProps {
  stats: {
    name: string
    totalSignals: number
    winRate: number
    wins: number
    losses: number
    pnl: number
    bestTrade?: string
    topAsset?: string
  }
  dashboardUrl: string
}

export const WeeklyReportEmail: React.FC<WeeklyReportEmailProps> = ({ stats, dashboardUrl }) => {
  const isPositivePnl = stats.pnl >= 0
  const pnlColor = isPositivePnl ? '#10b981' : '#ef4444'

  return (
    <Html>
      <Head />
      <Preview>Your Weekly Trading Report - TOPTIER</Preview>
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
                color: '#10b981',
                textAlign: 'center',
              }}
            >
              Your Weekly Report
            </Text>
            <Text style={{ fontSize: '14px', color: '#888', textAlign: 'center' }}>
              {stats.name}, here's how your trading went this week
            </Text>
            <Hr />
          </Section>

          <Section>
            <Text
              style={{
                fontSize: '36px',
                fontWeight: 'bold',
                textAlign: 'center',
                color: pnlColor,
                margin: '16px 0',
              }}
            >
              {isPositivePnl ? '+' : ''}${Math.abs(stats.pnl).toFixed(2)}
            </Text>
            <Text style={{ fontSize: '14px', color: '#888', textAlign: 'center' }}>
              Total P&L this week
            </Text>
          </Section>

          <Hr style={{ margin: '24px 0' }} />

          <Section>
            <table
              width="100%"
              cellPadding="0"
              cellSpacing="0"
              style={{ fontSize: '14px', color: '#333' }}
            >
              <tbody>
                <tr>
                  <td style={{ padding: '8px 0', color: '#888' }}>Total Signals</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold' }}>
                    {stats.totalSignals}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '8px 0', color: '#888' }}>Win Rate</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#10b981' }}>
                    {stats.winRate.toFixed(1)}%
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '8px 0', color: '#888' }}>Wins / Losses</td>
                  <td style={{ padding: '8px 0', textAlign: 'right' }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold' }}>{stats.wins}W</span>{' '}
                    /{' '}
                    <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{stats.losses}L</span>
                  </td>
                </tr>
                {stats.topAsset && (
                  <tr>
                    <td style={{ padding: '8px 0', color: '#888' }}>Top Asset</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold' }}>
                      {stats.topAsset}
                    </td>
                  </tr>
                )}
                {stats.bestTrade && (
                  <tr>
                    <td style={{ padding: '8px 0', color: '#888' }}>Best Trade</td>
                    <td style={{ padding: '8px 0', textAlign: 'right' }}>{stats.bestTrade}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Section>

          <Section style={{ textAlign: 'center', marginTop: '30px' }}>
            <Button
              href={dashboardUrl}
              style={{
                backgroundColor: '#10b981',
                color: '#ffffff',
                padding: '12px 24px',
                borderRadius: '6px',
                textDecoration: 'none',
                fontWeight: 'bold',
              }}
            >
              View Full Performance
            </Button>
          </Section>

          <Hr style={{ marginTop: '30px' }} />
          <Section>
            <Text style={{ fontSize: '12px', color: '#888', textAlign: 'center' }}>
              You're receiving this weekly report because you have email notifications enabled.
              <br />
              <a
                href={`${process.env.NEXT_PUBLIC_APP_URL || ''}/settings`}
                style={{ color: '#10b981', textDecoration: 'underline' }}
              >
                Manage notification preferences
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default WeeklyReportEmail
