'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  Camera,
  X,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Save,
  RotateCcw,
  Trash2,
  Clock,
  BarChart3,
  Target,
  Shield,
  Zap,
  Lock,
  Crown,
  CheckCircle2,
  ImageIcon,
  Crop,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { AdFlow } from '@/components/ads'
import { adService, type AdStepPhase } from '@/lib/services/ad-service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AnalysisResult {
  id: string
  signalType: 'BUY' | 'SELL' | 'NEUTRAL'
  entryPrice: number | null
  stopLoss: number | null
  takeProfit1: number | null
  takeProfit2: number | null
  takeProfit3: number | null
  confidence: number
  timeframe: string
  detectedAsset: string
  pattern: string
  explanation: string
  imageUrl: string
  createdAt: Date
}

const FREE_ANALYSIS_LIMIT = 2

// ─── Signal Badge Component ────────────────────────────────────────────────────

function SignalBadge({ type, size = 'md' }: { type: 'BUY' | 'SELL' | 'NEUTRAL'; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-5 py-2 text-lg font-bold',
  }

  const colorClasses = {
    BUY: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    SELL: 'bg-red-500/15 text-red-500 border-red-500/30',
    NEUTRAL: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30',
  }

  const Icon = type === 'BUY' ? TrendingUp : type === 'SELL' ? TrendingDown : Minus

  return (
    <Badge className={cn('border font-semibold gap-1.5', sizeClasses[size], colorClasses[type])}>
      <Icon className={size === 'lg' ? 'size-5' : 'size-3.5'} />
      {type}
    </Badge>
  )
}

// ─── Confidence Meter ──────────────────────────────────────────────────────────

function ConfidenceMeter({ value }: { value: number }) {
  const getColor = (v: number) => {
    if (v >= 75) return 'text-emerald-500'
    if (v >= 50) return 'text-yellow-500'
    return 'text-red-500'
  }

  const getProgressColor = (v: number) => {
    if (v >= 75) return '[&>div]:bg-emerald-500'
    if (v >= 50) return '[&>div]:bg-yellow-500'
    return '[&>div]:bg-red-500'
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Confidence</span>
        <span className={cn('text-3xl font-bold', getColor(value))}>{value}%</span>
      </div>
      <Progress value={value} className={cn('h-2', getProgressColor(value))} />
    </div>
  )
}

// ─── Paywall Component ─────────────────────────────────────────────────────────

