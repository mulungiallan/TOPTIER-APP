'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  BookOpen,
  Search,
  Clock,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Video,
  HelpCircle,
  FileText,
  Trophy,
  RotateCcw,
  ArrowRight,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

// ─── Types (mirror of the /education API content) ───────────────────────────

interface GuideSection {
  id: string
  title: string
  content: string
}

interface EducationGuide {
  id: string
  type: string
  title: string
  description: string
  category: string
  difficulty: string
  estimatedMinutes: number
  sections: GuideSection[]
  completed: boolean
  score: number | null
}

interface GlossaryTerm {
  term: string
  definition: string
  example?: string
  related?: string[]
}

interface EducationGlossary {
  id: string
  type: string
  title: string
  description: string
  terms: GlossaryTerm[]
  completed: boolean
}

interface QuizQuestion {
  question: string
  options: string[]
  correct: number
}

interface EducationQuiz {
  id: string
  type: string
  title: string
  description: string
  questions: QuizQuestion[]
  completed: boolean
  score: number | null
}

interface EducationContent {
  id: string
  type: string
  title: string
  description: string
  estimatedMinutes: number
  completed: boolean
  score: number | null
  sections?: GuideSection[]
  terms?: GlossaryTerm[]
  questions?: QuizQuestion[]
}

// --- Quiz Component ---

