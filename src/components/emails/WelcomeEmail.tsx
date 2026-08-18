// src/components/emails/WelcomeEmail.tsx
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

interface WelcomeEmailProps {
  name: string
  dashboardUrl: string
  learnUrl: string
}

export const WelcomeEmail: React.FC<WelcomeEmailProps> = ({ name, dashboardUrl, learnUrl }) => {
  return (
    <Html>
      <Head />
      <Preview>Welcome to TOPTIER - Your AI Trading Platform is Ready!</Preview>
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
                fontSize: '28px',
                fontWeight: 'bold',
                color: '#10b981',
                textAlign: 'center',
              }}
            >
              TOP
              <span style={{ color: '#333' }}>TIER</span>
            </Text>
            <Hr />
          </Section>

          <Section>
            <Text style={{ fontSize: '22px', fontWeight: 'bold', color: '#333' }}>
              Welcome, {name}!
            </Text>
            <Text style={{ fontSize: '16px', color: '#555', lineHeight: '1.6' }}>
              Your TOPTIER account is ready. You now have access to AI-powered trading signals,
              screenshot analysis, market intelligence, and a community of 50,000+ traders.
            </Text>

            <Section style={{ margin: '24px 0' }}>
              <Text style={{ fontSize: '14px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
                Quick Start:
              </Text>
              <ul style={{ fontSize: '14px', color: '#555', lineHeight: '1.8', paddingLeft: '20px' }}>
                <li>Check the Dashboard for today's market overview</li>
                <li>Explore active trading signals with confidence scores</li>
                <li>Upload a chart screenshot for instant AI analysis</li>
                <li>Set up price alerts on your favorite assets</li>
                <li>Join the community and connect with other traders</li>
              </ul>
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
                  display: 'inline-block',
                  marginRight: '10px',
                }}
              >
                Go to Dashboard
              </Button>
              <Button
                href={learnUrl}
                style={{
                  backgroundColor: '#ffffff',
                  color: '#10b981',
                  border: '2px solid #10b981',
                  padding: '10px 24px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontWeight: 'bold',
                  display: 'inline-block',
                }}
              >
                Learn the Basics
              </Button>
            </Section>
          </Section>

          <Hr style={{ marginTop: '30px' }} />

          <Section>
            <Text style={{ fontSize: '12px', color: '#888', textAlign: 'center' }}>
              Trading involves substantial risk. Past performance is not indicative of future results.
              <br />
              Need help? Contact us at support@toptier.app
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default WelcomeEmail