function Paywall({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md"
    >
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="p-8 text-center space-y-6">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Lock className="size-8 text-primary" />
          </div>
          <div>
            <h3 className="text-xl font-bold">You&apos;ve used all {FREE_ANALYSIS_LIMIT} free analyses</h3>
            <p className="text-muted-foreground mt-2">
              Upgrade to Premium for unlimited AI-powered chart analysis and unlock all features.
            </p>
          </div>

          <div className="space-y-3 text-left">
            {[
              'Unlimited screenshot analyses',
              'Real-time trading signals',
              'Advanced pattern recognition',
              'Priority AI processing',
              'Watchlist with real-time prices',
              'Performance analytics',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <CheckCircle2 className="size-4 text-primary shrink-0" />
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>

          <Button size="lg" className="w-full gap-2" onClick={onUpgrade}>
            <Crown className="size-4" />
            Upgrade Now
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Analysis Result Card ──────────────────────────────────────────────────────

function AnalysisResultCard({
  result,
  onSave,
  onAnalyzeAnother,
}: {
  result: AnalysisResult
  onSave: () => void
  onAnalyzeAnother: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="overflow-hidden border-primary/20">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Analysis Result</CardTitle>
            <SignalBadge type={result.signalType} size="lg" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Confidence */}
          <ConfidenceMeter value={result.confidence} />

          {/* Key Levels */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                  <Target className="size-3.5" />
                  <span className="text-xs">Entry Price</span>
                </div>
                <p className="text-lg font-bold">{result.entryPrice ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <div className="flex items-center gap-1.5 text-red-500 mb-1">
                  <Shield className="size-3.5" />
                  <span className="text-xs">Stop Loss</span>
                </div>
                <p className="text-lg font-bold text-red-500">{result.stopLoss ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-1.5 text-emerald-500 mb-1">
                  <TrendingUp className="size-3.5" />
                  <span className="text-xs">Take Profit 1</span>
                </div>
                <p className="text-lg font-bold text-emerald-500">{result.takeProfit1 ?? '—'}</p>
              </div>
              {result.takeProfit2 != null && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-1.5 text-emerald-500 mb-1">
                    <TrendingUp className="size-3.5" />
                    <span className="text-xs">Take Profit 2</span>
                  </div>
                  <p className="text-lg font-bold text-emerald-500">{result.takeProfit2}</p>
                </div>
              )}
              {result.takeProfit3 != null && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-1.5 text-emerald-500 mb-1">
                    <TrendingUp className="size-3.5" />
                    <span className="text-xs">Take Profit 3</span>
                  </div>
                  <p className="text-lg font-bold text-emerald-500">{result.takeProfit3}</p>
                </div>
              )}
          </div>

          {/* Detected Info */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1">
              <Clock className="size-3" />
              {result.timeframe}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <BarChart3 className="size-3" />
              {result.detectedAsset}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Zap className="size-3" />
              {result.pattern}
            </Badge>
          </div>

          {/* Explanation */}
          <div className="space-y-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {expanded ? 'Hide' : 'Show'} Full Analysis
              {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                    {result.explanation}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex gap-3">
            <Button className="flex-1 gap-2" onClick={onSave}>
              <Save className="size-4" />
              Save to History
            </Button>
            <Button variant="outline" className="flex-1 gap-2" onClick={onAnalyzeAnother}>
              <RotateCcw className="size-4" />
              Analyze Another
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── History Item Component ────────────────────────────────────────────────────

function HistoryItem({
  item,
  onDelete,
}: {
  item: AnalysisResult
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors">
      {/* Thumbnail placeholder */}
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
        <ImageIcon className="size-5 text-muted-foreground" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <SignalBadge type={item.signalType} size="sm" />
          <span className="font-medium text-sm truncate">{item.detectedAsset}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>{item.confidence}% confidence</span>
          <span>{item.timeframe}</span>
          <span>{item.pattern}</span>
        </div>
      </div>

      {/* Date & Delete */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-xs text-muted-foreground">
          {item.createdAt.toLocaleDateString()} {item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(item.id)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ─── Camera Capture Dialog ──────────────────────────────────────────────────────

function CameraCaptureDialog({ open, onClose, onCapture }: {
  open: boolean
  onClose: () => void
  onCapture: (file: File) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      return
    }
    let cancelled = false

    const start = async () => {
      setCameraError(null)
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera is not supported on this device/browser (needs HTTPS or localhost).')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      } catch {
        setCameraError('Unable to access camera. Please allow camera permission or use file upload instead.')
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [open])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      onCapture(new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' }))
      onClose()
    }, 'image/png')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Take a Photo</DialogTitle>
          <DialogDescription>Capture a chart screenshot with your camera</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
          {cameraError ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {cameraError}
            </div>
          ) : (
            <video ref={videoRef} className="h-full w-full object-contain" playsInline muted autoPlay />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="gap-2" onClick={capture} disabled={!!cameraError}>
            <Camera className="size-4" /> Capture
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Crop Tool Dialog ───────────────────────────────────────────────────────────

interface CropRect { x: number; y: number; w: number; h: number }

function CropDialog({ imageUrl, fileName, onClose, onCrop }: {
  imageUrl: string | null
  fileName: string
  onClose: () => void
  onCrop: (file: File) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [rect, setRect] = useState<CropRect | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)

  const getPos = (e: React.PointerEvent) => {
    const img = imgRef.current
    if (!img) return { x: 0, y: 0 }
    const b = img.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const p = getPos(e)
    setDragStart(p)
    setRect({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onMove = (e: React.PointerEvent) => {
    if (!dragStart) return
    const p = getPos(e)
    setRect({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    })
  }

  const onUp = () => setDragStart(null)

  const apply = () => {
    const img = imgRef.current
    if (!img || !rect || rect.w < 4 || rect.h < 4) {
      toast.error('Drag a selection box over the image first')
      return
    }
    const display = img.getBoundingClientRect()
    const scaleX = img.naturalWidth / display.width
    const scaleY = img.naturalHeight / display.height
    const sx = rect.x * scaleX
    const sy = rect.y * scaleY
    const sw = rect.w * scaleX
    const sh = rect.h * scaleY
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw))
    canvas.height = Math.max(1, Math.round(sh))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    const isPng = fileName.toLowerCase().endsWith('.png')
    canvas.toBlob((blob) => {
      if (!blob) return
      onCrop(new File([blob], fileName, { type: isPng ? 'image/png' : 'image/jpeg' }))
      onClose()
    }, isPng ? 'image/png' : 'image/jpeg', 0.92)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crop Image</DialogTitle>
          <DialogDescription>Drag on the image to select the area you want to keep</DialogDescription>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-lg bg-muted" style={{ touchAction: 'none' }}>
          {imageUrl && (
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop source"
              draggable={false}
              className="block w-full select-none"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
            />
          )}
          {rect && (
            <div
              className="pointer-events-none absolute border-2 border-primary bg-primary/20"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="gap-2" onClick={apply}>
            <Crop className="size-4" /> Apply Crop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ScreenshotAnalyzer() {
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'
  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory] = useState<AnalysisResult[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [analysisCount, setAnalysisCount] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all')
  const [showAdFlow, setShowAdFlow] = useState(false)
  const [pendingAnalyze, setPendingAnalyze] = useState(false)
  const [adPhase, setAdPhase] = useState<AdStepPhase>('start')
  const [pendingResult, setPendingResult] = useState(false)
  const pendingResultRef = useRef<AnalysisResult | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null)
  const [cropFileName, setCropFileName] = useState('image.png')
  const [pendingCropPick, setPendingCropPick] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const freeAnalysesUsed = analysisCount
  const freeLimitReached = false // analyzer is free & unlimited (ad-supported)

  // Fetch analysis history on mount
  const fetchHistory = useCallback(async () => {
    try {
      setHistoryLoading(true)
      const result = await api.get<{data: {analyses: Array<Record<string, unknown>>; total: number}}>('/screenshots')
      const data = result.data
      if (data?.analyses && Array.isArray(data.analyses) && data.analyses.length > 0) {
        const mappedHistory: AnalysisResult[] = data.analyses.map((a: Record<string, unknown>) => ({
          id: (a.id as string) || '',
          signalType: (a.signalType as 'BUY' | 'SELL' | 'NEUTRAL') || 'NEUTRAL',
          entryPrice: (a.entryPrice as number | null) ?? null,
          stopLoss: (a.stopLoss as number | null) ?? null,
          takeProfit1: (a.takeProfit1 as number | null) ?? null,
          takeProfit2: (a.takeProfit2 as number | null) ?? null,
          takeProfit3: (a.takeProfit3 as number | null) ?? null,
          confidence: (a.confidence as number) || 0,
          timeframe: (a.timeframe as string) || 'Unknown',
          detectedAsset: (a.detectedAsset as string) || 'Unknown',
          pattern: (a.pattern as string) || 'Unknown',
          explanation: (a.explanation as string) || '',
          imageUrl: (a.imageUrl as string) || '',
          createdAt: new Date(a.createdAt as string),
        }))
        setHistory(mappedHistory)
        setAnalysisCount(data.total || mappedHistory.length)
      }
    } catch {
      // Keep empty history on API error — never fabricate canned results.
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Handle file selection
  const handleFileSelect = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf']
    if (!validTypes.includes(file.type)) {
      toast.error('Unsupported format. Please use PNG, JPG, JPEG, PDF, or WEBP.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 10MB.')
      return
    }

    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setAnalysisResult(null)
  }, [])

  // Open the crop dialog for a given file
  const openCropFor = useCallback((file: File) => {
    setCropImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    setCropFileName(file.name)
    setCropOpen(true)
  }, [])

  const closeCrop = useCallback(() => {
    setCropOpen(false)
    setCropImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [])

  const handleCropClick = useCallback(() => {
    if (selectedFile) {
      openCropFor(selectedFile)
    } else {
      setPendingCropPick(true)
      fileInputRef.current?.click()
    }
  }, [selectedFile, openCropFor])

  const handleCropApply = useCallback(
    (file: File) => {
      handleFileSelect(file)
    },
    [handleFileSelect]
  )

  // Drag handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect]
  )

  // Runs the actual chart analysis request.
  const runAnalysis = useCallback(async () => {
    setPendingAnalyze(false)
    setPendingResult(false)
    setIsAnalyzing(true)
    setAnalysisResult(null)

    const mapResult = (d: Record<string, unknown>): AnalysisResult => ({
      id: (d.id as string) || 'api-1',
      signalType: (d.signalType as 'BUY' | 'SELL' | 'NEUTRAL') || 'NEUTRAL',
      entryPrice: (d.entryPrice as number | null) ?? null,
      stopLoss: (d.stopLoss as number | null) ?? null,
      takeProfit1: (d.takeProfit1 as number | null) ?? null,
      takeProfit2: (d.takeProfit2 as number | null) ?? null,
      takeProfit3: (d.takeProfit3 as number | null) ?? null,
      confidence: (d.confidence as number) || 0,
      timeframe: (d.timeframe as string) || 'Unknown',
      detectedAsset: (d.detectedAsset as string) || 'Unknown',
      pattern: (d.pattern as string) || 'Unknown',
      explanation: (d.explanation as string) || '',
      imageUrl: previewUrl || '',
      createdAt: new Date(),
    })

    const fail = async (res: Response) => {
      let message = 'Chart analysis failed. Please try again.'
      try {
        const body = await res.json()
        if (body?.error) message = body.error
      } catch {
        // keep default message
      }
      setIsAnalyzing(false)
      toast.error(message)
    }

    if (!selectedFile) {
      setIsAnalyzing(false)
      toast.error('Please upload a chart screenshot first.')
      return
    }

    const formData = new FormData()
    formData.append('image', selectedFile)

    // Get auth token for the request
    let token: string | null = null
    try {
      const stored = localStorage.getItem('toptier-store')
      if (stored) {
        const parsed = JSON.parse(stored)
        token = parsed?.state?.authToken || null
      }
    } catch {
      // ignore
    }

    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    try {
      const response = await fetch('/api/chart/analyze', {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!response.ok) {
        await fail(response)
        return
      }

      const responseData = await response.json()
      if (!responseData?.data) {
        setIsAnalyzing(false)
        toast.error('Chart analysis returned an empty result. Please try again.')
        return
      }

      // New endpoint returns nested { analysis, result, quota, provider }
      const d = responseData.data.analysis || responseData.data
      const result = mapResult(d)
      pendingResultRef.current = result
      setAnalysisCount((c) => c + 1)
      setIsAnalyzing(false)

      const providerInfo = responseData.data.provider
      const quotaInfo = responseData.data.quota
      const method = providerInfo?.method as string | undefined
      if (method?.includes('Heuristic') || method?.includes('Fallback')) {
        toast.warning(
          'AI analysis services are temporarily unavailable. This result is NOT a real analysis.'
        )
      } else {
        const costMsg = providerInfo?.cost === '$0.00' ? 'Free analysis' : `Cost ${providerInfo?.cost}`
        const cachedMsg = providerInfo?.cached ? ' (cached)' : ''
        const remainingMsg = quotaInfo && quotaInfo.remaining !== null
          ? ` · ${quotaInfo.remaining} left today`
          : ''
        toast.success(`Chart analyzed! ${costMsg}${cachedMsg}${remainingMsg}`)
      }
      fetchHistory()
      // Users watch the "results" phase ads before the result is revealed.
      setAdPhase('results')
      setShowAdFlow(true)
      setPendingResult(true)
      pendingResultRef.current = result
    } catch {
      // Network/parse error — never fabricate a result.
      setIsAnalyzing(false)
      toast.error('Chart analysis failed. Please try again.')
    }
  }, [selectedFile, previewUrl, fetchHistory])

  // All users are served the rewarded AdFlow (ad-supported premium experience).
  // Ads are reduced from 10 to 5 for users who referred >= 20 downloads.
  const handleAnalyze = useCallback(async () => {
    if (freeLimitReached) return
    if (showAdFlow || pendingAnalyze || pendingResult) return
    adService.setReducedAds(user?.id || 'guest', (user?.referralCount ?? 0) >= 20)
    adService.resetForNewAnalysis(user?.id || 'guest')
    setAdPhase('start')
    setShowAdFlow(true)
    setPendingAnalyze(true)
  }, [freeLimitReached, showAdFlow, pendingAnalyze, pendingResult, user?.id, user?.referralCount])

  // Save to history
  const handleSave = useCallback(() => {
    if (analysisResult) {
      setHistory((prev) => [analysisResult, ...prev])
      toast.success('Analysis saved to history')
      // Also refresh from API to ensure consistency
      fetchHistory()
    }
  }, [analysisResult, fetchHistory])

  // Analyze another — users first watch the "next" phase ads as the transition
  // into a fresh analysis.
  const handleAnalyzeAnother = useCallback(() => {
    if (!showAdFlow) {
      setAdPhase('next')
      setShowAdFlow(true)
      setPendingAnalyze(true)
      return
    }
    setSelectedFile(null)
    setPreviewUrl(null)
    setAnalysisResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [showAdFlow])

  // Progresses the phased AdFlow once a phase is fully watched.
  const handleAdComplete = useCallback(() => {
    setShowAdFlow(false)
    if (adPhase === 'start') {
      // Start ads done → kick off the analysis, playing the loading ad while it runs.
      setAdPhase('processing')
      setShowAdFlow(true)
      runAnalysis()
    } else if (adPhase === 'processing') {
      // Loading ad done — the analysis request continues in the background.
    } else if (adPhase === 'results') {
      setPendingResult(false)
      setAnalysisResult(pendingResultRef.current)
      pendingResultRef.current = null
    } else if (adPhase === 'next') {
      setPendingAnalyze(false)
      setSelectedFile(null)
      setPreviewUrl(null)
      setAnalysisResult(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [adPhase, runAnalysis])

  const handleAdSkip = useCallback(() => {
    setShowAdFlow(false)
    setPendingAnalyze(false)
    setPendingResult(false)
  }, [])

  const handleAdUpgrade = useCallback(() => {
    setShowAdFlow(false)
    setPendingAnalyze(false)
    setPendingResult(false)
    setPage('subscriptions')
  }, [setPage])

  // Delete from history
  const handleDeleteHistory = useCallback(async (id: string) => {
    // Try API delete first
    try {
      await api.delete(`/screenshots?id=${id}`)
    } catch {
      // API doesn't support delete, just remove locally
    }
    setHistory((prev) => prev.filter((item) => item.id !== id))
    toast.success('Analysis removed from history')
  }, [])

  // Clear all history
  const handleClearHistory = useCallback(() => {
    setHistory([])
    toast.success('History cleared')
  }, [])

  // Filter history by date
  const filteredHistory = history.filter((item) => {
    if (dateFilter === 'all') return true
    const now = new Date()
    const diff = now.getTime() - item.createdAt.getTime()
    const dayMs = 86400000
    if (dateFilter === 'today') return diff < dayMs
    if (dateFilter === 'week') return diff < 7 * dayMs
    if (dateFilter === 'month') return diff < 30 * dayMs
    return true
  })

  // Paywall
  if (freeLimitReached && !analysisResult) {
    return (
      <div className="p-6">
        <Paywall onUpgrade={() => setPage('subscriptions')} />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Analysis Counter */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Screenshot Analyzer</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Upload a chart screenshot for AI-powered analysis
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <Zap className="size-3 text-amber-500" />
          Unlimited · Ad-supported
        </Badge>
      </div>

      {/* Upload Area / Preview / Results */}
      {!analysisResult ? (
        <AnimatePresence mode="wait">
          {!previewUrl ? (
            /* ─── Upload Zone ─────────────────────────────────────── */
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-12 transition-all cursor-pointer',
                  isDragOver
                    ? 'border-primary bg-primary/5 scale-[1.01]'
                    : 'border-border hover:border-primary/50 hover:bg-muted/30'
                )}
              >
                <div className={cn(
                  'flex size-20 items-center justify-center rounded-full transition-colors',
                  isDragOver ? 'bg-primary/10' : 'bg-muted'
                )}>
                  <Upload className={cn('size-10', isDragOver ? 'text-primary' : 'text-muted-foreground')} />
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold">Drop your trading chart screenshot here</p>
                  <p className="text-muted-foreground text-sm mt-1">or click to browse</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                  {['PNG', 'JPG', 'JPEG', 'PDF', 'WEBP'].map((fmt) => (
                    <Badge key={fmt} variant="secondary" className="text-[10px]">{fmt}</Badge>
                  ))}
                  <span className="self-center">•</span>
                  <span>Max 10MB</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.pdf,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      handleFileSelect(file)
                      if (pendingCropPick) {
                        setPendingCropPick(false)
                        openCropFor(file)
                      }
                    }
                  }}
                />
              </div>

              {/* Extra buttons */}
              <div className="flex items-center justify-center gap-3 mt-4">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setCameraOpen(true)}>
                  <Camera className="size-4" />
                  Take Photo
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleCropClick}>
                  <Crop className="size-4" />
                  Crop Tool
                </Button>
              </div>

              <CameraCaptureDialog
                open={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={handleFileSelect}
              />
              {cropOpen && (
                <CropDialog
                  imageUrl={cropImageUrl}
                  fileName={cropFileName}
                  onClose={closeCrop}
                  onCrop={handleCropApply}
                />
              )}
            </motion.div>          ) : (
            /* ─── Preview & Analyze ───────────────────────────────── */
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <Card>
                <CardContent className="p-4">
                  <div className="relative">
                    <img
                      src={previewUrl}
                      alt="Chart preview"
                      className="w-full max-h-80 object-contain rounded-lg bg-muted"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-11 size-8 bg-background/80 backdrop-blur"
                      onClick={handleCropClick}
                      title="Crop image"
                    >
                      <Crop className="size-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 size-8"
                      onClick={handleAnalyzeAnother}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ImageIcon className="size-4" />
                      <span className="truncate max-w-[200px]">{selectedFile?.name}</span>
                      <span>({((selectedFile?.size || 0) / 1024).toFixed(1)} KB)</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {!isAnalyzing ? (
                <Button size="lg" className="w-full gap-2" onClick={handleAnalyze}>
                  <Zap className="size-5" />
                  Analyze Chart
                </Button>
              ) : (
                <Card className="border-primary/20">
                  <CardContent className="p-6">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative">
                        <Loader2 className="size-12 text-primary animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Zap className="size-5 text-primary" />
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-semibold">Analyzing your chart with AI...</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Detecting patterns, support/resistance levels, and signals
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <motion.div
                            key={i}
                            className="size-2 rounded-full bg-primary"
                            animate={{ opacity: [0.3, 1, 0.3] }}
                            transition={{
                              duration: 1,
                              repeat: Infinity,
                              delay: i * 0.2,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        /* ─── Analysis Result ─────────────────────────────────────── */
        <AnalysisResultCard
          result={analysisResult}
          onSave={handleSave}
          onAnalyzeAnother={handleAnalyzeAnother}
        />
      )}

      <Separator />

      {/* ─── Analysis History ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Analysis History</h3>
          <div className="flex items-center gap-2">
            {/* Date filter */}
            <div className="flex gap-1">
              {(['all', 'today', 'week', 'month'] as const).map((filter) => (
                <Button
                  key={filter}
                  variant={dateFilter === filter ? 'default' : 'ghost'}
                  size="sm"
                  className="text-xs h-7 px-2 capitalize"
                  onClick={() => setDateFilter(filter)}
                >
                  {filter === 'all' ? 'All' : filter === 'today' ? 'Today' : filter === 'week' ? '7 Days' : '30 Days'}
                </Button>
              ))}
            </div>

            {history.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-7 gap-1">
                    <Trash2 className="size-3.5" />
                    Clear All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear all history?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all your analysis history. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearHistory}>Clear All</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <ImageIcon className="size-8 text-muted-foreground" />
            </div>
            <p className="mt-4 font-medium">No analyses yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upload a chart screenshot to get started with AI analysis.
            </p>
          </div>
          )
        ) : (
          <ScrollArea className="max-h-96">
            <div className="space-y-2">
              {filteredHistory.map((item) => (
                <HistoryItem key={item.id} item={item} onDelete={handleDeleteHistory} />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* ─── Free Tier Warning ──────────────────────────────────── */}
      {!isPremium && !freeLimitReached && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
          <AlertTriangle className="size-5 text-yellow-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Free tier: {FREE_ANALYSIS_LIMIT - freeAnalysesUsed} analyses remaining</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Watch a short ad to analyze your chart, or upgrade to Premium for ad-free unlimited analyses.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setPage('subscriptions')} className="shrink-0">
            <Crown className="size-3.5 mr-1" />
            Upgrade
          </Button>
        </div>
      )}

      {/* ─── Rewarded AdFlow gate (free users only, phased) ─────────── */}
      {showAdFlow && !isPremium && (
        <AdFlow
          phase={adPhase}
          onComplete={handleAdComplete}
          onSkip={handleAdSkip}
          onUpgrade={handleAdUpgrade}
        />
      )}
    </div>
  )
}