function QuizPlayer({ quiz, onClose }: { quiz: EducationQuiz; onClose: () => void }) {
  const [currentQ, setCurrentQ] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [showResults, setShowResults] = useState(false)

  const question = quiz.questions[currentQ]
  const totalQuestions = quiz.questions.length

  if (showResults) {
    const correctCount = answers.filter((a, i) => a === quiz.questions[i].correct).length
    const percentage = Math.round((correctCount / totalQuestions) * 100)

    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <Trophy className="h-16 w-16 mx-auto text-amber-500" />
          <h3 className="text-2xl font-bold">Quiz Complete!</h3>
          <p className="text-muted-foreground">{quiz.title}</p>
        </div>
        <div className="text-center space-y-2">
          <p className="text-4xl font-bold">{percentage}%</p>
          <p className="text-sm text-muted-foreground">{correctCount} out of {totalQuestions} correct</p>
          <Badge variant={percentage >= 70 ? 'default' : 'destructive'} className="text-sm">
            {percentage >= 70 ? 'Passed!' : 'Keep Practicing'}
          </Badge>
        </div>
        <div className="space-y-2">
          {quiz.questions.map((q, i) => (
            <div key={i} className={`rounded-lg p-3 text-sm ${answers[i] === q.correct ? 'bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800'}`}>
              <p className="font-medium">Q{i + 1}: {q.question}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your answer: {q.options[answers[i]]} {answers[i] === q.correct ? '✓' : `→ Correct: ${q.options[q.correct]}`}
              </p>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => { setCurrentQ(0); setSelectedAnswer(null); setAnswers([]); setShowResults(false) }}>
            <RotateCcw className="h-4 w-4 mr-2" /> Retry
          </Button>
          <Button className="flex-1" onClick={() => {
            // Save quiz score to API
            const correctCount = answers.filter((a, i) => a === quiz.questions[i].correct).length
            const percentage = Math.round((correctCount / quiz.questions.length) * 100)
            api.post('/education', { contentId: quiz.id, contentType: 'quiz', completed: true, score: percentage }).catch(() => {})
            onClose()
          }}>Done</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Question {currentQ + 1} of {totalQuestions}</span>
          <Badge variant="outline">{quiz.title}</Badge>
        </div>
        <Progress value={((currentQ + 1) / totalQuestions) * 100} />
      </div>
      <h3 className="text-lg font-semibold">{question.question}</h3>
      <div className="space-y-2">
        {question.options.map((option, i) => (
          <button
            key={i}
            onClick={() => setSelectedAnswer(i)}
            className={`w-full text-left p-3 rounded-lg border transition-colors text-sm ${
              selectedAnswer === i
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border hover:border-primary/50 hover:bg-muted/50'
            }`}
          >
            <span className="font-medium mr-2">{String.fromCharCode(65 + i)}.</span>
            {option}
          </button>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          disabled={selectedAnswer === null}
          onClick={() => {
            const newAnswers = [...answers, selectedAnswer!]
            setAnswers(newAnswers)
            if (currentQ < totalQuestions - 1) {
              setCurrentQ(currentQ + 1)
              setSelectedAnswer(null)
            } else {
              setShowResults(true)
            }
          }}
        >
          {currentQ < totalQuestions - 1 ? (
            <>Next <ArrowRight className="h-4 w-4 ml-1" /></>
          ) : (
            'Finish Quiz'
          )}
        </Button>
      </div>
    </div>
  )
}

// --- Guide Reader Component ---

function GuideReader({ guide, onClose }: { guide: EducationGuide; onClose: () => void }) {
  const [currentSection, setCurrentSection] = useState(0)
  const [completedSections, setCompletedSections] = useState<Set<string>>(new Set())
  const totalSections = guide.sections.length
  const progress = Math.round((completedSections.size / totalSections) * 100)

  const section = guide.sections[currentSection]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{guide.title}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>Progress: {progress}%</span>
          <span className="text-muted-foreground">Section {currentSection + 1} of {totalSections}</span>
        </div>
        <Progress value={progress} />
      </div>
      <div className="flex gap-2 text-xs">
        {guide.sections.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setCurrentSection(i)}
            className={`px-2 py-1 rounded border transition-colors ${
              i === currentSection
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : completedSections.has(s.id)
                  ? 'border-green-300 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'
                  : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {completedSections.has(s.id) ? '✓ ' : ''}{i + 1}
          </button>
        ))}
      </div>
      <Separator />
      <div>
        <h4 className="font-semibold text-base mb-3">{section.title}</h4>
        <p className="text-sm leading-relaxed">{section.content}</p>
      </div>
      <div className="flex gap-3 pt-2">
        {currentSection > 0 && (
          <Button variant="outline" onClick={() => setCurrentSection(currentSection - 1)}>
            Previous
          </Button>
        )}
        {!completedSections.has(section.id) && (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              const newCompleted = new Set(completedSections)
              newCompleted.add(section.id)
              setCompletedSections(newCompleted)
              toast.success('Section marked as complete!')
            }}
          >
            <CheckCircle2 className="h-4 w-4" /> Mark as Complete
          </Button>
        )}
        {currentSection < totalSections - 1 && (
          <Button
            className="ml-auto gap-2"
            onClick={() => setCurrentSection(currentSection + 1)}
          >
            Next Section <ChevronRight className="h-4 w-4" />
          </Button>
        )}
        {currentSection === totalSections - 1 && completedSections.size === totalSections && (
          <Button className="ml-auto gap-2" onClick={() => {
            // Save guide as completed to API
            api.post('/education', { contentId: guide.id, contentType: 'guide', completed: true }).catch(() => {})
            onClose()
          }}>
            <CheckCircle2 className="h-4 w-4" /> Guide Complete!
          </Button>
        )}
      </div>
    </div>
  )
}

// --- Main Component ---

export default function EducationPage() {
  const [activeTab, setActiveTab] = useState('guides')
  const [glossarySearch, setGlossarySearch] = useState('')
  const [activeLetter, setActiveLetter] = useState<string | null>(null)
  const [openGuideId, setOpenGuideId] = useState<string | null>(null)
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null)
  const [quizScores, setQuizScores] = useState<Record<string, number | null>>({})
  const [content, setContent] = useState<EducationContent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEducationData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const result = await api.get<{ data: { content: EducationContent[] } }>('/education', { signal })
      if (signal?.aborted) return
      const data = result.data
      if (data?.content) {
        setContent(data.content)
        const scores: Record<string, number | null> = {}
        data.content.forEach((item) => {
          if (item.type === 'quiz' && item.score != null) {
            scores[item.id] = item.score
          }
        })
        setQuizScores(prev => ({ ...prev, ...scores }))
      }
    } catch (err: unknown) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Failed to load education content')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchEducationData(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchEducationData])

  const guides = useMemo(() => content.filter((c) => c.type === 'guide') as EducationGuide[], [content])
  const glossaryTerms = useMemo(
    () => content.filter((c) => c.type === 'glossary').flatMap((g) => (g as EducationGlossary).terms || []),
    [content]
  )
  const quizzes = useMemo(() => content.filter((c) => c.type === 'quiz') as EducationQuiz[], [content])

  const filteredGlossary = useMemo(() => {
    let terms = glossaryTerms
    if (glossarySearch) {
      const search = glossarySearch.toLowerCase()
      terms = terms.filter(
        (t) =>
          t.term.toLowerCase().includes(search) ||
          t.definition.toLowerCase().includes(search)
      )
    }
    if (activeLetter) {
      terms = terms.filter((t) => t.term.startsWith(activeLetter))
    }
    return terms
  }, [glossarySearch, activeLetter, glossaryTerms])

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const availableLetters = new Set(glossaryTerms.map((t) => t.term[0]))

  const openGuide = guides.find((g) => g.id === openGuideId)
  const activeQuiz = quizzes.find((q) => q.id === activeQuizId)

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <GraduationCap className="h-7 w-7" />
          Learn
        </h1>
        <p className="text-sm text-muted-foreground">Expand your trading knowledge with guides, glossary, videos, and quizzes</p>
      </div>

      {/* Quiz / Guide Dialog */}
      {openGuide && (
        <Dialog open={!!openGuideId} onOpenChange={(open) => !open && setOpenGuideId(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
            <GuideReader guide={openGuide} onClose={() => setOpenGuideId(null)} />
          </DialogContent>
        </Dialog>
      )}

      {activeQuiz && (
        <Dialog open={!!activeQuizId} onOpenChange={(open) => !open && setActiveQuizId(null)}>
          <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
            <QuizPlayer quiz={activeQuiz} onClose={() => setActiveQuizId(null)} />
          </DialogContent>
        </Dialog>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="guides" className="gap-1.5">
            <BookOpen className="h-4 w-4 hidden sm:block" /> Guides
          </TabsTrigger>
          <TabsTrigger value="glossary" className="gap-1.5">
            <FileText className="h-4 w-4 hidden sm:block" /> Glossary
          </TabsTrigger>
          <TabsTrigger value="videos" className="gap-1.5">
            <Video className="h-4 w-4 hidden sm:block" /> Videos
          </TabsTrigger>
          <TabsTrigger value="quizzes" className="gap-1.5">
            <HelpCircle className="h-4 w-4 hidden sm:block" /> Quizzes
          </TabsTrigger>
        </TabsList>

        {/* Guides Tab */}
        <TabsContent value="guides" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="font-medium">Failed to load education content</p>
              <p className="text-sm mt-1">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchEducationData()}>Retry</Button>
            </div>
          ) : guides.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No guides yet</p>
              <p className="text-sm">Guides are being added. Check back soon.</p>
            </div>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {guides.map((guide) => (
              <Card key={guide.id} className="transition-shadow hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-primary/10 p-2.5">
                      <BookOpen className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-base">{guide.title}</CardTitle>
                      <CardDescription className="text-xs mt-1">{guide.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Progress</span>
                      <span>{guide.completed ? 100 : 0}%</span>
                    </div>
                    <Progress value={guide.completed ? 100 : 0} className="h-2" />
                  </div>
                </CardContent>
                <CardFooter className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {guide.estimatedMinutes} min read
                  </div>
                  <Button size="sm" onClick={() => setOpenGuideId(guide.id)}>
                    {guide.completed ? (
                      <><CheckCircle2 className="h-4 w-4 mr-1" /> Review</>
                    ) : (
                      <>Start <ChevronRight className="h-4 w-4 ml-1" /></>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
          )}
        </TabsContent>

        {/* Glossary Tab */}
        <TabsContent value="glossary" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : glossaryTerms.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No glossary terms yet</p>
            </div>
          ) : (
          <div className="flex flex-col sm:flex-row gap-4">
            {/* A-Z Navigation */}
            <div className="flex sm:flex-col gap-1 overflow-x-auto sm:overflow-x-visible sm:shrink-0 pb-1 sm:pb-0">
              <Button
                variant={activeLetter === null ? 'default' : 'ghost'}
                size="sm"
                className="h-8 w-8 p-0 shrink-0"
                onClick={() => setActiveLetter(null)}
              >
                All
              </Button>
              {alphabet.map((letter) => (
                <Button
                  key={letter}
                  variant={activeLetter === letter ? 'default' : 'ghost'}
                  size="sm"
                  className={`h-8 w-8 p-0 shrink-0 ${!availableLetters.has(letter) ? 'opacity-30 cursor-not-allowed' : ''}`}
                  disabled={!availableLetters.has(letter)}
                  onClick={() => setActiveLetter(activeLetter === letter ? null : letter)}
                >
                  {letter}
                </Button>
              ))}
            </div>

            {/* Glossary Content */}
            <div className="flex-1 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search terms..."
                  value={glossarySearch}
                  onChange={(e) => setGlossarySearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ScrollArea className="max-h-[600px]">
                <div className="space-y-3">
                  {filteredGlossary.map((entry) => (
                    <Card key={entry.term}>
                      <CardContent className="p-4">
                        <h4 className="font-bold text-sm">{entry.term}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{entry.definition}</p>
                        {entry.example && (
                          <p className="text-xs mt-2 bg-muted/50 rounded p-2 italic">
                            Example: {entry.example}
                          </p>
                        )}
                        {entry.related && entry.related.length > 0 && (
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">Related:</span>
                            {entry.related.map((rel) => (
                              <Badge key={rel} variant="outline" className="text-xs cursor-pointer hover:bg-muted">
                                {rel}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  {filteredGlossary.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p className="font-medium">No terms found</p>
                      <p className="text-sm">Try adjusting your search or filter</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
          )}
        </TabsContent>

        {/* Videos Tab */}
        <TabsContent value="videos" className="mt-4">
          <div className="text-center py-12 text-muted-foreground">
            <Video className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No video lessons yet</p>
            <p className="text-sm">Video content is being prepared and will appear here when available.</p>
          </div>
        </TabsContent>

        {/* Quizzes Tab */}
        <TabsContent value="quizzes" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : quizzes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <HelpCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No quizzes yet</p>
            </div>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {quizzes.map((quiz) => (
              <Card key={quiz.id} className="transition-shadow hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-amber-500/10 p-2.5">
                      <HelpCircle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{quiz.title}</CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {quiz.questions.length} questions
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Best score: {quizScores[quiz.id] != null ? `${quizScores[quiz.id]}%` : 'Not attempted'}
                    </span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => setActiveQuizId(quiz.id)}
                  >
                    {quizScores[quiz.id] != null ? (
                      <><RotateCcw className="h-4 w-4 mr-1" /> Retry Quiz</>
                    ) : (
                      <><HelpCircle className="h-4 w-4 mr-1" /> Take Quiz</>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
