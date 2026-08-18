// src/lib/services/email.tsx
// Email notification service using Resend
// Free tier: 3,000 emails/month with verified domain, 100/day on free tier

import * as React from 'react'
import { Resend } from 'resend'
import { render } from '@react-email/render'
import {
  AlertEmail,
  SignalEmail,
  WelcomeEmail,
  PasswordResetEmail,
  WeeklyReportEmail,
  NotificationEmail,
} from '@/components/emails'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || 'notifications@toptier.app'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null

export interface EmailOptions {
  to: string
  subject: string
  html: string
  from?: string
}

export class EmailService {
  private from = EMAIL_FROM

  /**
   * Internal: send an email via Resend.
   * Fails loudly (throws) when RESEND_API_KEY is not configured — we never
   * fabricate a successful send, so callers can't record "email delivered".
   */
  async sendEmail(options: EmailOptions) {
    if (!resend) {
      console.error(
        `[EmailService] RESEND_API_KEY is not configured — refusing to claim email ` +
        `delivered to ${options.to}. Set RESEND_API_KEY in .env to enable email.`
      )
      throw new Error('Email delivery is not configured. Set RESEND_API_KEY in .env to enable email.')
    }

    try {
      const { data, error } = await resend.emails.send({
        from: options.from || this.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
      })

      if (error) {
        console.error('[EmailService] Resend error:', error)
        throw error
      }

      return data
    } catch (error) {
      console.error('[EmailService] sendEmail failed:', error)
      throw error
    }
  }

  async sendAlertEmail(
    to: string,
    alert: { asset: string; condition: 'above' | 'below'; targetPrice: number },
    price: number
  ) {
    const html = await render(
      <AlertEmail
        alert={alert}
        price={price}
        timestamp={new Date().toISOString()}
        dashboardUrl={`${APP_URL}/alerts`}
      />
    )

    return this.sendEmail({
      to,
      subject: `Price Alert: ${alert.asset} ${alert.condition} ${alert.targetPrice}`,
      html,
    })
  }

  /**
   * Generic notification email (used by notifyUser when the type has email
   * enabled). Content is derived from the in-app notification payload.
   */
  async sendNotificationEmail(
    to: string,
    notification: { title: string; message: string; actionUrl?: string }
  ) {
    const html = await render(
      <NotificationEmail
        title={notification.title}
        message={notification.message}
        actionUrl={notification.actionUrl}
        actionLabel={notification.actionUrl ? 'View Now' : undefined}
        unsubscribeUrl={`${APP_URL}/settings`}
      />
    )

    return this.sendEmail({
      to,
      subject: notification.title,
      html,
    })
  }

  async sendSignalEmail(
    to: string,
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
  ) {
    const html = await render(
      <SignalEmail
        signal={signal}
        dashboardUrl={`${APP_URL}/signals`}
      />
    )

    return this.sendEmail({
      to,
      subject: `New Trading Signal: ${signal.asset} ${signal.direction}`,
      html,
    })
  }

  async sendWelcomeEmail(to: string, name: string) {
    const html = await render(
      <WelcomeEmail
        name={name}
        dashboardUrl={`${APP_URL}/dashboard`}
        learnUrl={`${APP_URL}/education`}
      />
    )

    return this.sendEmail({
      to,
      subject: 'Welcome to TOPTIER! Your AI Trading Platform is Ready',
      html,
    })
  }

  async sendPasswordResetEmail(to: string, resetToken: string) {
    const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`
    const html = await render(
      <PasswordResetEmail
        resetUrl={resetUrl}
        supportUrl={`${APP_URL}/support`}
      />
    )

    return this.sendEmail({
      to,
      subject: 'Reset Your TOPTIER Password',
      html,
    })
  }

  async sendWeeklyReport(
    to: string,
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
  ) {
    const html = await render(
      <WeeklyReportEmail
        stats={stats}
        dashboardUrl={`${APP_URL}/performance`}
      />
    )

    return this.sendEmail({
      to,
      subject: 'Your Weekly Trading Report - TOPTIER',
      html,
    })
  }
}

export const emailService = new EmailService()
