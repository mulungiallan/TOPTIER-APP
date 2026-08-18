import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

// Static FAQ content
const FAQ_CONTENT = [
  {
    id: 'faq-1',
    question: 'How do I interpret trading signals?',
    answer: 'Each signal includes entry price, stop loss, and take profit levels. The confidence score (0-100) indicates the strength of the signal. Higher confidence signals have historically better win rates.',
  },
  {
    id: 'faq-2',
    question: 'What subscription plans are available?',
    answer: 'We offer Free, Trial (7 days), Premium (monthly/annual), and Lifetime plans. Premium includes unlimited signals, advanced analytics, and priority support.',
  },
  {
    id: 'faq-3',
    question: 'How does screenshot analysis work?',
    answer: 'Upload a chart screenshot and our AI will analyze patterns, identify potential entry/exit points, and provide a detailed explanation with confidence levels.',
  },
  {
    id: 'faq-4',
    question: 'Can I customize which signals I receive?',
    answer: 'Yes! You can filter signals by market type (forex, crypto, stocks), strategy (scalp, swing), timeframe, and minimum confidence level in your settings.',
  },
  {
    id: 'faq-5',
    question: 'How do I set up price alerts?',
    answer: 'Navigate to the Alerts page, click "Create Alert", select the asset and condition (above/below/crosses a price), and set your target. You\'ll be notified when triggered.',
  },
  {
    id: 'faq-6',
    question: 'Is my data secure?',
    answer: 'We use industry-standard encryption and security practices. Your trading data is never shared with third parties. You can opt out of analytics in Settings.',
  },
]

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const tickets = await db.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    return successResponse({
      tickets,
      faq: FAQ_CONTENT,
    })
  } catch (error) {
    console.error('Support GET error:', error)
    return errorResponse('Failed to fetch support data', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { subject, description, category, priority, attachments } = body

    if (!subject || !description || !category) {
      return errorResponse('subject, description, and category are required', 400)
    }
    if (subject.length > 200) return errorResponse('Subject too long (max 200 characters)', 400)
    if (description.length > 5000) return errorResponse('Description too long (max 5000 characters)', 400)

    const validCategories = ['bug', 'feature_request', 'improvement', 'praise', 'complaint', 'support']
    if (!validCategories.includes(category)) {
      return errorResponse(`Invalid category. Must be one of: ${validCategories.join(', ')}`, 400)
    }

    const validPriorities = ['low', 'medium', 'high', 'critical']
    const resolvedPriority = priority && validPriorities.includes(priority) ? priority : 'medium'

    // Normalize and validate attachments (array of data URLs), cap total payload.
    let attachmentsJson: string | undefined
    if (Array.isArray(attachments) && attachments.length > 0) {
      const MAX_ATTACHMENTS = 5
      const MAX_BYTES = 8 * 1024 * 1024
      const clean = (attachments as string[])
        .filter((a) => typeof a === 'string' && a.startsWith('data:image/'))
        .slice(0, MAX_ATTACHMENTS)
      const totalBytes = clean.reduce((sum, a) => sum + a.length, 0)
      if (totalBytes > MAX_BYTES) {
        return errorResponse('Total attachment size exceeds 8MB', 400)
      }
      attachmentsJson = clean.length ? JSON.stringify(clean) : undefined
    }

    const ticket = await db.supportTicket.create({
      data: {
        userId,
        subject,
        description,
        category,
        priority: resolvedPriority,
        attachments: attachmentsJson,
      },
    })

    return successResponse(ticket, 201)
  } catch (error) {
    console.error('Support POST error:', error)
    return errorResponse('Failed to create support ticket', 500)
  }
}
