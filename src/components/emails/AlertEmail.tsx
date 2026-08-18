// src/components/emails/AlertEmail.tsx
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

interface AlertEmailProps {
  alert: {
    asset: string
    condition: 'above' | 'below'
    targetPrice: number
  }
  price: number
  timestamp: string
  dashboardUrl: string
}

export const AlertEmail: React.FC<AlertEmailProps> = ({
  alert,
  price,
  timestamp,
  dashboardUrl,
}) => {
  const isAbove = alert.condition === 'above'
  const priceChange =
    alert.targetPrice > 0
      ? ((price - alert.targetPrice) / alert.targetPrice * 100).toFixed(2)
      : '0.00'

  return (
    <Html>
      <Head />
      <Preview>
        Price Alert: {alert.asset} reached {isAbove ? 'above' : 'below'} ${String(alert.targetPrice)}
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
                color: '#10b981',
                textAlign: 'center',
              }}
            >
              Price Alert
            </Text>
            <Hr />
          </Section>

          <Section>
            <Text style={{ fontSize: '16px', color: '#333' }}>
              <strong>{alert.asset}</strong> has moved {isAbove ? 'above' : 'below'} your target price
              of ${alert.targetPrice}
            </Text>
            <Text
              style={{
                fontSize: '28px',
                fontWeight: 'bold',
                textAlign: 'center',
                color: isAbove ? '#10b981' : '#ef4444',
              }}
            >
              ${price.toFixed(2)}
              <span style={{ fontSize: '16px', color: '#666', marginLeft: '10px' }}>
                ({isAbove ? '+' : ''}
                {priceChange}%)
              </span>
            </Text>
            <Text style={{ fontSize: '14px', color: '#888', textAlign: 'center' }}>
              Updated: {new Date(timestamp).toLocaleString()}
            </Text>
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
              View Alerts Dashboard
            </Button>
          </Section>

          <Hr style={{ marginTop: '30px' }} />

          <Section>
            <Text style={{ fontSize: '12px', color: '#888', textAlign: 'center' }}>
              You're receiving this email because you set a price alert on TOPTIER.
              <br />
              <a
                href={`${process.env.NEXT_PUBLIC_APP_URL || ''}/settings`}
                style={{ color: '#10b981', textDecoration: 'underline' }}
              >
                Manage your notification preferences
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default AlertEmail
