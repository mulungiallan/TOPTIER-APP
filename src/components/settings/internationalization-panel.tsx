'use client'

import React, { useState, useEffect } from 'react'
import { Globe, Languages, DollarSign, Tag, Loader2, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { locales, localeList, detectUserLocale } from '@/lib/i18n/config'
import { currencies, currencyList, formatCurrency, getLocalizedPrice } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export function InternationalizationPanel() {
  const locale = useStore((s) => s.locale)
  const setLocale = useStore((s) => s.setLocale)
  const user = useStore((s) => s.user)
  const [selectedLocale, setSelectedLocale] = useState<string>('en')
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD')
  const [userCountry, setUserCountry] = useState<string>('US')
  const [saving, setSaving] = useState(false)
  const [previewPrice] = useState(29.99)

  useEffect(() => {
    const initial = user?.language || locale || detectUserLocale()
    setSelectedLocale(initial)
    if (locales[initial]) {
      setSelectedCurrency(locales[initial].currency)
    }
  }, [locale, user?.language])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.post('/i18n/locale', { locale: selectedLocale })
      setLocale(selectedLocale)
      setSelectedCurrency(locales[selectedLocale]?.currency || 'USD')
      toast.success(`Language set to ${locales[selectedLocale]?.name}`)
    } catch {
      toast.error('Failed to save language preference')
    } finally {
      setSaving(false)
    }
  }

  const localized = getLocalizedPrice(previewPrice, userCountry)

  return (
    <div className="space-y-6">
      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Languages className="h-4 w-4 text-emerald-500" /> Language</CardTitle>
          <CardDescription>Choose your preferred language. The app interface will adapt.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {localeList.map((loc) => (
              <button
                key={loc.code}
                onClick={() => setSelectedLocale(loc.code)}
                className={cn(
                  'p-3 rounded-lg border text-left transition',
                  selectedLocale === loc.code ? 'border-emerald-500 bg-emerald-500/5' : 'hover:bg-accent'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{loc.flag}</span>
                  {selectedLocale === loc.code && <Check className="h-4 w-4 text-emerald-500" />}
                </div>
                <div className="text-sm font-medium mt-1">{loc.name}</div>
                <div className="text-xs text-muted-foreground">{loc.nativeName}</div>
                {loc.direction === 'rtl' && (
                  <Badge variant="outline" className="text-[9px] mt-1">RTL</Badge>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Currency */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><DollarSign className="h-4 w-4 text-emerald-500" /> Display Currency</CardTitle>
          <CardDescription>All prices will be converted and displayed in your chosen currency.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label>Currency</Label>
              <select
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm"
              >
                {currencyList.map((c) => (
                  <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 p-3 rounded-md bg-muted/50 text-sm">
            <div className="text-xs text-muted-foreground mb-1">Preview ($29.99 USD):</div>
            <div className="font-semibold text-lg">{formatCurrency(previewPrice, selectedCurrency)}</div>
            <div className="text-xs text-muted-foreground">
              Rate: 1 USD = {(currencies[selectedCurrency]?.rate || 1).toLocaleString()} {selectedCurrency}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Localized Pricing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Tag className="h-4 w-4 text-emerald-500" /> Localized Pricing (PPP)</CardTitle>
          <CardDescription>Regional pricing based on Purchasing Power Parity. Enter your country to see applicable discounts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Country</Label>
            <Input value={userCountry} onChange={(e) => setUserCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="e.g. KE, NG, IN..." maxLength={2} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-md border bg-card/50">
              <div className="text-xs text-muted-foreground">Original Price (USD)</div>
              <div className="text-xl font-bold tabular-nums">${previewPrice.toFixed(2)}</div>
            </div>
            <div className="p-3 rounded-md border bg-card/50">
              <div className="text-xs text-muted-foreground">Your Price ({localized.currency})</div>
              <div className="text-xl font-bold tabular-nums text-emerald-500">{localized.formatted}</div>
              {localized.discountPct > 0 && (
                <Badge className="text-[9px] mt-1 bg-emerald-500">{localized.discountPct}% off</Badge>
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            <Globe className="h-3 w-3 inline mr-1" />
            {localized.reason}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
          Save Preferences
        </Button>
      </div>
    </div>
  )
}

export default InternationalizationPanel
