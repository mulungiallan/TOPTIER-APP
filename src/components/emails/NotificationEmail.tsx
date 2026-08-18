// src/components/emails/NotificationEmail.tsx
// Generic notification email used when a notification type has email enabled.

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

interface NotificationEmailProps {
  title: string
  message: string
  actionUrl?: string
  actionLabel?: string
  unsubscribeUrl?: string
}

export const NotificationEmail: React.FC<NotificationEmailProps> = ({
  title,
  message,
  actionUrl,
  actionLabel = 'Open Dashboard',
  unsubscribeUrl,
}) => {
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
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
              TOPTIER
            </Text>
            <Hr />
          </Section>

          <Section>
            <Text style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>{title}</Text>
            <Text style={{ fontSize: '15px', color: '#444', lineHeight: '22px' }}>{message}</Text>
          </Section>

          {actionUrl && (
            <Section style={{ textAlign: 'center', marginTop: '30px' }}>
              <Button
                href={actionUrl}
                style={{
                  backgroundColor: '#10b981',
                  color: '#ffffff',
                  padding: '12px 24px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontWeight: 'bold',
                }}
              >
                {actionLabel}
              </Button>
            </Section>
          )}

          <Hr style={{ marginTop: '30px' }} />

          <Section>
            <Text style={{ fontSize: '12px', color: '#888', textAlign: 'center' }}>
              You're receiving this email from TOPTIER.
              <br />
              <a
                href={unsubscribeUrl || `${process.env.NEXT_PUBLIC_APP_URL || ''}/settings`}
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

export default NotificationEmail
