// src/components/emails/PasswordResetEmail.tsx
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

interface PasswordResetEmailProps {
  resetUrl: string
  supportUrl: string
}

export const PasswordResetEmail: React.FC<PasswordResetEmailProps> = ({ resetUrl, supportUrl }) => {
  return (
    <Html>
      <Head />
      <Preview>Reset your TOPTIER password</Preview>
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
              Reset Your Password
            </Text>
            <Hr />
          </Section>

          <Section>
            <Text style={{ fontSize: '16px', color: '#333', lineHeight: '1.6' }}>
              We received a request to reset the password for your TOPTIER account. Click the button
              below to set a new password:
            </Text>

            <Section style={{ textAlign: 'center', marginTop: '24px' }}>
              <Button
                href={resetUrl}
                style={{
                  backgroundColor: '#10b981',
                  color: '#ffffff',
                  padding: '12px 24px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontWeight: 'bold',
                }}
              >
                Reset Password
              </Button>
            </Section>

            <Text style={{ fontSize: '14px', color: '#555', marginTop: '24px' }}>
              Or copy and paste this link into your browser:
            </Text>
            <Text
              style={{
                fontSize: '12px',
                color: '#10b981',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}
            >
              {resetUrl}
            </Text>

            <Hr style={{ margin: '24px 0' }} />

            <Text style={{ fontSize: '14px', color: '#888' }}>
              This link will expire in 1 hour. If you did not request a password reset, you can
              safely ignore this email - your password will remain unchanged.
            </Text>

            <Text style={{ fontSize: '14px', color: '#555', marginTop: '16px' }}>
              Need help?{' '}
              <a href={supportUrl} style={{ color: '#10b981', textDecoration: 'underline' }}>
                Contact support
              </a>
            </Text>
          </Section>

          <Hr style={{ marginTop: '30px' }} />
          <Section>
            <Text style={{ fontSize: '12px', color: '#888', textAlign: 'center' }}>
              If you didn't request this, please contact us immediately at support@toptier.app
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default PasswordResetEmail
