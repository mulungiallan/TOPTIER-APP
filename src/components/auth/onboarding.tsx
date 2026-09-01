'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap,
  TrendingUp,
  Camera,
  Settings,
  Calendar,
  BarChart3,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  SkipForward,
  Check,
  ArrowRight,
  Target,
  Bell,
  Eye,
  Newspaper,
  Users,
  Shield,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { BrandLogo } from '@/components/branding/brand-logo'

interface OnboardingStep {
  title: string
  description: string
  icon: React.ElementType
  features?: { icon: React.ElementType; text: string }[]
  illustration: string
}

const steps: OnboardingStep[] = [
  {
    title: 'Welcome to TOPTIER',
    description: 'Your AI-powered trading companion that helps you analyze markets, identify opportunities, and make informed decisions.',
    icon: Zap,
    features: [
      { icon: TrendingUp, text: 'Real-time trading signals' },
      { icon: Camera, text: 'Screenshot analysis' },
      { icon: BarChart3, text: 'Performance tracking' },
    ],
    illustration: 'welcome',
  },
  {
    title: 'How Signals Work',
    description: 'Our AI analyzes market data, chart patterns, and technical indicators to generate high-confidence trading signals with clear entry, stop-loss, and take-profit levels.',
    icon: TrendingUp,
    features: [
      { icon: Target, text: 'Entry & exit points' },
      { icon: Shield, text: 'Risk management built-in' },
      { icon: Bell, text: 'Instant notifications' },
    ],
    illustration: 'signals',
  },
  {
    title: 'Screenshot Analyzer',
    description: 'Simply upload a screenshot of any trading chart, and our AI will identify patterns, support/resistance levels, and potential trading opportunities.',
    icon: Camera,
    features: [
      { icon: Camera, text: 'Upload any chart screenshot' },
      { icon: Eye, text: 'Pattern recognition' },
      { icon: Target, text: 'Actionable insights' },
    ],
    illustration: 'screenshot',
  },
  {
    title: 'Customize Your Preferences',
    description: 'Set your trading style, risk tolerance, preferred markets, and notification settings to receive personalized signals that match your strategy.',
    icon: Settings,
    features: [
      { icon: Target, text: 'Trading style selection' },
      { icon: Shield, text: 'Risk level adjustment' },
      { icon: Bell, text: 'Custom alert preferences' },
    ],
    illustration: 'preferences',
  },
  {
    title: 'Economic Calendar & News',
    description: 'Stay ahead of market-moving events with our comprehensive economic calendar and curated news feed from trusted sources worldwide.',
    icon: Calendar,
    features: [
      { icon: Calendar, text: 'Economic events calendar' },
      { icon: Newspaper, text: 'Curated market news' },
      { icon: Bell, text: 'Event reminders' },
    ],
    illustration: 'calendar',
  },
  {
    title: 'Performance Tracking',
    description: 'Monitor your trading performance with detailed analytics, win/loss ratios, profit factors, and visual charts to identify your strengths and areas for improvement.',
    icon: BarChart3,
    features: [
      { icon: BarChart3, text: 'Detailed analytics' },
      { icon: TrendingUp, text: 'Win rate tracking' },
      { icon: Eye, text: 'Trade journal' },
    ],
    illustration: 'performance',
  },
  {
    title: 'Subscriptions & Referrals',
    description: 'Unlock premium features with Pro or Premium plans. Earn rewards by referring friends — get free months and exclusive perks for every successful referral.',
    icon: CreditCard,
    features: [
      { icon: CreditCard, text: 'Flexible plans' },
      { icon: Users, text: 'Referral rewards' },
      { icon: Zap, text: 'Premium signals' },
    ],
    illustration: 'subscription',
  },
]

function StepIllustration({ type, isActive }: { type: string; isActive: boolean }) {
  const baseClass = "flex size-40 items-center justify-center rounded-2xl mx-auto"

  const illustrations: Record<string, React.ReactNode> = {
    welcome: (
      <div className={`${baseClass} bg-primary/10`}>
        <BrandLogo className="size-20" rounded="rounded-xl" />
      </div>
    ),
    signals: (
      <div className={`${baseClass} bg-primary/10`}>
        <TrendingUp className="size-16 text-primary" />
      </div>
    ),
    screenshot: (
      <div className={`${baseClass} bg-primary/10`}>
        <Camera className="size-16 text-primary" />
      </div>
    ),
    preferences: (
      <div className={`${baseClass} bg-primary/10`}>
        <Settings className="size-16 text-primary" />
      </div>
    ),
    calendar: (
      <div className={`${baseClass} bg-primary/10`}>
        <Calendar className="size-16 text-primary" />
      </div>
    ),
    performance: (
      <div className={`${baseClass} bg-primary/10`}>
        <BarChart3 className="size-16 text-primary" />
      </div>
    ),
    subscription: (
      <div className={`${baseClass} bg-primary/10`}>
        <CreditCard className="size-16 text-primary" />
      </div>
    ),
  }

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {illustrations[type]}
    </motion.div>
  )
}

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(0)
  const updateUser = useStore((s) => s.updateUser)
  const setPage = useStore((s) => s.setPage)
  const user = useStore((s) => s.user)
  const [isCompleting, setIsCompleting] = useState(false)

  const step = steps[currentStep]
  const progress = ((currentStep + 1) / steps.length) * 100

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleComplete()
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSkip = () => {
    handleComplete()
  }

  const handleComplete = async () => {
    setIsCompleting(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useStore.getState().authToken}`,
        },
        body: JSON.stringify({
          onboardingCompleted: true,
          onboardingStep: steps.length,
        }),
      })

      if (!res.ok) {
        toast.warning('Settings may not have saved to the server — you can retry later in Settings.')
      }

      updateUser({ onboardingCompleted: true, onboardingStep: steps.length })
      setPage('dashboard')
      toast.success('You\'re all set! Welcome to TOPTIER!')
    } catch {
      toast.warning('Could not reach the server — onboarding completed locally. Your preferences will sync next time.')
      updateUser({ onboardingCompleted: true, onboardingStep: steps.length })
      setPage('dashboard')
    } finally {
      setIsCompleting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {steps.length}
            </span>
            <span className="text-sm text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step Content */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
          <CardContent className="p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {/* Illustration */}
                <StepIllustration type={step.illustration} isActive={true} />

                {/* Title & Description */}
                <div className="text-center space-y-3">
                  <h2 className="text-2xl font-bold">{step.title}</h2>
                  <p className="text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>

                {/* Feature Pills */}
                {step.features && (
                  <div className="flex flex-wrap justify-center gap-3">
                    {step.features.map((feature, i) => {
                      const FeatureIcon = feature.icon
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.1, duration: 0.3 }}
                          className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary"
                        >
                          <FeatureIcon className="size-4" />
                          {feature.text}
                        </motion.div>
                      )
                    })}
                  </div>
                )}

                {/* Completion step */}
                {currentStep === steps.length - 1 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-center"
                  >
                    <p className="text-sm text-primary font-medium">
                      You&apos;re ready to start your trading journey!
                    </p>
                  </motion.div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="mt-8 flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={currentStep === 0}
                className="gap-1"
              >
                <ChevronLeft className="size-4" />
                Back
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  disabled={isCompleting}
                  className="text-muted-foreground gap-1"
                >
                  <SkipForward className="size-3.5" />
                  Skip
                </Button>

                <Button
                  onClick={handleNext}
                  disabled={isCompleting}
                  className="gap-1"
                >
                  {isCompleting ? (
                    <>Completing...</>
                  ) : currentStep === steps.length - 1 ? (
                    <>
                      Get Started
                      <Check className="size-4" />
                    </>
                  ) : (
                    <>
                      Next
                      <ChevronRight className="size-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Step Dots */}
            <div className="mt-6 flex justify-center gap-2">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  className={cn(
                    'h-2 rounded-full transition-all duration-300',
                    i === currentStep
                      ? 'w-8 bg-primary'
                      : i < currentStep
                      ? 'w-2 bg-primary/50'
                      : 'w-2 bg-muted-foreground/30'
                  )}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


