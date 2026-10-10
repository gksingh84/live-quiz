import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, ArrowRight, BarChart3, BookOpenCheck, Calculator, Check, CheckCircle2, CheckSquare, ChevronDown, ChevronUp, CircleHelp, Clock3, Copy, Download, Eye, FileText, KeyRound, ListChecks, Lock, LogOut, Paperclip, Pencil, PenTool, Plus, Printer, Radio, RefreshCw, RotateCcw, Save, Send, ShieldCheck, Sparkles, Trash2, UploadCloud, UserCheck, Users, UserX, X } from 'lucide-react';

type Mode = 'LIVE' | 'SELF_PACED';
type QuestionType = 'MCQ' | 'FILL_BLANK' | 'TRUE_FALSE' | 'SOLVE';
type Status = 'DRAFT' | 'ACTIVE' | 'CLOSED';
type Option = { id?: string; text: string; isCorrect?: boolean; correct?: boolean };
type Question = { id?: string; prompt: string; marks: number; imageUrl?: string | null; type?: QuestionType; options: Option[] };
type Quiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; showResults: boolean; currentQuestionIndex: number; currentAnswerRevealed: boolean; questions?: Question[]; _count?: { questions: number; attempts: number } };
type Student = { id: string; name: string; passkey?: string | null; active: boolean; _count: { attempts: number } };
type User = { role: 'admin' | 'student'; name?: string; email?: string };
type QuizDraft = { title: string; mode: Mode; hasTimer: boolean; minutes: number; showResults: boolean; questions: Question[] };
const newDraft = (): QuizDraft => ({ title: '', mode: 'LIVE', hasTimer: false, minutes: 20, showResults: true, questions: [emptyQuestion()] });
type StudentQuiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; questionCount: number; totalMarks?: number; attempt: { status: string; deadlineAt: string | null; score: number | null; submittedAt?: string | null } | null };
type ActiveQuiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; showResults: boolean; currentQuestionIndex: number; currentAnswerRevealed: boolean; questionCount?: number; totalMarks?: number; questions: Question[]; attempt: { status: string; deadlineAt: string | null; score: number | null; answers: { questionId: string; optionId: string }[] } | null };
type Result = { id: string; name: string; status: string; submittedAt: string | null; score: number | null; totalMarks: number; answers: { question: string; response: string; correct: boolean; marks: number }[] };
type LiveStats = { answered: number; participants: number; distribution: { optionId: string; count: number }[]; responses: { name: string; optionId: string; text: string }[] };

type WorksheetSubmission = {
  id: string;
  paperId: string;
  studentId: string;
  images: string;
  score: number | null;
  remarks: string | null;
  status: 'SUBMITTED' | 'GRADED';
  submittedAt: string;
  gradedAt: string | null;
  student?: { id: string; name: string };
};

type WorksheetPaper = {
  id: string;
  title: string;
  subject: string | null;
  grade: string | null;
  totalMarks: number;
  content: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
  _count?: { submissions: number };
  submission?: WorksheetSubmission | null;
  submissions?: WorksheetSubmission[];
};

const emptyQuestion = (type: QuestionType = 'MCQ'): Question => {
  if (type === 'TRUE_FALSE') {
    return { prompt: '', marks: 1, type: 'TRUE_FALSE', imageUrl: '', options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }] };
  }
  if (type === 'FILL_BLANK') {
    return { prompt: 'Fill in the blank: ___', marks: 1, type: 'FILL_BLANK', imageUrl: '', options: [{ text: '', isCorrect: true }, { text: '', isCorrect: false }] };
  }
  if (type === 'SOLVE') {
    return { prompt: 'Solve: ', marks: 2, type: 'SOLVE', imageUrl: '', options: [{ text: '', isCorrect: true }, { text: '', isCorrect: false }] };
  }
  return { prompt: '', marks: 1, type: 'MCQ', imageUrl: '', options: [{ text: '', isCorrect: true }, { text: '', isCorrect: false }] };
};


function printHtmlContent(content: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title></title><style>
    @page {
      margin: 0;
      size: auto;
    }
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body {
        padding: 15mm 18mm !important;
        box-sizing: border-box !important;
      }
    }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      padding: 15mm 18mm;
      margin: 0;
      background: #ffffff;
    }
    ul { list-style-type: disc !important; padding-left: 20px !important; margin: 12px 0 !important; }
    ol { list-style-type: decimal !important; margin: 12px 0 !important; padding-left: 20px !important; }
    li { margin-bottom: 6px !important; }
    p { margin: 0 0 8px 0; }
    h1, h2, h3 { margin: 14px 0 8px 0; color: #0f172a; }
    img { max-width: 100% !important; height: auto !important; margin: 14px auto; display: block; border-radius: 4px; }
  </style></head><body>${content}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 250);
}

function QuestionTypeBadge({ type }: { type?: string }) {
  if (type === 'TRUE_FALSE') return <span className="q-type-badge badge-tf"><CheckCircle2 size={13} /> True / False</span>;
  if (type === 'FILL_BLANK') return <span className="q-type-badge badge-fb"><PenTool size={13} /> Fill in Blanks</span>;
  if (type === 'SOLVE') return <span className="q-type-badge badge-solve"><Calculator size={13} /> Problem Solving</span>;
  return <span className="q-type-badge badge-mcq"><ListChecks size={13} /> Multiple Choice</span>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data as T;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'admin' | 'student'>('student');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api<{ user: User }>('/api/auth/me').then((result) => setUser(result.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  async function signIn(values: { email?: string; password?: string; passkey?: string }) {
    setError('');
    try {
      const result = await api<{ user: User }>(`/api/auth/${authMode}`, { method: 'POST', body: JSON.stringify(values) });
      setUser(result.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in.'); }
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setError('');
  }

  if (loading) return <div className="loading-screen"><span className="brand-mark"><BookOpenCheck size={21} /></span><span>Getting your classroom ready</span></div>;
  if (!user) return <Login mode={authMode} onMode={setAuthMode} onSubmit={signIn} error={error} />;
  return user.role === 'admin'
    ? <TeacherApp user={user} onSignOut={signOut} notice={notice} setNotice={setNotice} />
    : <StudentApp user={user} onSignOut={signOut} notice={notice} setNotice={setNotice} />;
}

function Login({ mode, onMode, onSubmit, error }: { mode: 'admin' | 'student'; onMode: (mode: 'admin' | 'student') => void; onSubmit: (values: { email?: string; password?: string; passkey?: string }) => void; error: string }) {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passkey, setPasskey] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSubmit(mode === 'admin' ? { email, password } : { passkey });
    setBusy(false);
  }
  return <main className="login-layout">
    <section className="login-side">
      <div className="login-brand"><span className="brand-mark"><BookOpenCheck size={21} /></span><span>LiveQuiz</span></div>
      <div className="login-copy"><div className="eyebrow"><span className="eyebrow-line" /> A better rhythm for learning</div><h1>Make every<br />answer <em>count.</em></h1><p>Thoughtful quizzes for lively classrooms and focused practice.</p><div className="login-note"><Sparkles size={17} /><span>One room. Everyone in.</span></div></div>
      <div className="login-footer"><span>Built for curious minds</span><span>01 / 02</span></div>
    </section>
    <section className="login-main">
      <div className="login-card">
        <span className="overline">Welcome to class</span><h2>{mode === 'student' ? 'Ready when you are.' : 'Your classroom, in sync.'}</h2><p className="muted">{mode === 'student' ? 'Enter the passkey your teacher shared with you.' : 'Sign in to prepare a quiz or bring the class together.'}</p>
        <div className="segmented login-switch"><button className={mode === 'student' ? 'selected' : ''} onClick={() => onMode('student')} type="button">Student</button><button className={mode === 'admin' ? 'selected' : ''} onClick={() => onMode('admin')} type="button">Teacher</button></div>
        <form onSubmit={submit} className="form-stack">
          {mode === 'student' ? <label className="field"><span>Your passkey</span><div className="input-with-icon"><KeyRound size={17} /><input autoFocus required value={passkey} onChange={(event) => setPasskey(event.target.value.toUpperCase())} placeholder="Enter your 6-character passkey" autoCapitalize="characters" autoComplete="one-time-code" maxLength={12} /></div></label> : <><label className="field"><span>Email address</span><input autoFocus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teacher@school.com" autoComplete="username" /></label><label className="field"><span>Password</span><input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" /></label></>}
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy ? 'Joining...' : mode === 'student' ? <>Join classroom <ArrowRight size={17} /></> : <>Sign in <ArrowRight size={17} /></>}</button>
        </form>
        <div className="secure-note"><ShieldCheck size={15} /><span>{mode === 'student' ? 'Your answers stay private to you and your teacher.' : 'Protected teacher access'}</span></div>
      </div>
      <div className="login-bottom">Live lessons <span /> Self-paced practice <span /> Clear results</div>
    </section>
  </main>;
}

function TeacherApp({ user, onSignOut, notice, setNotice }: { user: User; onSignOut: () => void; notice: string; setNotice: (text: string) => void }) {
  const [tab, setTab] = useState<'overview' | 'quizzes' | 'worksheets' | 'students' | 'results' | 'ai_settings'>('overview');
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [worksheets, setWorksheets] = useState<WorksheetPaper[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [distribution, setDistribution] = useState<{ question: string; options: { text: string; correct: boolean; count: number }[] }[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const [quizData, studentData, worksheetData] = await Promise.all([
        api<{ quizzes: Quiz[] }>('/api/quizzes'),
        api<{ students: Student[] }>('/api/students'),
        api<{ worksheets: WorksheetPaper[] }>('/api/worksheets').catch(() => ({ worksheets: [] })),
      ]);
      setQuizzes(quizData.quizzes);
      setStudents(studentData.students);
      setWorksheets(worksheetData.worksheets || []);
      if (!selectedQuiz && quizData.quizzes[0]) setSelectedQuiz(quizData.quizzes[0].id);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to load your dashboard.'); }
    finally { setRefreshing(false); }
  }

  async function loadResults(id: string) {
    if (!id) return;
    try {
      const data = await api<{ results: Result[]; distribution: typeof distribution }>(`/api/quizzes/${id}/results`);
      setResults(data.results);
      setDistribution(data.distribution);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to load results.'); }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (tab === 'results' && selectedQuiz) void loadResults(selectedQuiz); }, [tab, selectedQuiz]);
  useEffect(() => {
    const openResults = (event: Event) => {
      const quizId = (event as CustomEvent<string>).detail;
      if (quizId) { setSelectedQuiz(quizId); setTab('results'); }
    };
    document.addEventListener('open-results', openResults);
    return () => document.removeEventListener('open-results', openResults);
  }, []);
  useEffect(() => {
    if (notice) { const timeout = window.setTimeout(() => setNotice(''), 3400); return () => window.clearTimeout(timeout); }
  }, [notice]);

  const totalAttempts = quizzes.reduce((sum, quiz) => sum + (quiz._count?.attempts ?? 0), 0);
  const liveQuiz = quizzes.find((quiz) => quiz.id === selectedQuiz);

  function exportCsv() {
    const lines = [['Student', 'Status', 'Score', 'Out of', 'Submitted at'], ...results.map((result) => [result.name, result.status, result.score ?? '', result.totalMarks, result.submittedAt ? new Date(result.submittedAt).toLocaleString() : ''])];
    const csv = lines.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `${(quizzes.find((quiz) => quiz.id === selectedQuiz)?.title ?? 'quiz-results').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-results.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark"><BookOpenCheck size={19} /></span><span>LiveQuiz</span><span className="brand-dot" /></div>
      <div className="sidebar-label">TEACHER SPACE</div>
      <nav className="side-nav" aria-label="Teacher navigation">
        <NavItem active={tab === 'overview'} icon={<BarChart3 size={17} />} label="Overview" onClick={() => setTab('overview')} />
        <NavItem active={tab === 'quizzes'} icon={<BookOpenCheck size={17} />} label="Quizzes and Worksheets" count={quizzes.length} onClick={() => setTab('quizzes')} />
        <NavItem active={tab === 'worksheets'} icon={<FileText size={17} />} label="Question Papers" count={worksheets.length} onClick={() => setTab('worksheets')} />
        <NavItem active={tab === 'students'} icon={<Users size={17} />} label="Students" count={students.length} onClick={() => setTab('students')} />
        <NavItem active={tab === 'results'} icon={<CheckCircle2 size={17} />} label="Results" onClick={() => setTab('results')} />
        <NavItem active={tab === 'ai_settings'} icon={<Sparkles size={17} />} label="AI Settings" onClick={() => setTab('ai_settings')} />
      </nav>
      <div className="sidebar-bottom"><div className="teacher-profile"><div className="avatar avatar-green">{(user.email ?? 'T').slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.email?.split('@')[0]}</strong><span>Teacher account</span></div><button className="icon-button quiet" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div><div className="sidebar-footnote">A little progress, every day.</div></div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div className="breadcrumb">Your classroom <span>/</span> <strong>{tabLabel(tab)}</strong></div>
        <div className="topbar-actions">
          {tab === 'overview' ? (
            <button className="button button-secondary" style={{ fontSize: '13px', padding: '5px 12px', minHeight: '36px', gap: '6px' }} onClick={onSignOut}>
              <LogOut size={14} /> Logout
            </button>
          ) : (
            <button className="button button-secondary" style={{ fontSize: '13px', padding: '5px 12px', minHeight: '36px', gap: '6px' }} onClick={() => setTab('overview')}>
              <ArrowLeft size={14} /> Back to Classroom
            </button>
          )}
          <span className="today-label">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
          <button className="icon-button" title="Refresh dashboard" aria-label="Refresh dashboard" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
          </button>
          <div className="avatar avatar-small">{(user.email ?? 'T').slice(0, 1).toUpperCase()}</div>
        </div>
      </header>
      <div className="content-area">
        {tab === 'overview' && (() => {
          const openQuizzes = quizzes.filter((q) => q.status === 'ACTIVE');
          const openPapers = worksheets.filter((w) => w.status === 'PUBLISHED');

          return (
            <section className="view-enter">
              <div className="page-heading">
                <div>
                  <span className="overline">Good to see you.</span>
                  <h1>Your classroom at a glance</h1>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button className="button button-primary" onClick={() => setTab('quizzes')}><Plus size={17} /> Create a Quiz</button>
                  <button className="button button-secondary" onClick={() => setTab('worksheets')}><FileText size={17} /> Create a Question Paper</button>
                </div>
              </div>

              <div className="metrics-grid">
                <Metric label="Live / Open Quizzes" value={openQuizzes.length} icon={<Radio size={17} />} tint="coral" />
                <Metric label="Open Question Papers" value={openPapers.length} icon={<FileText size={17} />} tint="blue" />
                <Metric label="Total Students" value={students.length} icon={<Users size={17} />} tint="sage" />
                <Metric label="Student Attempts" value={totalAttempts} icon={<BookOpenCheck size={17} />} tint="sage" />
              </div>

              <div className="section-heading">
                <div>
                  <h2>Live & Active Quizzes</h2>
                  <p>Quizzes and worksheets currently open for student participation</p>
                </div>
                <button className="text-button" onClick={() => setTab('quizzes')}>All Quizzes & Worksheets <ArrowRight size={15} /></button>
              </div>

              {openQuizzes.length === 0 ? (
                <div className="empty-state" style={{ padding: '16px 20px', margin: '0 0 16px 0', minHeight: '100px' }}>
                  <span className="empty-icon" style={{ width: '36px', height: '36px', marginBottom: '6px' }}><Radio size={20} color="#0284c7" /></span>
                  <h3 style={{ fontSize: '16px', margin: '0 0 10px' }}>No Live or Open Quizzes right now.</h3>
                  <button className="button button-primary" style={{ minHeight: '38px', fontSize: '14px', padding: '0 16px' }} onClick={() => setTab('quizzes')}><Plus size={15} /> Open Quizzes</button>
                </div>
              ) : (
                <QuizList
                  quizzes={openQuizzes.slice(0, 4)}
                  onEdit={(quiz) => { setSelectedQuiz(quiz.id); setTab('quizzes'); }}
                  onSelect={(quiz) => { setSelectedQuiz(quiz.id); setTab(quiz.mode === 'LIVE' ? 'quizzes' : 'results'); }}
                  onOpenAI={() => setTab('quizzes')}
                  onRefresh={refresh}
                  setNotice={setNotice}
                />
              )}

              <div className="section-heading" style={{ marginTop: '24px' }}>
                <div>
                  <h2>Open Question Papers</h2>
                  <p>Active question papers accepting student workbook answer sheet uploads</p>
                </div>
                <button className="text-button" onClick={() => setTab('worksheets')}>All Question Papers <ArrowRight size={15} /></button>
              </div>

              {openPapers.length === 0 ? (
                <div className="empty-state" style={{ padding: '16px 20px', margin: 0, minHeight: '100px' }}>
                  <span className="empty-icon" style={{ width: '38px', height: '38px', marginBottom: '6px' }}><FileText size={20} color="#0284c7" /></span>
                  <h3 style={{ fontSize: '16px', margin: '0 0 10px' }}>No Open Question Papers right now.</h3>
                  <button className="button button-primary" style={{ minHeight: '38px', fontSize: '14px', padding: '0 16px' }} onClick={() => setTab('worksheets')}><Plus size={15} /> Manage Question Papers</button>
                </div>
              ) : (
                <div className="worksheet-grid">
                  {openPapers.slice(0, 3).map((paper) => (
                    <div className="worksheet-card" key={paper.id}>
                      <div>
                        <div className="worksheet-card-meta">
                          <span className="worksheet-badge badge-published">
                            {paper.status}
                          </span>
                          {paper.subject && <span className="worksheet-badge badge-subject">{paper.subject}</span>}
                          {paper.grade && <span className="worksheet-badge badge-draft">{paper.grade}</span>}
                        </div>
                        <h3>{paper.title}</h3>
                        <div className="worksheet-card-stats">
                          <span>Marks: <strong>{paper.totalMarks}</strong></span>
                          <span>Created: <strong>{new Date(paper.createdAt).toLocaleDateString()}</strong></span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                        <button className="button button-secondary" style={{ fontSize: '13px', padding: '6px 12px', flex: '1 1 auto' }} onClick={() => setTab('worksheets')}>
                          Manage in Question Papers <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })()}
        {tab === 'quizzes' && <QuizManager quizzes={quizzes} selectedQuiz={selectedQuiz} setSelectedQuiz={setSelectedQuiz} liveQuiz={liveQuiz} refresh={refresh} setNotice={setNotice} onNavigateToAISettings={() => setTab('ai_settings')} />}
        {tab === 'worksheets' && <WorksheetsPanel setNotice={setNotice} onNavigateToAISettings={() => setTab('ai_settings')} />}
        {tab === 'students' && <StudentManager students={students} refresh={refresh} setNotice={setNotice} onBackToClassroom={() => setTab('overview')} />}
        {tab === 'results' && <ResultsPanel quizzes={quizzes} selectedQuiz={selectedQuiz} setSelectedQuiz={setSelectedQuiz} results={results} distribution={distribution} onExport={exportCsv} />}
        {tab === 'ai_settings' && <AISettingsPanel setNotice={setNotice} />}
      </div>
      {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}
    </main>
  </div>;
}

function AISettingsPanel({ setNotice }: { setNotice: (msg: string) => void }) {
  const [provider, setProvider] = useState(() => localStorage.getItem('livequiz_ai_provider') || 'auto');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('livequiz_ai_key') || '');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem('livequiz_ai_provider', provider);
    localStorage.setItem('livequiz_ai_key', apiKey.trim());
    setSaved(true);
    setNotice('✓ AI Engine Provider & API Key saved successfully.');
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <section className="view-enter">
      <div className="page-heading">
        <div>
          <span className="overline">System Configuration</span>
          <h1>AI Settings</h1>
          <p>Configure the default AI provider and API keys used for AI quiz and question paper generation.</p>
        </div>
      </div>

      <div className="ai-page-card" style={{ maxWidth: '800px' }}>
        <form onSubmit={handleSave} className="ai-form-grid">
          {saved && (
            <div className="compact-nep" style={{ background: '#ecfdf5', borderColor: '#6ee7b7', color: '#047857' }}>
              <CheckCircle2 size={18} />
              <span>AI Settings saved! All AI quiz and question paper generators will use these preferences.</span>
            </div>
          )}

          <div className="form-grid-2">
            <label className="field compact-field">
              <span>AI Engine Provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="auto">Auto Select (Google Gemini / OpenAI GPT)</option>
                <option value="gemini">Google Gemini AI</option>
                <option value="openai">ChatGPT (OpenAI GPT-4o)</option>
              </select>
              <small className="muted" style={{ marginTop: '4px' }}>
                Select your preferred AI service provider.
              </small>
            </label>

            <label className="field compact-field">
              <span>API Key</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your API key here..."
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  style={{ padding: '0 12px', minHeight: '44px', fontSize: '13px' }}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <small className="muted" style={{ marginTop: '4px' }}>
                Optional. If left empty, default server environment keys will be used.
              </small>
            </label>
          </div>

          <div className="compact-modal-actions" style={{ marginTop: '20px' }}>
            <button type="submit" className="button button-primary" style={{ padding: '0 28px', minHeight: '44px' }}>
              <Save size={16} /> Save AI Settings
            </button>
          </div>
        </form>

        <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '15px', margin: '0 0 10px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={16} color="#0284c7" /> Active AI Configuration
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <div style={{ padding: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Active Provider</span>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>
                {provider === 'gemini' ? 'Google Gemini AI' : provider === 'openai' ? 'ChatGPT (OpenAI)' : 'Auto (Gemini / GPT)'}
              </div>
            </div>
            <div style={{ padding: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>API Key Status</span>
              <div style={{ fontSize: '15px', fontWeight: 700, color: apiKey ? '#047857' : '#0284c7', marginTop: '4px' }}>
                {apiKey ? '✓ Custom Key Set' : 'Default Server Key'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function tabLabel(tab: string) { return ({ overview: 'Overview', quizzes: 'Quizzes and Worksheets', worksheets: 'Question Papers', students: 'Students', results: 'Results', ai_settings: 'AI Settings' } as Record<string, string>)[tab] ?? tab; }
function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <small>{count}</small>}</button>; }
function Metric({ label, value, icon, tint }: { label: string; value: number | string; icon: React.ReactNode; tint: string }) { return <div className="metric"><div className={`metric-icon ${tint}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div><div className="metric-trend">↗</div></div>; }

function AIQuizModal({ onClose, onGenerated, onNavigateToAISettings }: { onClose: () => void; onGenerated: (quiz: { title: string; mode: Mode; hasTimer?: boolean; minutes?: number; questions: Question[] }) => void; onNavigateToAISettings?: () => void }) {
  const [subject, setSubject] = useState('Science');
  const [customSubject, setCustomSubject] = useState('');
  const [grade, setGrade] = useState('Grade 6');
  const [topic, setTopic] = useState('');
  const [subtopics, setSubtopics] = useState('');
  const [difficulty, setDifficulty] = useState<'Easy' | 'Moderate' | 'Hard'>('Moderate');
  const [questionCount, setQuestionCount] = useState(10);
  const [questionType, setQuestionType] = useState<'ALL' | 'MCQ' | 'FILL_BLANK' | 'TRUE_FALSE' | 'SOLVE'>('ALL');
  const [mode, setMode] = useState<Mode>('LIVE');
  const [hasTimer, setHasTimer] = useState(false);
  const [minutes, setMinutes] = useState(20);
  const [details, setDetails] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const provider = localStorage.getItem('livequiz_ai_provider') || 'auto';
  const apiKey = localStorage.getItem('livequiz_ai_key') || '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) { setError('Please enter a topic.'); return; }
    setError('');
    setGenerating(true);
    try {
      const finalSubject = subject === 'Other' ? (customSubject || 'General') : subject;
      const res = await api<{ title: string; questions: Question[] }>('/api/ai/generate-quiz', {
        method: 'POST',
        body: JSON.stringify({ subject: finalSubject, grade, topic, subtopics, difficulty, questionCount, questionType, mode, details, provider, apiKey: apiKey.trim() || undefined }),
      });
      onGenerated({ title: res.title, mode, hasTimer, minutes, questions: res.questions });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate quiz.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ai-form-grid">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px', color: '#0369a1', fontSize: '13.5px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} />
          <span>AI Engine Settings: <strong>{provider === 'gemini' ? 'Google Gemini AI' : provider === 'openai' ? 'ChatGPT (OpenAI)' : 'Auto Select'}</strong> {apiKey ? '(Custom API Key Active)' : '(Server Key)'}</span>
        </div>
        {onNavigateToAISettings && (
          <button type="button" className="text-button" style={{ fontSize: '12.5px', color: '#0284c7', fontWeight: 600, padding: 0 }} onClick={onNavigateToAISettings}>
            Configure AI Settings →
          </button>
        )}
      </div>

      <div className="form-grid-3">
        <label className="field compact-field">
          <span>Subject</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="Science">Science</option>
            <option value="Mathematics">Mathematics</option>
            <option value="English">English</option>
            <option value="Social Studies">Social Studies</option>
            <option value="Physics">Physics</option>
            <option value="Chemistry">Chemistry</option>
            <option value="Biology">Biology</option>
            <option value="Environmental Studies">Environmental Studies (EVS)</option>
            <option value="Computer Science">Computer Science / Coding</option>
            <option value="Other">Other / Custom</option>
          </select>
        </label>

        <label className="field compact-field">
          <span>Grade / Class</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>

        <div className="field compact-field">
          <span>Difficulty Level</span>
          <div className="difficulty-pills">
            {(['Easy', 'Moderate', 'Hard'] as const).map((level) => (
              <button key={level} type="button" className={`pill ${difficulty === level ? 'active-' + level.toLowerCase() : ''}`} onClick={() => setDifficulty(level)}>
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      {subject === 'Other' && (
        <label className="field">
          <span>Specify Custom Subject</span>
          <input required value={customSubject} onChange={(e) => setCustomSubject(e.target.value)} placeholder="e.g. General Knowledge" />
        </label>
      )}

      <div className="form-grid-2">
        <label className="field compact-field">
          <span>Main Topic <span className="required-star">*</span></span>
          <input required value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Photosynthesis, Motion, Fractions" />
        </label>

        <label className="field compact-field">
          <span>Sub-Topics (Optional)</span>
          <input value={subtopics} onChange={(e) => setSubtopics(e.target.value)} placeholder="e.g. Light reaction, Chlorophyll" />
        </label>
      </div>

      <div className="form-grid-2">
        <label className="field compact-field">
          <span>Number of Questions</span>
          <select value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
            <option value={3}>3 Questions</option>
            <option value={5}>5 Questions</option>
            <option value={10}>10 Questions</option>
            <option value={15}>15 Questions</option>
            <option value={20}>20 Questions</option>
            <option value={25}>25 Questions</option>
            <option value={30}>30 Questions</option>
          </select>
        </label>

        <label className="field compact-field">
          <span>Question Format / Type</span>
          <select value={questionType} onChange={(e) => setQuestionType(e.target.value as any)}>
            <option value="ALL">All Types (Mixed MCQ, Fill-in-blank, True/False, Solve)</option>
            <option value="MCQ">Multiple Choice (MCQ) Only</option>
            <option value="FILL_BLANK">Fill in the Blanks Only</option>
            <option value="TRUE_FALSE">True / False Only</option>
            <option value="SOLVE">Solve / Problem Solving Only</option>
          </select>
        </label>
      </div>

      <div className="form-grid-2">
        <div className="field compact-field" style={{ gridColumn: '1 / -1' }}>
          <span>Quiz Delivery Mode</span>
          <div className="mode-choice compact-mode-choice">
            <button type="button" className={mode === 'LIVE' ? 'chosen' : ''} onClick={() => { setMode('LIVE'); setHasTimer(false); }}>
              <Radio size={15} />
              <span><strong>Live classroom</strong></span>
            </button>
            <button type="button" className={mode === 'SELF_PACED' && hasTimer ? 'chosen' : ''} onClick={() => { setMode('SELF_PACED'); setHasTimer(true); }}>
              <Clock3 size={15} />
              <span><strong>Timed practice</strong></span>
            </button>
            <button type="button" className={mode === 'SELF_PACED' && !hasTimer ? 'chosen' : ''} onClick={() => { setMode('SELF_PACED'); setHasTimer(false); }}>
              <BookOpenCheck size={15} />
              <span><strong>Self Paced</strong></span>
            </button>
          </div>
        </div>

        {mode === 'SELF_PACED' && hasTimer && (
          <label className="field compact-field short-field" style={{ marginTop: '4px' }}>
            <span>Time Limit (Minutes)</span>
            <div className="input-suffix">
              <input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
              <span>minutes</span>
            </div>
          </label>
        )}

        <label className="field compact-field" style={{ gridColumn: mode === 'SELF_PACED' && hasTimer ? 'auto' : '1 / -1' }}>
          <span>Any Other Details (Optional)</span>
          <input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. Focus on word problems..." />
        </label>
      </div>

      <div className="nep-callout compact-nep">
        <Sparkles size={16} />
        <span><strong>NEP 2026 Aligned:</strong> Questions focus on real-world scenarios, critical reasoning, and competency assessment.</span>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="modal-actions compact-modal-actions">
        <button type="button" className="button button-quiet" onClick={onClose} disabled={generating}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={generating}>
          {generating ? <><RefreshCw size={16} className="spin" /> Generating {questionCount} Questions...</> : <><Sparkles size={16} /> Generate {questionCount} Questions</>}
        </button>
      </div>
    </form>
  );
}

function QuizList({ quizzes, onEdit, onSelect, onOpenAI, onRefresh, setNotice, onRestart }: { quizzes: Quiz[]; onEdit: (quiz: Quiz) => void; onSelect: (quiz: Quiz) => void; onOpenAI: () => void; onRefresh: () => Promise<void>; setNotice: (text: string) => void; onRestart?: (quiz: Quiz) => void }) {
  async function remove(quiz: Quiz) {
    if (!window.confirm(`Delete “${quiz.title}” and all its results?`)) return;
    try { await api(`/api/quizzes/${quiz.id}`, { method: 'DELETE' }); setNotice('Quiz deleted.'); await onRefresh(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to delete quiz.'); }
  }
  if (!quizzes.length) return <div className="empty-state"><span className="empty-icon"><Sparkles size={26} /></span><h3>Your first quiz starts here.</h3><p>Build a live classroom round or generate an AI quiz in seconds.</p><div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}><button className="button button-primary" onClick={onOpenAI}><Sparkles size={17} /> Generate with AI</button><button className="button button-secondary" onClick={() => onEdit({ id: '', title: '', mode: 'LIVE', status: 'DRAFT', currentQuestionIndex: 0, currentAnswerRevealed: false, timeLimitSeconds: null, showResults: true })}><Plus size={16} /> Create manually</button></div></div>;
  return <div className="quiz-list">{quizzes.map((quiz) => <article className="quiz-row" key={quiz.id}><div className={`quiz-mode-icon ${quiz.mode === 'LIVE' ? 'mode-live' : 'mode-timed'}`}>{quiz.mode === 'LIVE' ? <Radio size={19} /> : <Clock3 size={19} />}</div><button className="quiz-row-main" onClick={() => onSelect(quiz)}><strong>{quiz.title}</strong><span>{quiz.mode === 'LIVE' ? 'Live classroom' : quiz.timeLimitSeconds !== null ? `${Math.round(quiz.timeLimitSeconds / 60)} min · Self-paced` : 'Self Paced'} <i /> {quiz._count?.questions ?? 0} questions <i /> {quiz._count?.attempts ?? 0} attempts</span></button><StatusPill status={quiz.status} /><div className="quiz-row-actions">{onRestart && <button className="icon-button" title="Restart quiz (reset to Question 1)" aria-label={`Restart ${quiz.title}`} onClick={() => onRestart(quiz)}><RotateCcw size={15} /></button>}<button className="icon-button" title="Edit quiz" aria-label={`Edit ${quiz.title}`} disabled={quiz.status === 'ACTIVE'} onClick={() => onEdit(quiz)}><Pencil size={15} /></button><button className="icon-button danger-hover" title="Delete quiz" aria-label={`Delete ${quiz.title}`} onClick={() => void remove(quiz)}><Trash2 size={15} /></button></div></article>)}</div>;
}
function StatusPill({ status }: { status: Status }) { return <span className={`status-pill status-${status.toLowerCase()}`}><i />{status === 'ACTIVE' ? 'Live' : status === 'CLOSED' ? 'Finished' : 'Draft'}</span>; }

function QuizManager({ quizzes, selectedQuiz, setSelectedQuiz, liveQuiz, refresh, setNotice, initialOpenAI, onNavigateToAISettings }: { quizzes: Quiz[]; selectedQuiz: string; setSelectedQuiz: (id: string) => void; liveQuiz?: Quiz; refresh: () => Promise<void>; setNotice: (text: string) => void; initialOpenAI?: boolean; onNavigateToAISettings?: () => void }) {
  const [draft, setDraft] = useState<QuizDraft | null>(null);
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAIModal, setShowAIModal] = useState(Boolean(initialOpenAI));
  const [stats, setStats] = useState<LiveStats>({ answered: 0, participants: 0, distribution: [], responses: [] });
  const socketRef = useRef<Socket | null>(null);
  const [liveState, setLiveState] = useState<{ status: Status; currentQuestionIndex: number; currentAnswerRevealed: boolean; questionCount: number; question: Question | null } | null>(null);

  useEffect(() => {
    if (!liveQuiz || liveQuiz.mode !== 'LIVE' || liveQuiz.status !== 'ACTIVE') { setLiveState(null); return; }
    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('watch:quiz', liveQuiz.id));
    socket.on('quiz:stats', setStats);
    socket.on('quiz:state', (state) => setLiveState(state));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [liveQuiz?.id, liveQuiz?.status]);

  async function startEdit(quiz?: Quiz) {
    if (!quiz?.id) { setEditingId(''); setDraft(newDraft()); return; }
    try {
      const data = await api<{ quiz: Quiz }>(`/api/quizzes/${quiz.id}/detail`);
      const full = data.quiz;
      setEditingId(full.id);
      setDraft({
        title: full.title,
        mode: full.mode,
        hasTimer: full.mode === 'SELF_PACED' && full.timeLimitSeconds !== null,
        minutes: Math.max(1, Math.round((full.timeLimitSeconds ?? 1200) / 60)),
        showResults: full.showResults,
        questions: full.questions ?? [emptyQuestion()]
      });
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to open this quiz.'); }
  }

  function updateQuestion(index: number, updater: (question: Question) => Question) {
    if (!draft) return;
    setDraft({ ...draft, questions: draft.questions.map((question, questionIndex) => questionIndex === index ? updater(question) : question) });
  }

  async function saveQuiz(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        title: draft.title,
        mode: draft.mode,
        timeLimitSeconds: (draft.mode === 'SELF_PACED' && draft.hasTimer) ? Math.max(60, draft.minutes * 60) : null,
        showResults: draft.showResults,
        questions: draft.questions
      };
      await api(editingId ? `/api/quizzes/${editingId}` : '/api/quizzes', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setDraft(null); setNotice(editingId ? 'Quiz updated.' : 'Quiz created.'); await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to save quiz.'); }
    finally { setSaving(false); }
  }

  async function control(action: 'start' | 'next' | 'reveal' | 'stop') {
    if (!liveQuiz) return;
    try {
      if (action === 'reveal') {
        setLiveState((prev) => prev ? { ...prev, currentAnswerRevealed: true } : prev);
      } else if (action === 'next') {
        setLiveState((prev) => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1, currentAnswerRevealed: false } : prev);
      }
      await api(`/api/quizzes/${liveQuiz.id}/control`, { method: 'PATCH', body: JSON.stringify({ action }) });
      void refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to update this quiz.'); }
  }

  async function setTimedStatus(quiz: Quiz, action: 'start' | 'stop') {
    try { await api(`/api/quizzes/${quiz.id}/status`, { method: 'PATCH', body: JSON.stringify({ action }) }); await refresh(); setNotice(action === 'start' ? 'Practice quiz is open.' : 'Practice quiz closed.'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to update this quiz.'); }
  }

  async function restartQuiz(quiz: Quiz) {
    if (!window.confirm(`Restart "${quiz.title}"? This will clear student attempt history and reset the quiz to Question 1.`)) return;
    try {
      await api(`/api/quizzes/${quiz.id}/restart`, { method: 'POST' });
      setNotice(`"${quiz.title}" has been restarted.`);
      await refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Unable to restart quiz.');
    }
  }

  function handleAIGenerated(result: { title: string; mode: Mode; hasTimer?: boolean; minutes?: number; questions: Question[] }) {
    setEditingId('');
    setDraft({
      title: result.title,
      mode: result.mode,
      hasTimer: result.hasTimer ?? false,
      minutes: result.minutes ?? 20,
      showResults: true,
      questions: result.questions,
    });
    setShowAIModal(false);
    setNotice('✨ AI Quiz generated with NEP 2026 alignment! Review and save below.');
  }

  if (draft) return <section className="view-enter"><div className="page-heading compact-heading"><div><button className="back-link" onClick={() => setDraft(null)}><ArrowLeft size={15} /> All quizzes</button><h1>{editingId ? 'Edit your quiz' : 'Build a quiz'}</h1><p>Keep each question clear and focused.</p></div><button className="button button-primary" onClick={(event) => void saveQuiz(event as unknown as React.FormEvent)} disabled={saving}>{saving ? 'Saving...' : <><Check size={16} /> Save quiz</>}</button></div>
    <form className="editor-layout" onSubmit={saveQuiz}>
      <div className="editor-main">
        <div className="form-panel"><div className="panel-title"><span className="step-count">01</span><div><h2>Quiz details</h2><p>Give your quiz a name students will recognize.</p></div></div><label className="field"><span>Quiz title</span><input required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Fractions, round one" /></label><div className="field"><span>How will students take it?</span><div className="mode-choice"><button type="button" className={draft.mode === 'LIVE' ? 'chosen' : ''} onClick={() => setDraft({ ...draft, mode: 'LIVE', hasTimer: false })}><Radio size={18} /><span><strong>Live classroom</strong></span>{draft.mode === 'LIVE' && <Check size={16} />}</button><button type="button" className={draft.mode === 'SELF_PACED' && draft.hasTimer ? 'chosen' : ''} onClick={() => setDraft({ ...draft, mode: 'SELF_PACED', hasTimer: true })}><Clock3 size={18} /><span><strong>Timed practice</strong></span>{draft.mode === 'SELF_PACED' && draft.hasTimer && <Check size={16} />}</button><button type="button" className={draft.mode === 'SELF_PACED' && !draft.hasTimer ? 'chosen' : ''} onClick={() => setDraft({ ...draft, mode: 'SELF_PACED', hasTimer: false })}><BookOpenCheck size={18} /><span><strong>Self Paced</strong></span>{draft.mode === 'SELF_PACED' && !draft.hasTimer && <Check size={16} />}</button></div></div>{draft.mode === 'SELF_PACED' && draft.hasTimer && <label className="field short-field" style={{ marginTop: '16px' }}><span>Time limit</span><div className="input-suffix"><input type="number" min={1} max={1440} value={draft.minutes} onChange={(event) => setDraft({ ...draft, minutes: Number(event.target.value) })} /><span>minutes</span></div></label>}<label className="check-row"><input type="checkbox" checked={draft.showResults} onChange={(event) => setDraft({ ...draft, showResults: event.target.checked })} /><span><strong>Show results to students</strong></span></label></div>
        {draft.questions.map((question, index) => <div className="form-panel question-editor" key={index}>
          <div className="panel-title">
            <span className="step-count">{String(index + 2).padStart(2, '0')}</span>
            <div>
              <h2>Question {index + 1}</h2>
              <p>Write prompt and set multiple choice options.</p>
            </div>
            {draft.questions.length > 1 && (
              <button
                type="button"
                className="icon-button danger-hover panel-remove"
                title="Remove question"
                onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, questionIndex) => questionIndex !== index) })}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>

          <label className="field">
            <span>Question Prompt</span>
            <textarea
              required
              maxLength={1000}
              rows={2}
              value={question.prompt}
              onChange={(event) => updateQuestion(index, (value) => ({ ...value, prompt: event.target.value }))}
              placeholder="Write a question..."
            />
          </label>

          <div className="options-heading">
            <span>Answer options</span>
            <span>Mark correct answer</span>
          </div>
          <div className="option-editor-list">
            {question.options.map((option, optionIndex) => (
              <div className={`option-editor ${option.isCorrect ? 'correct-option' : ''}`} key={optionIndex}>
                <button
                  type="button"
                  className={`correct-radio ${option.isCorrect ? 'checked' : ''}`}
                  aria-label={`Mark option ${optionIndex + 1} as correct`}
                  onClick={() => updateQuestion(index, (value) => ({ ...value, options: value.options.map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === optionIndex })) }))}
                >
                  {option.isCorrect && <Check size={12} />}
                </button>
                <span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                <input
                  required
                  maxLength={300}
                  value={option.text}
                  onChange={(event) => updateQuestion(index, (value) => ({ ...value, options: value.options.map((item, itemIndex) => itemIndex === optionIndex ? { ...item, text: event.target.value } : item) }))}
                  placeholder={`Option ${optionIndex + 1}`}
                />
                {question.options.length > 2 && (
                  <button
                    type="button"
                    className="mini-icon"
                    aria-label="Remove option"
                    onClick={() => updateQuestion(index, (value) => ({ ...value, options: value.options.filter((_, itemIndex) => itemIndex !== optionIndex).map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === 0 ? item.isCorrect || !value.options.some((entry) => entry.isCorrect) : item.isCorrect })) }))}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="question-footer">
            <button
              type="button"
              className="text-button add-option"
              disabled={question.options.length >= 8}
              onClick={() => updateQuestion(index, (value) => ({ ...value, options: [...value.options, { text: '', isCorrect: false }] }))}
            >
              <Plus size={14} /> Add option
            </button>
            <label className="marks-field">
              Points <input type="number" min={1} max={100} value={question.marks} onChange={(event) => updateQuestion(index, (value) => ({ ...value, marks: Number(event.target.value) }))} />
            </label>
          </div>
        </div>)}
        <button type="button" className="add-question" onClick={() => setDraft({ ...draft, questions: [...draft.questions, emptyQuestion()] })}><span><Plus size={16} /></span> Add another question</button>
      </div>
      <aside className="editor-aside"><div className="aside-note"><span><CircleHelp size={17} /></span><strong>A clear question goes a long way.</strong><p>Keep wording simple, and use answer options that are easy to scan on a phone.</p></div><div className="summary-box"><span className="overline">Quiz summary</span><div><BookOpenCheck size={15} /> {draft.questions.length} question{draft.questions.length === 1 ? '' : 's'}</div><div>{draft.mode === 'LIVE' ? <Radio size={15} /> : <Clock3 size={15} />} {draft.mode === 'LIVE' ? 'Live classroom' : `${draft.minutes} minute timer`}</div></div></aside>
    </form>
  </section>;

  if (showAIModal) {
    return (
      <section className="view-enter">
        <div className="page-heading compact-heading">
          <div>
            <button className="back-link" onClick={() => setShowAIModal(false)}>
              <ArrowLeft size={15} /> All quizzes
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <span className="ai-badge"><Sparkles size={15} /> AI Quiz Generator</span>
            </div>
            <h1 style={{ marginTop: '4px' }}>Generate Quiz</h1>
          </div>
        </div>

        <div className="ai-page-card">
          <AIQuizModal onClose={() => setShowAIModal(false)} onGenerated={handleAIGenerated} onNavigateToAISettings={onNavigateToAISettings} />
        </div>
      </section>
    );
  }

  return (
    <section className="view-enter">
      <div className="page-heading">
        <div>
          <span className="overline">Quizzes & Worksheets</span>
          <h1>Quizzes and Worksheets</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="button button-primary" onClick={() => setShowAIModal(true)}>
            <Sparkles size={17} /> Generate with AI
          </button>
          <button className="button button-secondary" onClick={() => void startEdit()}>
            <Plus size={17} /> Create manually
          </button>
        </div>
      </div>

      {liveQuiz && (
        <div className="live-panel live-panel-fullwidth" style={{ marginBottom: '24px' }}>
          <div className="live-panel-head">
            <span className="overline">Classroom monitor · {liveQuiz.title}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="live-indicator">
                {liveQuiz.status === 'ACTIVE' && liveQuiz.mode === 'LIVE' ? <><i /> Live now</> : 'Ready when you are'}
              </span>
              <button
                className="icon-button quiet"
                title="Close monitor"
                onClick={() => setSelectedQuiz('')}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {liveQuiz.mode === 'LIVE' ? (
            <>
              <div className="monitor-question">
                <div className="monitor-question-meta">
                  <span>
                    QUESTION {String((liveState?.currentQuestionIndex ?? liveQuiz.currentQuestionIndex) + 1).padStart(2, '0')}{' '}
                    <span>/ {liveState?.questionCount ?? liveQuiz._count?.questions ?? 0}</span>
                  </span>
                  <span className="answer-counter">
                    <Users size={14} /> {stats.answered} answered
                  </span>
                </div>
                <h3>
                  {liveState?.question?.prompt ??
                    liveQuiz.questions?.[liveQuiz.currentQuestionIndex]?.prompt ??
                    (liveQuiz.status === 'DRAFT'
                      ? 'Start the quiz to reveal question one.'
                      : liveQuiz.status === 'ACTIVE'
                        ? 'Loading question...'
                        : 'The quiz is complete.')}
                </h3>
              </div>
              {liveQuiz.status === 'ACTIVE' && (
                <div className="teacher-options-list">
                  {(liveState?.question?.options ?? liveQuiz.questions?.[liveQuiz.currentQuestionIndex]?.options ?? []).map(
                    (option, index) => {
                      const count = stats.distribution.find((entry) => entry.optionId === option.id)?.count ?? 0;
                      const total = stats.answered;
                      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
                      const isCorrectOption = Boolean(option.isCorrect);
                      return (
                        <div
                          className={`teacher-option-card ${liveState?.currentAnswerRevealed && isCorrectOption ? 'is-correct' : ''}`}
                          key={option.id ?? index}
                        >
                          <div className="teacher-option-header">
                            <span className="student-option-letter">{String.fromCharCode(65 + index)}</span>
                            <span className="teacher-option-text">{option.text}</span>
                            <span className="teacher-option-count">
                              {count} ({percent}%)
                            </span>
                            {liveState?.currentAnswerRevealed && isCorrectOption && (
                              <span className="correct-label">
                                <Check size={14} /> Correct
                              </span>
                            )}
                          </div>
                          <div className="teacher-bar-track">
                            <div className="teacher-bar-fill" style={{ width: `${percent}%` }} />
                          </div>
                        </div>
                      );
                    }
                  )}
                  {stats.responses.length > 0 && (
                    <div className="live-responses">
                      <span className="live-responses-title">Student responses</span>
                      {[...stats.responses]
                        .reverse()
                        .slice(0, 6)
                        .map((response, index) => (
                          <div className="live-response" key={`${response.name}-${index}`}>
                            <strong>{response.name}</strong>
                            <span>{response.text}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  {liveState?.currentAnswerRevealed && (
                    <div className="reveal-note">
                      <CheckCircle2 size={16} /> Correct answer is revealed on student screens
                    </div>
                  )}
                </div>
              )}
              <div className="monitor-actions">
                {liveQuiz.status === 'DRAFT' ? (
                  <button className="button button-primary button-wide" onClick={() => void control('start')}>
                    <Radio size={16} /> Start live quiz
                  </button>
                ) : liveQuiz.status === 'ACTIVE' ? (
                  <>
                    <button
                      className="button button-primary"
                      onClick={() => void control(liveState?.currentAnswerRevealed ? 'next' : 'reveal')}
                    >
                      {liveState?.currentAnswerRevealed ? (
                        <>
                          <ArrowRight size={17} /> Next question
                        </>
                      ) : (
                        <>
                          <Eye size={17} /> Reveal answer
                        </>
                      )}
                    </button>
                    <button className="button button-quiet" onClick={() => void control('stop')}>
                      <X size={17} /> End quiz
                    </button>
                    <button className="button button-quiet" onClick={() => void restartQuiz(liveQuiz)}>
                      <RotateCcw size={16} /> Restart quiz
                    </button>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div className="finished-note">
                      <CheckCircle2 size={16} /> This live quiz has finished
                    </div>
                    <button className="button button-secondary" onClick={() => void restartQuiz(liveQuiz)}>
                      <RotateCcw size={16} /> Restart quiz
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="timed-monitor">
              <div className="timed-icon">
                {liveQuiz.timeLimitSeconds !== null ? <Clock3 size={24} /> : <BookOpenCheck size={24} />}
              </div>
              <h3>{liveQuiz.title}</h3>
              <p>
                {liveQuiz.timeLimitSeconds !== null
                  ? `${Math.round((liveQuiz.timeLimitSeconds ?? 0) / 60)} minutes`
                  : 'Self-Paced (No time limit)'} · {liveQuiz._count?.questions ?? 0} questions
              </p>
              {liveQuiz.status === 'DRAFT' ? (
                <button className="button button-primary button-wide" onClick={() => void setTimedStatus(liveQuiz, 'start')}>
                  <BookOpenCheck size={16} /> Open practice quiz
                </button>
              ) : liveQuiz.status === 'ACTIVE' ? (
                <div style={{ display: 'flex', gap: '10px', width: '100%', flexWrap: 'wrap' }}>
                  <button className="button button-quiet" style={{ flex: 1 }} onClick={() => void setTimedStatus(liveQuiz, 'stop')}>
                    <X size={16} /> Close quiz
                  </button>
                  <button className="button button-secondary" onClick={() => void restartQuiz(liveQuiz)}>
                    <RotateCcw size={16} /> Restart
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="finished-note">
                    <CheckCircle2 size={16} /> Practice quiz closed
                  </span>
                  <button className="button button-secondary" onClick={() => void restartQuiz(liveQuiz)}>
                    <RotateCcw size={16} /> Restart quiz
                  </button>
                </div>
              )}
              <button
                className="text-button monitor-results"
                onClick={() => document.dispatchEvent(new CustomEvent('open-results', { detail: liveQuiz.id }))}
              >
                View student results <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {quizzes.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '120px', padding: '16px 20px' }}>
          <span className="empty-icon" style={{ width: '38px', height: '38px', marginBottom: '6px' }}>
            <Sparkles size={20} color="#0284c7" />
          </span>
          <h3 style={{ fontSize: '16px', margin: '0 0 10px' }}>No Quizzes created yet.</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="button button-primary" style={{ minHeight: '38px', fontSize: '14px', padding: '0 16px' }} onClick={() => setShowAIModal(true)}>
              <Sparkles size={15} /> Generate with AI
            </button>
            <button className="button button-secondary" style={{ minHeight: '38px', fontSize: '14px', padding: '0 16px' }} onClick={() => void startEdit()}>
              <Plus size={15} /> Create manually
            </button>
          </div>
        </div>
      ) : (
        <div className="worksheet-grid">
          {quizzes.map((quiz) => (
            <div className="worksheet-card" key={quiz.id} style={{ border: selectedQuiz === quiz.id ? '2px solid #0284c7' : undefined }}>
              <div>
                <div className="worksheet-card-meta">
                  <span className={`worksheet-badge ${quiz.status === 'ACTIVE' ? 'badge-published' : quiz.status === 'CLOSED' ? 'badge-subject' : 'badge-draft'}`}>
                    {quiz.status === 'ACTIVE' ? '● LIVE NOW' : quiz.status === 'CLOSED' ? '✓ FINISHED' : 'DRAFT'}
                  </span>
                  <select
                    className={`worksheet-badge ${quiz.mode === 'LIVE' ? 'badge-subject' : 'badge-draft'}`}
                    style={{ border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer', outline: 'none', padding: '2px 8px', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }}
                    value={quiz.mode === 'LIVE' ? 'LIVE' : (quiz.timeLimitSeconds !== null ? 'TIMED' : 'SELF_PACED')}
                    onChange={async (e) => {
                      const val = e.target.value;
                      let newMode: Mode = 'SELF_PACED';
                      let newTime: number | null = null;
                      if (val === 'LIVE') {
                        newMode = 'LIVE';
                        newTime = null;
                      } else if (val === 'TIMED') {
                        newMode = 'SELF_PACED';
                        newTime = quiz.timeLimitSeconds ?? 1200;
                      } else {
                        newMode = 'SELF_PACED';
                        newTime = null;
                      }
                      try {
                        await api(`/api/quizzes/${quiz.id}/mode`, { method: 'PATCH', body: JSON.stringify({ mode: newMode, timeLimitSeconds: newTime }) });
                        setNotice(`Mode changed for "${quiz.title}"`);
                        await refresh();
                      } catch (cause) {
                        setNotice(cause instanceof Error ? cause.message : 'Unable to update mode');
                      }
                    }}
                  >
                    <option value="LIVE">Live Classroom</option>
                    <option value="TIMED">Timed Practice</option>
                    <option value="SELF_PACED">Self Paced</option>
                  </select>
                </div>
                <h3>{quiz.title}</h3>
                <div className="worksheet-card-stats">
                  <span>Questions: <strong>{quiz._count?.questions ?? 0}</strong></span>
                  <span>Attempts: <strong>{quiz._count?.attempts ?? 0}</strong></span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="button button-primary"
                    style={{ fontSize: '12.5px', padding: '6px 10px', flex: 1 }}
                    title="Open Live Monitor for this quiz"
                    onClick={() => setSelectedQuiz(quiz.id)}
                  >
                    {quiz.mode === 'LIVE' ? <Radio size={13} /> : <Clock3 size={13} />} {selectedQuiz === quiz.id ? 'Monitoring' : 'Open Monitor'}
                  </button>
                  <button
                    className="button button-secondary"
                    style={{ fontSize: '12.5px', padding: '6px 10px' }}
                    title="Edit Quiz"
                    disabled={quiz.status === 'ACTIVE'}
                    onClick={() => void startEdit(quiz)}
                  >
                    <Pencil size={13} /> Edit Studio
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'nowrap', width: '100%' }}>
                  <button
                    className="button button-secondary"
                    style={{ flex: '1 1 auto', fontSize: '12px', padding: '6px 8px', whiteSpace: 'nowrap' }}
                    title="View Student Results"
                    onClick={() => {
                      setSelectedQuiz(quiz.id);
                      document.dispatchEvent(new CustomEvent('open-results', { detail: quiz.id }));
                    }}
                  >
                    <BarChart3 size={13} /> Results ({quiz._count?.attempts ?? 0})
                  </button>

                  <button
                    className="icon-button danger-hover"
                    title="Delete Quiz"
                    style={{ padding: '6px 8px', height: '30px', minWidth: '32px', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={async () => {
                      if (!window.confirm(`Delete "${quiz.title}" and all its results?`)) return;
                      try {
                        await api(`/api/quizzes/${quiz.id}`, { method: 'DELETE' });
                        setNotice('Quiz deleted.');
                        await refresh();
                      } catch (cause) {
                        setNotice(cause instanceof Error ? cause.message : 'Unable to delete quiz');
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StudentManager({ students, refresh, setNotice, onBackToClassroom }: { students: Student[]; refresh: () => Promise<void>; setNotice: (text: string) => void; onBackToClassroom?: () => void }) {
  const [name, setName] = useState('');
  const [createdPasskey, setCreatedPasskey] = useState('');
  const [createdStudentName, setCreatedStudentName] = useState('');
  const [visiblePasskeys, setVisiblePasskeys] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);

  async function addStudent(event: React.FormEvent) {
    event.preventDefault(); setCreating(true);
    try {
      const data = await api<{ student: { name: string }; passkey: string }>('/api/students', { method: 'POST', body: JSON.stringify({ name }) });
      setCreatedPasskey(data.passkey);
      setCreatedStudentName(data.student.name || name);
      setName('');
      await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to add student.'); }
    finally { setCreating(false); }
  }

  async function updateStudent(student: Student, action: 'disable' | 'enable' | 'reset') {
    try {
      const data = await api<{ passkey?: string }>(`/api/students/${student.id}`, { method: 'PATCH', body: JSON.stringify(action === 'reset' ? { resetPasskey: true } : { active: action === 'enable' }) });
      if (data.passkey) {
        setCreatedPasskey(data.passkey);
        setCreatedStudentName(student.name);
      }
      setNotice(action === 'reset' ? `New 6-character passkey created for ${student.name}.` : `Student ${action === 'disable' ? 'disabled' : 'enabled'}.`);
      await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to update student.'); }
  }

  async function renameStudent(student: Student) {
    const name = window.prompt('Student name', student.name)?.trim();
    if (!name || name === student.name) return;
    try { await api(`/api/students/${student.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await refresh(); setNotice('Student name updated.'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to update student name.'); }
  }

  async function removeStudent(student: Student) {
    if (!window.confirm(`Remove ${student.name} and their attempt history?`)) return;
    try { await api(`/api/students/${student.id}`, { method: 'DELETE' }); await refresh(); setNotice('Student removed.'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to remove student.'); }
  }

  async function togglePasskeyVisibility(student: Student) {
    if (!student.passkey) {
      await updateStudent(student, 'reset');
    }
    setVisiblePasskeys((prev) => ({ ...prev, [student.id]: !prev[student.id] }));
  }

  return (
    <section className="view-enter">
      <div className="page-heading">
        <div>
          <span className="overline">Your people</span>
          <h1>Students.</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {onBackToClassroom && (
            <button
              className="button button-secondary"
              onClick={onBackToClassroom}
            >
              <ArrowLeft size={16} /> Back to Classroom
            </button>
          )}
          <span className="student-total"><Users size={16} /> {students.length} students</span>
        </div>
      </div>
      <div className="student-layout"><div className="roster-panel"><div className="panel-heading"><div><h2>List Of Students</h2><p>Manage student access and passkeys</p></div><button className="icon-button" title="Refresh students" onClick={() => void refresh()}><RefreshCw size={16} /></button></div>{students.length ? <div className="roster-list">{students.map((student, index) => {
        const isShown = Boolean(visiblePasskeys[student.id]);
        const passkeyVal = student.passkey || '';
        return (
          <div className={`roster-row ${!student.active ? 'inactive-row' : ''}`} key={student.id}>
            <div className={`avatar avatar-roster avatar-color-${index % 4}`}>{student.name.slice(0, 1).toUpperCase()}</div>
            <div className="roster-name">
              <strong>{student.name}</strong>
              <span>{student._count.attempts} quiz attempts · {student.active ? 'Active' : 'Access paused'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', fontSize: '13px' }}>
                <span className="muted">Passkey:</span>
                <code style={{ fontStyle: 'normal', fontWeight: 'bold', letterSpacing: isShown ? '2px' : '1px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '6px' }}>
                  {isShown ? (passkeyVal || '••••••') : '••••••'}
                </code>
                <button type="button" className="text-button" style={{ fontSize: '12px', padding: 0, color: '#047857' }} onClick={() => void togglePasskeyVisibility(student)}>
                  {isShown ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="text-button" style={{ fontSize: '12px', padding: 0, color: '#059669' }} onClick={async () => {
                  let key = student.passkey;
                  if (!key) {
                    const data = await api<{ passkey?: string }>(`/api/students/${student.id}`, { method: 'PATCH', body: JSON.stringify({ resetPasskey: true }) });
                    key = data.passkey || '';
                    await refresh();
                  }
                  void navigator.clipboard?.writeText(key);
                  setNotice(`Copied ${student.name}'s passkey.`);
                }}>
                  <Copy size={12} /> Copy
                </button>
              </div>
            </div>
            <div className="roster-actions">
              <button className="icon-button" title="Edit student name" aria-label={`Edit ${student.name}`} onClick={() => void renameStudent(student)}><Pencil size={15} /></button>
              <button className="icon-button" title="Generate a new passkey" aria-label={`Reset ${student.name}'s passkey`} onClick={() => void updateStudent(student, 'reset')}><RefreshCw size={15} /></button>
              <button className="icon-button" title={student.active ? 'Pause access' : 'Restore access'} aria-label={`${student.active ? 'Disable' : 'Enable'} ${student.name}`} onClick={() => void updateStudent(student, student.active ? 'disable' : 'enable')}>{student.active ? <UserX size={15} /> : <UserCheck size={15} />}</button>
              <button className="icon-button danger-hover" title="Remove student" aria-label={`Delete ${student.name}`} onClick={() => void removeStudent(student)}><Trash2 size={15} /></button>
            </div>
          </div>
        );
      })}</div> : <div className="roster-empty">No students yet. Add your first student to get started.</div>}</div>
        <aside className="add-student-panel"><span className="overline">Add to your class</span><h2>A name and a passkey.</h2><form onSubmit={addStudent} className="form-stack" style={{ marginBottom: '24px' }}><label className="field"><span>Student name</span><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Maya Chen" /></label><button className="button button-primary button-wide" disabled={creating}>{creating ? 'Creating...' : <><Plus size={16} /> Add student</>}</button></form>
          {createdPasskey && (
            <div className="passkey-reveal" style={{ marginTop: '16px', marginBottom: '20px', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span>Passkey for <strong>{createdStudentName || 'Student'}</strong></span>
                <button className="icon-button quiet" type="button" title="Dismiss" onClick={() => setCreatedPasskey('')}><X size={15} /></button>
              </div>
              <div style={{ marginTop: '6px', marginBottom: '4px' }}>
                <strong style={{ fontSize: '28px', letterSpacing: '3px', fontFamily: 'monospace, sans-serif' }}>
                  {createdPasskey}
                </strong>
              </div>
              <small>Short 6-character passkey. Share it with the student.</small>
              <div style={{ marginTop: '10px' }}>
                <button type="button" className="text-button" onClick={() => { void navigator.clipboard?.writeText(createdPasskey); setNotice('Passkey copied.'); }}>
                  <Copy size={14} /> Copy passkey
                </button>
              </div>
            </div>
          )}
          <div className="privacy-callout"><ShieldCheck size={16} /><span>Passkeys are private to each student. Their answers are never shown to other students.</span></div></aside>
      </div>
    </section>);
}

function ResultsPanel({ quizzes, selectedQuiz, setSelectedQuiz, results, distribution, onExport }: { quizzes: Quiz[]; selectedQuiz: string; setSelectedQuiz: (id: string) => void; results: Result[]; distribution: { question: string; options: { text: string; correct: boolean; count: number }[] }[]; onExport: () => void }) {
  const quiz = quizzes.find((entry) => entry.id === selectedQuiz);
  const submitted = results.filter((result) => result.status === 'SUBMITTED');
  const average = submitted.length ? Math.round(submitted.reduce((sum, result) => sum + (result.score ?? 0) / Math.max(1, result.totalMarks) * 100, 0) / submitted.length) : 0;
  const [expanded, setExpanded] = useState('');
  const [showStudentScores, setShowStudentScores] = useState(true);
  const [showAnswerPatterns, setShowAnswerPatterns] = useState(true);

  return <section className="view-enter"><div className="page-heading"><div><span className="overline">What your class knows</span><h1>Results.</h1><p>Scores, individual answers and question-by-question patterns.</p></div><div className="result-heading-actions"><label className="select-wrap"><select value={selectedQuiz} onChange={(event) => setSelectedQuiz(event.target.value)}><option value="">Choose a quiz...</option>{quizzes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={15} /></label><button className="button button-secondary" onClick={onExport} disabled={!results.length}><Download size={16} /> Export CSV</button></div></div>{quiz ? <><div className="results-metrics"><Metric label="Students started" value={results.length} icon={<Users size={17} />} tint="sage" /><Metric label="Submitted" value={submitted.length} icon={<CheckCircle2 size={17} />} tint="blue" /><Metric label="Class average" value={`${average}%`} icon={<BarChart3 size={17} />} tint="coral" /></div><div className="results-layout">
    <div className="results-table-panel">
      <div className="panel-heading panel-heading-toggle" onClick={() => setShowStudentScores((prev) => !prev)}>
        <div>
          <h2>Student scores</h2>
          <p>{quiz.title} · {results.length} participants</p>
        </div>
        <div className="toggle-arrow" title={showStudentScores ? 'Hide student scores' : 'Show student scores'}>
          {showStudentScores ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </div>
      {showStudentScores && (
        results.length ? <div className="results-list">{results.map((result, index) => <div className="result-student" key={result.id}><button className="result-summary" onClick={() => setExpanded(expanded === result.id ? '' : result.id)}><span className={`avatar avatar-roster avatar-color-${index % 4}`}>{result.name.slice(0, 1).toUpperCase()}</span><span className="result-name"><strong>{result.name}</strong><small>{result.status === 'SUBMITTED' ? 'Submitted' : 'In progress'}</small></span><strong className="result-score">{result.score === null ? '—' : `${result.score} / ${result.totalMarks}`}</strong><ChevronDown size={16} className={expanded === result.id ? 'rotate-chevron' : ''} /></button>{expanded === result.id && <div className="answer-review">{result.answers.length ? result.answers.map((answer, answerIndex) => <div className="answer-review-row" key={answerIndex}><span className={`answer-mark ${answer.correct ? 'mark-correct' : 'mark-wrong'}`}>{answer.correct ? <Check size={13} /> : <X size={13} />}</span><div><strong>{answer.question}</strong><span>{answer.response} · {answer.correct ? `${answer.marks} point${answer.marks === 1 ? '' : 's'}` : 'Incorrect'}</span></div></div>) : <span className="muted">No answers saved.</span>}</div>}</div>)}</div> : <div className="roster-empty">No one has joined this quiz yet.</div>
      )}
    </div>

    <div className="distribution-panel">
      <div className="panel-heading panel-heading-toggle" onClick={() => setShowAnswerPatterns((prev) => !prev)}>
        <div>
          <h2>Answer patterns</h2>
          <p>Responses across the class</p>
        </div>
        <div className="toggle-arrow" title={showAnswerPatterns ? 'Hide answer patterns' : 'Show answer patterns'}>
          {showAnswerPatterns ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </div>
      {showAnswerPatterns && (
        distribution.length ? distribution.map((question, index) => { const count = question.options.reduce((sum, option) => sum + option.count, 0); return <div className="result-distribution" key={index}><div className="result-distribution-title"><span>Q{index + 1}</span><strong>{question.question}</strong></div>{question.options.map((option, optionIndex) => <div className="result-option" key={optionIndex}><div><span>{option.text}</span><strong>{option.count}</strong></div><div className="bar-track"><div className={`bar-fill ${option.correct ? 'bar-correct' : ''}`} style={{ width: `${count ? option.count / count * 100 : 0}%` }} /></div></div>)}</div>; }) : <div className="roster-empty">Question patterns will appear here.</div>
      )}
    </div>
  </div></> : <div className="empty-state"><span className="empty-icon"><BarChart3 size={22} /></span><h3>Choose a quiz to see its story.</h3><p>Individual scores and response patterns will appear here.</p></div>}</section>;
}

function StudentApp({ user, onSignOut, notice, setNotice }: { user: User; onSignOut: () => void; notice: string; setNotice: (text: string) => void }) {
  const [tab, setTab] = useState<'open' | 'quiz_history' | 'paper_history'>('open');
  const [quizzes, setQuizzes] = useState<StudentQuiz[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<ActiveQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const submittedRef = useRef(false);

  async function joinQuiz(quizId: string) {
    setError('');
    try {
      sessionStorage.setItem('activeQuizId', quizId);
      const data = await api<{ quiz: ActiveQuiz }>(`/api/student/quizzes/${quizId}`);
      setActiveQuiz(data.quiz);
      setAnswers(Object.fromEntries((data.quiz.attempt?.answers ?? []).map((answer) => [answer.questionId, answer.optionId])));
      setQuestionIndex(data.quiz.currentQuestionIndex);
      submittedRef.current = data.quiz.attempt?.status === 'SUBMITTED';
    } catch (cause) {
      sessionStorage.removeItem('activeQuizId');
      setError(cause instanceof Error ? cause.message : 'Unable to join this quiz.');
    }
  }

  async function loadQuizzes() {
    setLoading(true);
    try {
      const data = await api<{ quizzes: StudentQuiz[] }>('/api/student/quizzes');
      setQuizzes(data.quizzes);
      const savedId = sessionStorage.getItem('activeQuizId');
      const inProgress = savedId
        ? data.quizzes.find((q) => q.id === savedId && q.attempt?.status === 'IN_PROGRESS' && q.status === 'ACTIVE')
        : data.quizzes.find((q) => q.attempt?.status === 'IN_PROGRESS' && q.status === 'ACTIVE');
      if (inProgress && !activeQuiz) {
        void joinQuiz(inProgress.id);
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load quizzes.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadQuizzes(); }, []);
  useEffect(() => {
    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socket.on('quiz:lobby_updated', () => {
      void api<{ quizzes: StudentQuiz[] }>('/api/student/quizzes').then((data) => setQuizzes(data.quizzes)).catch(() => undefined);
    });
    return () => { socket.disconnect(); };
  }, []);
  useEffect(() => {
    if (activeQuiz) return;
    const timer = window.setInterval(() => {
      void api<{ quizzes: StudentQuiz[] }>('/api/student/quizzes').then((data) => setQuizzes(data.quizzes)).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeQuiz?.id]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer); } }, [notice]);

  const activeQuizRef = useRef<ActiveQuiz | null>(null);
  activeQuizRef.current = activeQuiz;

  useEffect(() => {
    const currentQuiz = activeQuizRef.current;
    if (!currentQuiz || currentQuiz.status !== 'ACTIVE') return;
    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('watch:quiz', currentQuiz.id));
    socket.on('quiz:state', (state: { status: Status; currentQuestionIndex: number; currentAnswerRevealed: boolean; questionCount?: number; totalMarks?: number; question: Question | null }) => {
      const liveId = activeQuizRef.current?.id;
      if (state.status === 'CLOSED' && liveId) {
        sessionStorage.removeItem('activeQuizId');
        void api<{ quiz: ActiveQuiz }>(`/api/student/quizzes/${liveId}`).then(({ quiz }) => {
          setActiveQuiz(quiz);
          if (quiz.attempt?.answers) {
            setAnswers(Object.fromEntries(quiz.attempt.answers.map((ans) => [ans.questionId, ans.optionId])));
          }
          submittedRef.current = quiz.attempt?.status === 'SUBMITTED';
        }).catch(() => undefined);
        void loadQuizzes();
        return;
      }
      if (activeQuizRef.current?.mode === 'LIVE') {
        setActiveQuiz((current) => {
          if (!current) return current;
          if (current.attempt?.status === 'SUBMITTED' || current.status === 'CLOSED') {
            return { ...current, status: state.status, currentQuestionIndex: state.currentQuestionIndex, currentAnswerRevealed: state.currentAnswerRevealed };
          }
          const questions = state.question ? [state.question] : current.questions;
          return {
            ...current,
            status: state.status,
            currentQuestionIndex: state.currentQuestionIndex,
            currentAnswerRevealed: state.currentAnswerRevealed,
            questionCount: state.questionCount ?? current.questionCount,
            totalMarks: state.totalMarks ?? current.totalMarks,
            questions
          };
        });
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [activeQuiz?.id, activeQuiz?.status]);

  useEffect(() => {
    if (!activeQuiz) return;
    const isFinished = activeQuiz.attempt?.status === 'SUBMITTED' || activeQuiz.status === 'CLOSED';
    const hasIncompleteQuestions = isFinished && activeQuiz.questionCount && activeQuiz.questions.length < activeQuiz.questionCount;
    if (isFinished && (hasIncompleteQuestions || (activeQuiz.questions.length <= 1 && (activeQuiz.questionCount ?? 0) > 1))) {
      void api<{ quiz: ActiveQuiz }>(`/api/student/quizzes/${activeQuiz.id}`).then(({ quiz }) => {
        setActiveQuiz(quiz);
        if (quiz.attempt?.answers) {
          setAnswers((prev) => ({
            ...prev,
            ...Object.fromEntries(quiz.attempt!.answers.map((ans) => [ans.questionId, ans.optionId]))
          }));
        }
      }).catch(() => undefined);
    }
  }, [activeQuiz?.id, activeQuiz?.attempt?.status, activeQuiz?.status, activeQuiz?.questions.length, activeQuiz?.questionCount]);

  useEffect(() => {
    if (!activeQuiz?.attempt?.deadlineAt || activeQuiz.attempt.status !== 'IN_PROGRESS') { setRemaining(null); return; }
    const update = () => setRemaining(Math.max(0, Math.ceil((new Date(activeQuiz.attempt!.deadlineAt!).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeQuiz?.attempt?.deadlineAt, activeQuiz?.attempt?.status]);

  const currentQuestion = activeQuiz?.mode === 'LIVE' ? activeQuiz.questions[0] : activeQuiz?.questions[questionIndex];
  const isSubmitted = activeQuiz?.attempt?.status === 'SUBMITTED';

  async function saveAnswer(questionId: string, optionId: string) {
    if (!activeQuiz || isSubmitted) return;
    setAnswers((current) => ({ ...current, [questionId]: optionId }));
    setSaving(true);
    try { await api(`/api/student/quizzes/${activeQuiz.id}/answers`, { method: 'PUT', body: JSON.stringify({ questionId, optionId }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Your answer could not be saved.'); }
    finally { setSaving(false); }
  }

  async function submitQuiz(skipConfirm = false) {
    if (!activeQuiz || submitting || submittedRef.current) return;
    if (!skipConfirm && !window.confirm('Do you want to submit the quiz?')) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await api<{ score: number | null }>(`/api/student/quizzes/${activeQuiz.id}/submit`, { method: 'POST' });
      const data = await api<{ quiz: ActiveQuiz }>(`/api/student/quizzes/${activeQuiz.id}`);
      setActiveQuiz(data.quiz);
      if (data.quiz.attempt?.answers) {
        setAnswers((prev) => ({
          ...prev,
          ...Object.fromEntries(data.quiz.attempt!.answers.map((ans) => [ans.questionId, ans.optionId]))
        }));
      }
      await loadQuizzes();
    } catch (cause) { submittedRef.current = false; setError(cause instanceof Error ? cause.message : 'Unable to submit your quiz.'); }
    finally { setSubmitting(false); }
  }

  useEffect(() => { if (remaining === 0 && activeQuiz?.mode === 'SELF_PACED' && !isSubmitted) void submitQuiz(true); }, [remaining, activeQuiz?.mode, isSubmitted]);

  const isFinished = activeQuiz?.attempt?.status === 'SUBMITTED' || activeQuiz?.status === 'CLOSED';
  const openQuizzes = quizzes.filter((q) => q.status === 'ACTIVE' && q.attempt?.status !== 'SUBMITTED');
  const historyQuizzes = quizzes.filter((q) => q.attempt?.status === 'SUBMITTED' || (q.status === 'CLOSED' && q.attempt !== null));

  if (activeQuiz) {
    const questionList = activeQuiz.questions;
    const total = activeQuiz.mode === 'LIVE' ? Math.max(activeQuiz.currentQuestionIndex + 1, questionList.length) : questionList.length;
    const totalPossibleMarks = (activeQuiz.totalMarks && activeQuiz.totalMarks > 0)
      ? activeQuiz.totalMarks
      : activeQuiz.questions.reduce((sum, q) => sum + (q.marks ?? 1), 0);

    return <main className="student-shell"><header className="student-topbar"><div className="student-brand"><span className="brand-mark"><BookOpenCheck size={18} /></span><span>LiveQuiz</span></div><div className="student-top-right"><span className="student-name"><span className="avatar avatar-small">{user.name?.slice(0, 1).toUpperCase()}</span>{user.name}</span><button className="button button-secondary" style={{ fontSize: '13px', padding: '5px 12px', minHeight: '34px', gap: '6px' }} onClick={() => { setActiveQuiz(null); sessionStorage.removeItem('activeQuizId'); void loadQuizzes(); }}><ArrowLeft size={14} /> Back to Classroom</button></div></header>
      <div className="student-quiz-wrap">{isFinished ? (
        <div className="student-review-shell">
          <div className="submitted-card review-header-card">
            <div className="submitted-icon"><Check size={28} /></div>
            <span className="overline">Quiz Results</span>
            <h1>{activeQuiz.title}</h1>
            <p>{activeQuiz.status === 'CLOSED' ? 'This quiz has been closed by your teacher.' : 'Here is your performance breakdown.'}</p>
            {activeQuiz.showResults && activeQuiz.attempt?.score !== null && activeQuiz.attempt?.score !== undefined && (
              <div className="score-display">
                <strong>{activeQuiz.attempt.score}</strong>
                <span>/ {totalPossibleMarks} {totalPossibleMarks === 1 ? 'point' : 'points'}</span>
              </div>
            )}
          </div>

          <div className="student-review-list">
            <h3 style={{ font: '700 22px Fredoka, sans-serif', color: 'var(--ink)', margin: '32px 0 16px' }}>Question Breakdown</h3>
            {activeQuiz.questions.map((question, qIndex) => {
              const studentOptionId = answers[question.id ?? ''];
              const studentOption = question.options.find((o) => o.id === studentOptionId);
              const isStudentCorrect = studentOption?.isCorrect;

              return (
                <div key={question.id ?? qIndex} className={`review-question-card ${isStudentCorrect ? 'review-correct' : 'review-wrong'}`}>
                  <div className="review-question-header">
                    <span className="review-q-num">Q{qIndex + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong>{question.prompt}</strong>
                        <QuestionTypeBadge type={question.type} />
                      </div>
                    </div>
                    <span className={`review-points-badge ${isStudentCorrect ? 'pts-correct' : 'pts-wrong'}`}>
                      {isStudentCorrect ? `+${question.marks} pt` : `0 / ${question.marks} pts`}
                    </span>
                  </div>

                  {question.imageUrl && (
                    <div className="question-image-box" style={{ marginTop: '10px' }}>
                      <img src={question.imageUrl} alt="Question diagram" className="question-image" />
                    </div>
                  )}

                  <div className="review-options-list">
                    {question.options.map((option, optIndex) => {
                      const isChosen = studentOptionId === option.id;
                      const isOptionCorrect = Boolean(option.isCorrect);

                      let optionClass = 'review-option-item';
                      if (isChosen && isOptionCorrect) optionClass += ' choice-correct';
                      else if (isChosen && !isOptionCorrect) optionClass += ' choice-wrong';
                      else if (isOptionCorrect) optionClass += ' answer-key-correct';

                      return (
                        <div key={option.id ?? optIndex} className={optionClass}>
                          <span className="student-option-letter">{String.fromCharCode(65 + optIndex)}</span>
                          <span style={{ flex: 1 }}>{option.text}</span>
                          {isChosen && (
                            <span className={`choice-badge ${isOptionCorrect ? 'badge-good' : 'badge-bad'}`}>
                              {isOptionCorrect ? 'Your answer (Correct)' : 'Your answer (Incorrect)'}
                            </span>
                          )}
                          {!isChosen && isOptionCorrect && (
                            <span className="choice-badge badge-good"><Check size={13} /> Correct answer</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '32px' }}>
            <button className="button button-primary" onClick={() => { setActiveQuiz(null); sessionStorage.removeItem('activeQuizId'); void loadQuizzes(); }}>
              Return to Classroom
            </button>
          </div>
        </div>
      ) : <>
        <div className="student-quiz-heading"><div><span className="overline">{activeQuiz.mode === 'LIVE' ? <><i className="live-dot" /> Live classroom</> : activeQuiz.timeLimitSeconds !== null ? 'Timed practice' : 'Self-paced practice'}</span><h1>{activeQuiz.title}</h1></div>{activeQuiz.mode === 'SELF_PACED' && activeQuiz.timeLimitSeconds !== null && <div className={`timer-chip ${remaining !== null && remaining < 60 ? 'timer-warning' : ''}`}><Clock3 size={16} /><span>{remaining === null ? '--:--' : `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`}</span></div>}</div>
        <div className="student-progress"><span>Question {activeQuiz.mode === 'LIVE' ? activeQuiz.currentQuestionIndex + 1 : questionIndex + 1} <i>of {activeQuiz.mode === 'LIVE' ? total : questionList.length}</i></span><div className="progress-track"><div style={{ width: `${(activeQuiz.mode === 'LIVE' ? (activeQuiz.currentQuestionIndex + 1) / total : (questionIndex + 1) / questionList.length) * 100}%` }} /></div><span className="saved-label">{saving ? 'Saving...' : answers[currentQuestion?.id ?? ''] ? 'Answer saved' : 'Not answered'}</span></div>
        {currentQuestion ? <div className="student-question-card">
          <div className="question-card-top">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              QUESTION {String(activeQuiz.mode === 'LIVE' ? activeQuiz.currentQuestionIndex + 1 : questionIndex + 1).padStart(2, '0')}
              <QuestionTypeBadge type={currentQuestion.type} />
            </span>
            <span>{currentQuestion.marks} point{currentQuestion.marks === 1 ? '' : 's'}</span>
          </div>

          <h2>{currentQuestion.prompt}</h2>

          {currentQuestion.imageUrl && (
            <div className="question-image-box">
              <img src={currentQuestion.imageUrl} alt="Question diagram" className="question-image" />
            </div>
          )}

          {currentQuestion.type === 'FILL_BLANK' && (
            <div className="callout-box fb-callout">
              <PenTool size={16} /> <span>Select the answer choice below to complete the blank:</span>
            </div>
          )}

          {currentQuestion.type === 'SOLVE' && (
            <div className="callout-box solve-callout">
              <Calculator size={16} /> <span>Solve & Select your answer choice:</span>
            </div>
          )}

          <div className={`student-options ${currentQuestion.type === 'TRUE_FALSE' ? 'options-grid-tf' : ''}`}>
            {currentQuestion.options.map((option, index) => {
              const chosen = answers[currentQuestion.id ?? ''] === option.id;
              const correct = Boolean(option.isCorrect);
              return <button key={option.id ?? index} className={`student-option ${chosen ? 'option-selected' : ''} ${activeQuiz.currentAnswerRevealed && correct ? 'option-revealed' : ''}`} onClick={() => void saveAnswer(currentQuestion.id!, option.id!)} disabled={activeQuiz.currentAnswerRevealed || saving}><span className="student-option-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}</span>{chosen && <span className="option-check"><Check size={15} /></span>}{activeQuiz.currentAnswerRevealed && correct && <span className="correct-label">Correct</span>}</button>;
            })}
          </div>
          {activeQuiz.currentAnswerRevealed && <div className="answer-revealed-note"><CheckCircle2 size={15} /> Your teacher revealed the answer</div>}
        </div> : <div className="waiting-card"><div className="waiting-pulse"><Radio size={22} /></div><h2>You're in.</h2><p>Your teacher will bring up the first question in a moment.</p><span className="waiting-label"><i /> Waiting for the teacher</span></div>}
        {activeQuiz.mode === 'SELF_PACED' ? <><div className="question-jump"><span>Jump to</span>{questionList.map((question, index) => <button className={`${questionIndex === index ? 'jump-current' : ''} ${answers[question.id ?? ''] ? 'jump-answered' : ''}`} key={question.id ?? index} onClick={() => setQuestionIndex(index)}>{index + 1}</button>)}<span className="jump-legend"><i /> Answered</span></div><div className="student-nav"><button className="button button-secondary" onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}><ArrowLeft size={16} /> Previous</button>{questionIndex < questionList.length - 1 ? <button className="button button-primary" onClick={() => setQuestionIndex(Math.min(questionList.length - 1, questionIndex + 1))}>Next question <ArrowRight size={16} /></button> : <button className="button button-primary" onClick={() => void submitQuiz()} disabled={submitting || saving}>{submitting ? 'Submitting...' : <>Submit quiz <Send size={15} /></>}</button>}</div></> : <div className="live-student-footer"><span><i className="live-dot" /> Your teacher controls the next question</span><span>Your answer is saved automatically</span></div>}
      </>}{error && <div className="inline-error student-error" role="alert">{error}<button onClick={() => setError('')}><X size={14} /></button></div>}</div><footer className="student-footer">Take a breath. You’ve got this.</footer></main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark"><BookOpenCheck size={19} /></span>
          <span>LiveQuiz</span>
          <span className="brand-dot" />
        </div>
        <div className="sidebar-label">STUDENT DASHBOARD</div>
        <nav className="side-nav" aria-label="Student navigation">
          <NavItem
            active={tab === 'open'}
            icon={<BookOpenCheck size={17} />}
            label="Open Classroom"
            count={openQuizzes.length}
            onClick={() => setTab('open')}
          />
          <NavItem
            active={tab === 'quiz_history'}
            icon={<Clock3 size={17} />}
            label="Quiz History"
            count={historyQuizzes.length}
            onClick={() => setTab('quiz_history')}
          />
          <NavItem
            active={tab === 'paper_history'}
            icon={<FileText size={17} />}
            label="Question Papers History"
            onClick={() => setTab('paper_history')}
          />
        </nav>
        <div className="sidebar-bottom">
          <div className="teacher-profile">
            <div className="avatar avatar-green">{(user.name ?? 'S').slice(0, 1).toUpperCase()}</div>
            <div className="profile-copy">
              <strong>{user.name}</strong>
              <span>Student account</span>
            </div>
            <button className="icon-button quiet" title="Sign out" aria-label="Sign out" onClick={onSignOut}>
              <LogOut size={16} />
            </button>
          </div>
          <div className="sidebar-footnote">Learn at your own rhythm.</div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Your classroom <span>/</span> <strong>{tab === 'open' ? 'Open Classroom' : tab === 'quiz_history' ? 'Quiz History' : 'Question Papers History'}</strong>
          </div>
          <div className="topbar-actions">
            {tab !== 'open' ? (
              <button className="button button-secondary" style={{ fontSize: '13px', padding: '5px 12px', minHeight: '34px', gap: '6px' }} onClick={() => setTab('open')}>
                <ArrowLeft size={14} /> Back to Classroom
              </button>
            ) : (
              <button className="button button-secondary" style={{ fontSize: '13px', padding: '5px 12px', minHeight: '34px', gap: '6px' }} onClick={onSignOut}>
                <LogOut size={14} /> Logout
              </button>
            )}
            <span className="today-label">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
            <button className="icon-button" title="Refresh classroom" aria-label="Refresh classroom" onClick={() => void loadQuizzes()} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </header>

        <section className="student-home-content" style={{ maxWidth: '960px', padding: '32px 40px' }}>
          {error && <div className="inline-error" style={{ marginBottom: '20px' }}>{error}</div>}

          {loading ? (
            <div className="student-loading"><RefreshCw size={17} className="spin" /> Looking for your quizzes...</div>
          ) : (
            <>
              {/* 1. OPEN CLASSROOM (Open Quizzes & Open Question Papers) */}
              {tab === 'open' && (
                <>
                  <div className="student-welcome" style={{ marginBottom: '28px' }}>
                    <div>
                      <span className="overline">Your classroom</span>
                      <h1>Hi, {user.name?.split(' ')[0]}.</h1>
                      <p>Active quizzes and worksheets ready for you to take</p>
                    </div>
                    <div className="welcome-mark"><Sparkles size={25} /></div>
                  </div>

                  {/* Open Quizzes */}
                  <div className="student-quiz-list">
                    <div className="section-heading">
                      <div>
                        <h2>Open Quizzes and Worksheets</h2>
                        <p>Active quizzes ready for you to take</p>
                      </div>
                      <button className="icon-button" title="Refresh quizzes" onClick={() => void loadQuizzes()}>
                        <RefreshCw size={16} />
                      </button>
                    </div>
                    {openQuizzes.length ? (
                      openQuizzes.map((quiz) => (
                        <button className="student-quiz-tile" key={quiz.id} onClick={() => void joinQuiz(quiz.id)}>
                          <span className={`quiz-mode-icon ${quiz.mode === 'LIVE' ? 'mode-live' : 'mode-timed'}`}>
                            {quiz.mode === 'LIVE' ? <Radio size={20} /> : <Clock3 size={20} />}
                          </span>
                          <span className="student-tile-copy">
                            <strong>{quiz.title}</strong>{' '}
                            <span>{quiz.mode === 'LIVE' ? 'Live classroom · Teacher-led' : quiz.timeLimitSeconds !== null ? `${Math.round((quiz.timeLimitSeconds ?? 0) / 60)} minutes · Self-paced` : 'Self-paced · No time limit'}</span>
                          </span>
                          <span className="tile-start">
                            {quiz.attempt?.status === 'IN_PROGRESS' ? 'Continue' : 'Join'} <ArrowRight size={15} />
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="student-waiting-home">
                        <div className="waiting-pulse"><BookOpenCheck size={22} /></div>
                        <h2>No open quizzes right now.</h2>
                        <p>When your teacher opens a quiz, it will appear here.</p>
                      </div>
                    )}
                  </div>

                  {/* Open Question Papers & Worksheets */}
                  <div style={{ marginTop: '36px' }}>
                    <StudentOpenWorksheetsSection setNotice={setNotice} />
                  </div>
                </>
              )}

              {/* 2. QUIZ HISTORY */}
              {tab === 'quiz_history' && (
                <div className="student-quiz-list" style={{ marginTop: '0' }}>
                  <div className="section-heading">
                    <div>
                      <h2>Quiz History</h2>
                      <p>Your completed quizzes and scores</p>
                    </div>
                    <button className="icon-button" title="Refresh history" onClick={() => void loadQuizzes()}>
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  {historyQuizzes.length ? (
                    historyQuizzes.map((quiz) => (
                      <div className="student-quiz-tile history-tile" key={quiz.id} onClick={() => void joinQuiz(quiz.id)}>
                        <span className="quiz-mode-icon mode-history"><BookOpenCheck size={20} /></span>
                        <span className="student-tile-copy">
                          <strong>{quiz.title}</strong>{' '}
                          <span>{quiz.mode === 'LIVE' ? 'Live round' : 'Self-paced practice'} · {quiz.questionCount} question{quiz.questionCount === 1 ? '' : 's'}</span>
                        </span>
                        {quiz.attempt?.score !== null && quiz.attempt?.score !== undefined && (
                          <span className="history-score-pill">Score: <strong>{quiz.attempt.score}</strong> / {quiz.totalMarks ?? 0}</span>
                        )}
                        <span className="tile-start text-button" style={{ fontSize: '14px' }}>Review <ArrowRight size={14} /></span>
                      </div>
                    ))
                  ) : (
                    <div className="student-waiting-home">
                      <BookOpenCheck size={22} color="#94a3b8" />
                      <h2>No completed quizzes yet.</h2>
                      <p>When you complete live or self-paced quizzes, your results will appear here.</p>
                    </div>
                  )}
                </div>
              )}

              {/* 3. QUESTION PAPERS HISTORY */}
              {tab === 'paper_history' && (
                <div style={{ marginTop: '0' }}>
                  <StudentWorksheetHistorySection setNotice={setNotice} />
                </div>
              )}
            </>
          )}

          <div className="student-home-tip" style={{ marginTop: '40px' }}>
            <ShieldCheck size={16} /> Your work is private and saved as you go.
          </div>
        </section>
      </main>
    </div>
  );
}

/* ==========================================================================
   WORKBOOK ANSWER SHEETS & QUESTION PAPERS COMPONENTS
   ========================================================================== */

function WorksheetsPanel({ setNotice, onNavigateToAISettings }: { setNotice: (msg: string) => void; onNavigateToAISettings?: () => void }) {
  const [worksheets, setWorksheets] = useState<WorksheetPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPaper, setEditingPaper] = useState<Partial<WorksheetPaper> | null>(null);
  const [viewingPaper, setViewingPaper] = useState<WorksheetPaper | null>(null);
  const [checkingSubmissions, setCheckingSubmissions] = useState<WorksheetPaper | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);

  async function loadWorksheets() {
    setLoading(true);
    try {
      const data = await api<{ worksheets: WorksheetPaper[] }>('/api/worksheets');
      setWorksheets(data.worksheets);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to load worksheets.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadWorksheets(); }, []);

  async function savePaper(paper: Partial<WorksheetPaper>) {
    try {
      if (paper.id) {
        await api(`/api/worksheets/${paper.id}`, { method: 'PATCH', body: JSON.stringify(paper) });
        setNotice(paper.status === 'DRAFT' ? '📝 Question paper saved in Draft mode.' : '🚀 Question paper published!');
      } else {
        await api('/api/worksheets', { method: 'POST', body: JSON.stringify(paper) });
        setNotice(paper.status === 'DRAFT' ? '📝 Question paper saved in Draft mode.' : '🚀 Question paper created and published!');
      }
      setEditingPaper(null);
      await loadWorksheets();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save question paper.');
    }
  }

  async function deletePaper(id: string) {
    if (!window.confirm('Are you sure you want to delete this question paper and all student submissions?')) return;
    try {
      await api(`/api/worksheets/${id}`, { method: 'DELETE' });
      setNotice('Question paper deleted.');
      await loadWorksheets();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete paper.');
    }
  }

  if (showAIModal) {
    return (
      <section className="view-enter">
        <div className="page-heading compact-heading">
          <div>
            <button className="back-link" onClick={() => setShowAIModal(false)}>
              <ArrowLeft size={15} /> All Question Papers
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <span className="ai-badge" style={{ background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%)', color: '#0369a1', borderColor: '#7dd3fc' }}>
                <Sparkles size={15} /> AI Word-Style Generator
              </span>
            </div>
            <h1 style={{ marginTop: '4px' }}>Generate Question Paper</h1>
          </div>
        </div>

        <div className="ai-page-card" style={{ boxShadow: '0 10px 30px rgba(2, 132, 199, 0.08)' }}>
          <AIWorksheetModal
            onClose={() => setShowAIModal(false)}
            onGenerated={async () => {
              setShowAIModal(false);
              setNotice('✨ AI Question Paper generated and published!');
              await loadWorksheets();
            }}
            onNavigateToAISettings={onNavigateToAISettings}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="view-enter">
      <div className="page-heading">
        <div>
          <span className="overline">QUESTION PAPERS</span>
          <h1>Question Papers</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="button button-primary" onClick={() => setShowAIModal(true)}>
            <Sparkles size={16} /> Generate with AI
          </button>
          <button
            className="button button-secondary"
            onClick={() =>
              setEditingPaper({
                title: 'New Question Paper',
                subject: 'General Science',
                grade: 'Grade 6',
                totalMarks: 100,
                status: 'DRAFT',
                content: `
<div style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.5; color: #1e293b; width: 100%;">
  <div style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px;">
    <h1 style="margin: 0; font-size: 22px; text-transform: uppercase; color: #0f172a; letter-spacing: 0.5px;">SCIENCE WORKSHEET PAPER</h1>
    <h3 style="margin: 4px 0 0 0; color: #475569; font-weight: 500; font-size: 15px;">Grade 6 &nbsp;|&nbsp; Subject: General Science</h3>
    <div style="display: flex; justify-content: space-between; margin-top: 10px; font-weight: 600; font-size: 13px; color: #334155;">
      <span>Time Allowed: 60 Mins</span>
      <span>Total Marks: 100</span>
    </div>
  </div>

  <div style="background-color: #f8fafc; border-left: 4px solid #0284c7; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; border-radius: 4px;">
    <strong style="color: #0369a1;">Instructions for Students:</strong>
    <ul style="margin: 4px 0 0 18px; padding-left: 16px; color: #334155;">
      <li>Solve all questions neatly in your physical workbook.</li>
      <li>Write your full name, class, and clear question numbers on your answer sheet.</li>
      <li>Upload clear photos/scans of your answer sheets when completed.</li>
    </ul>
  </div>

  <div style="display: flex; flex-direction: column; gap: 12px;">
    <p style="margin: 0 0 12px 0; font-size: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px;">
      <strong>Q1.</strong> Explain the process of photosynthesis in plants. <span style="color: #64748b; font-size: 13px;">[10 Marks]</span>
    </p>

    <p style="margin: 0 0 12px 0; font-size: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px;">
      <strong>Q2.</strong> List three key differences between physical and chemical changes. <span style="color: #64748b; font-size: 13px;">[10 Marks]</span>
    </p>
  </div>
</div>`.trim(),
              })
            }
          >
            <Plus size={16} /> Create Word Paper
          </button>
        </div>
      </div>

      {loading ? (
        <div className="roster-empty">Loading question papers...</div>
      ) : worksheets.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><FileText size={26} /></span>
          <h3>No Question Papers created yet.</h3>
          <p>Create Word-style question papers for students to solve on physical paper and upload answer sheets.</p>
          <button className="button button-primary" onClick={() => setShowAIModal(true)}>
            <Sparkles size={16} /> Generate with AI
          </button>
        </div>
      ) : (
        <div className="worksheet-grid">
          {worksheets.map((paper) => (
            <div className="worksheet-card" key={paper.id}>
              <div>
                <div className="worksheet-card-meta">
                  <span className={`worksheet-badge ${paper.status === 'PUBLISHED' ? 'badge-published' : paper.status === 'ARCHIVED' ? 'badge-subject' : 'badge-draft'}`}>
                    {paper.status === 'ARCHIVED' ? '✓ COMPLETED' : paper.status}
                  </span>
                  {paper.subject && <span className="worksheet-badge badge-subject">{paper.subject}</span>}
                  {paper.grade && <span className="worksheet-badge badge-draft">{paper.grade}</span>}
                </div>
                <h3>{paper.title}</h3>
                <div className="worksheet-card-stats">
                  <span>Marks: <strong>{paper.totalMarks}</strong></span>
                  <span>Created: <strong>{new Date(paper.createdAt).toLocaleDateString()}</strong></span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="button button-secondary"
                    style={{ fontSize: '12.5px', padding: '6px 10px' }}
                    title="Edit in Question Paper Studio"
                    onClick={async () => {
                      const full = await api<{ worksheet: WorksheetPaper }>(`/api/worksheets/${paper.id}`);
                      setEditingPaper(full.worksheet);
                    }}
                  >
                    <Pencil size={13} /> Edit Studio
                  </button>
                  <button
                    className="button button-secondary"
                    style={{ fontSize: '12.5px', padding: '6px 10px' }}
                    onClick={() => setViewingPaper(paper)}
                  >
                    <Eye size={13} /> View Paper
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'nowrap', width: '100%' }}>
                  <button
                    className="button button-primary"
                    style={{ flex: '1 1 auto', fontSize: '12px', padding: '6px 8px', whiteSpace: 'nowrap' }}
                    onClick={async () => {
                      const full = await api<{ worksheet: WorksheetPaper }>(`/api/worksheets/${paper.id}`);
                      setCheckingSubmissions(full.worksheet);
                    }}
                  >
                    <CheckSquare size={13} /> Submissions ({paper._count?.submissions ?? 0})
                  </button>

                  {paper.status === 'PUBLISHED' && (
                    <button
                      className="button button-secondary"
                      style={{ flex: '1 1 auto', fontSize: '12px', padding: '6px 8px', color: '#047857', borderColor: '#a7f3d0', background: '#ecfdf5', whiteSpace: 'nowrap' }}
                      title="Mark all student answer sheet submissions complete"
                      onClick={async () => {
                        await api(`/api/worksheets/${paper.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'ARCHIVED' }),
                        });
                        setNotice('✓ Submissions marked complete for this question paper.');
                        await loadWorksheets();
                      }}
                    >
                      <CheckCircle2 size={13} color="#047857" /> Mark Complete
                    </button>
                  )}
                  {paper.status === 'ARCHIVED' && (
                    <button
                      className="button button-secondary"
                      style={{ flex: '1 1 auto', fontSize: '12px', padding: '6px 8px', whiteSpace: 'nowrap' }}
                      title="Re-open submissions for students"
                      onClick={async () => {
                        await api(`/api/worksheets/${paper.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'PUBLISHED' }),
                        });
                        setNotice('Submissions re-opened for students.');
                        await loadWorksheets();
                      }}
                    >
                      <RotateCcw size={13} /> Re-open
                    </button>
                  )}
                  {paper.status === 'DRAFT' && (
                    <button
                      className="button button-secondary"
                      style={{ flex: '1 1 auto', fontSize: '12px', padding: '6px 8px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff', whiteSpace: 'nowrap' }}
                      title="Publish question paper for students"
                      onClick={async () => {
                        await api(`/api/worksheets/${paper.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'PUBLISHED' }),
                        });
                        setNotice('🚀 Question paper published for students!');
                        await loadWorksheets();
                      }}
                    >
                      <Send size={13} color="#0284c7" /> Publish
                    </button>
                  )}
                  <button
                    className="icon-button danger-hover"
                    title="Delete Paper"
                    style={{ padding: '6px 8px', height: '30px', minWidth: '32px', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => void deletePaper(paper.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingPaper && (
        <WordDocEditorModal
          paper={editingPaper}
          onClose={() => setEditingPaper(null)}
          onSave={(updated) => void savePaper(updated)}
        />
      )}

      {viewingPaper && <PaperPreviewModal paper={viewingPaper} onClose={() => setViewingPaper(null)} />}

      {checkingSubmissions && (
        <WorksheetSubmissionsModal
          paper={checkingSubmissions}
          onClose={() => setCheckingSubmissions(null)}
          onRefresh={async () => {
            const full = await api<{ worksheet: WorksheetPaper }>(`/api/worksheets/${checkingSubmissions.id}`);
            setCheckingSubmissions(full.worksheet);
            await loadWorksheets();
          }}
          setNotice={setNotice}
        />
      )}
    </section>
  );
}

function WordDocEditorModal({
  paper,
  onClose,
  onSave,
}: {
  paper: Partial<WorksheetPaper>;
  onClose: () => void;
  onSave: (paper: Partial<WorksheetPaper>) => void;
}) {
  const [title, setTitle] = useState(paper.title || 'New Question Paper');
  const [subject, setSubject] = useState(paper.subject || 'Science');
  const [grade, setGrade] = useState(paper.grade || 'Grade 6');
  const [totalMarks, setTotalMarks] = useState(paper.totalMarks || 100);
  const [status, setStatus] = useState<'DRAFT' | 'PUBLISHED'>(paper.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED');
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgWidth, setImgWidth] = useState<string>('100%');
  const [imgHeight, setImgHeight] = useState<string>('auto');
  const [imgAlign, setImgAlign] = useState<'left' | 'center' | 'right'>('center');

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyImageStyle = (w: string, h: string, align: 'left' | 'center' | 'right') => {
    if (!selectedImg) return;
    const formattedWidth = w ? (w.endsWith('%') || w.endsWith('px') || w === 'auto' ? w : `${w}px`) : '100%';
    const formattedHeight = h ? (h.endsWith('%') || h.endsWith('px') || h === 'auto' ? h : `${h}px`) : 'auto';

    setImgWidth(formattedWidth);
    setImgHeight(formattedHeight);
    setImgAlign(align);

    selectedImg.style.width = formattedWidth;
    selectedImg.style.height = formattedHeight;
    selectedImg.style.display = 'block';

    if (align === 'center') {
      selectedImg.style.marginLeft = 'auto';
      selectedImg.style.marginRight = 'auto';
      selectedImg.style.float = 'none';
    } else if (align === 'left') {
      selectedImg.style.marginLeft = '0';
      selectedImg.style.marginRight = 'auto';
      selectedImg.style.float = 'none';
    } else if (align === 'right') {
      selectedImg.style.marginLeft = 'auto';
      selectedImg.style.marginRight = '0';
      selectedImg.style.float = 'none';
    }
  };

  const setupInsertedImage = () => {
    setTimeout(() => {
      if (!canvasRef.current) return;
      const imgs = canvasRef.current.querySelectorAll('img');
      if (imgs.length > 0) {
        const lastImg = imgs[imgs.length - 1] as HTMLImageElement;
        imgs.forEach((i) => i.classList.remove('img-selected'));
        lastImg.classList.add('img-selected');
        lastImg.style.display = 'block';
        lastImg.style.marginLeft = 'auto';
        lastImg.style.marginRight = 'auto';
        lastImg.style.maxWidth = '100%';
        setSelectedImg(lastImg);
        setImgWidth(lastImg.style.width || '100%');
        setImgHeight(lastImg.style.height || 'auto');
        setImgAlign('center');
      }
    }, 50);
  };

  const handleLocalImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file (PNG, JPG, SVG, WebP, etc.)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl && canvasRef.current) {
        canvasRef.current.focus();
        document.execCommand('insertImage', false, dataUrl);
        setupInsertedImage();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target && target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      if (canvasRef.current) {
        canvasRef.current.querySelectorAll('img').forEach((i) => i.classList.remove('img-selected'));
      }
      img.classList.add('img-selected');
      setSelectedImg(img);

      const styleW = img.style.width || (img.getAttribute('width') ? `${img.getAttribute('width')}px` : '100%');
      const styleH = img.style.height || (img.getAttribute('height') ? `${img.getAttribute('height')}px` : 'auto');
      setImgWidth(styleW);
      setImgHeight(styleH);

      const ml = img.style.marginLeft;
      const mr = img.style.marginRight;
      if (ml === 'auto' && mr === 'auto') {
        setImgAlign('center');
      } else if (ml === 'auto' && (mr === '0px' || mr === '0')) {
        setImgAlign('right');
      } else if ((ml === '0px' || ml === '0') && mr === 'auto') {
        setImgAlign('left');
      } else {
        setImgAlign('center');
      }
    } else {
      if (canvasRef.current) {
        canvasRef.current.querySelectorAll('img').forEach((i) => i.classList.remove('img-selected'));
      }
      setSelectedImg(null);
    }
  };

  useEffect(() => {
    if (canvasRef.current) {
      try {
        document.execCommand('defaultParagraphSeparator', false, 'p');
        document.execCommand('styleWithCSS', false, 'false');
      } catch {
        // ignore
      }
    }
  }, []);

  function execCmd(e: React.MouseEvent, command: string, value: string | undefined = undefined) {
    e.preventDefault();
    if (canvasRef.current) canvasRef.current.focus();
    try {
      document.execCommand('styleWithCSS', false, 'false');
      document.execCommand(command, false, value);
    } catch {
      // ignore
    }
  }

  function handleSave(targetStatus?: 'DRAFT' | 'PUBLISHED') {
    const finalStatus = targetStatus || status;
    const htmlContent = canvasRef.current?.innerHTML || paper.content || '';
    onSave({
      ...paper,
      title,
      subject,
      grade,
      totalMarks: Number(totalMarks),
      status: finalStatus,
      content: htmlContent,
    });
  }

  return createPortal(
    <div className="word-doc-modal-overlay">
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleLocalImageUpload}
      />
      <div className="word-doc-modal-container full-editor">
        <div className="word-doc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button className="button button-secondary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={onClose}>
              <ArrowLeft size={16} /> Back to Papers
            </button>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={20} color="#0284c7" /> Question Paper Studio
            </h3>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="button button-secondary" onClick={onClose}><X size={16} /> Cancel</button>
            <button className="button button-secondary" onClick={() => handleSave('DRAFT')}>
              <Save size={16} /> Save as Draft
            </button>
            <button className="button button-primary" onClick={() => handleSave('PUBLISHED')}>
              <Check size={16} /> Save & Publish Paper
            </button>
          </div>
        </div>

        <div className="word-doc-meta-bar">
          <div className="word-doc-meta-row">
            <label className="field compact-field title-field">
              <span>Paper Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Science Mid-Term Exam Paper" />
            </label>
            <label className="field compact-field">
              <span>Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Science" />
            </label>
            <label className="field compact-field">
              <span>Grade / Class</span>
              <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. Grade 6" />
            </label>
            <label className="field compact-field">
              <span>Total Marks</span>
              <input type="number" value={totalMarks} onChange={(e) => setTotalMarks(Number(e.target.value))} />
            </label>
            <label className="field compact-field">
              <span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
                <option value="PUBLISHED">Published</option>
                <option value="DRAFT">Draft</option>
              </select>
            </label>
          </div>
        </div>

        <div className="word-doc-toolbar">
          <button type="button" title="Bold" onMouseDown={(e) => execCmd(e, 'bold')}><b>B</b> Bold</button>
          <button type="button" title="Italic" onMouseDown={(e) => execCmd(e, 'italic')}><i>I</i> Italic</button>
          <button type="button" title="Underline" onMouseDown={(e) => execCmd(e, 'underline')}><u>U</u> Underline</button>
          <button type="button" title="H1 Title" onMouseDown={(e) => execCmd(e, 'formatBlock', '<h1>')}>H1 Title</button>
          <button type="button" title="H2 Section" onMouseDown={(e) => execCmd(e, 'formatBlock', '<h2>')}>H2 Section</button>
          <button type="button" title="H3 Subhead" onMouseDown={(e) => execCmd(e, 'formatBlock', '<h3>')}>H3 Subhead</button>
          <button type="button" title="Bullet List" onMouseDown={(e) => execCmd(e, 'insertUnorderedList')}>• Bullet List</button>
          <button type="button" title="Numbered List" onMouseDown={(e) => execCmd(e, 'insertOrderedList')}>1. Numbered</button>
          <button type="button" title="Line Divider" onMouseDown={(e) => execCmd(e, 'insertHorizontalRule')}>― Line Divider</button>
          <button
            type="button"
            title="Upload Image from Local System"
            onMouseDown={(e) => {
              e.preventDefault();
              fileInputRef.current?.click();
            }}
          >
            <UploadCloud size={14} /> Upload Local Image
          </button>
          <button
            type="button"
            title="Insert Image from Web URL"
            onMouseDown={(e) => {
              e.preventDefault();
              const url = window.prompt('Enter Image URL to insert:');
              if (url) {
                if (canvasRef.current) canvasRef.current.focus();
                document.execCommand('insertImage', false, url);
                setupInsertedImage();
              }
            }}
          >
            <Paperclip size={14} /> Image URL
          </button>
          <button type="button" title="Clear Formatting" onMouseDown={(e) => execCmd(e, 'removeFormat')}>Clear Format</button>
          <button type="button" className="btn-print" title="Print Preview" onClick={() => {
            if (canvasRef.current) printHtmlContent(canvasRef.current.innerHTML);
          }}><Printer size={14} /> Print Preview</button>
        </div>

        {selectedImg && (
          <div className="word-doc-image-toolbar">
            <div className="image-toolbar-label">
              <PenTool size={14} color="#0284c7" /> <strong>Image Format:</strong>
            </div>

            <div className="image-toolbar-group">
              <span>Width:</span>
              <button
                type="button"
                className={imgWidth === '25%' ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); applyImageStyle('25%', imgHeight, imgAlign); }}
              >
                25%
              </button>
              <button
                type="button"
                className={imgWidth === '50%' ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); applyImageStyle('50%', imgHeight, imgAlign); }}
              >
                50%
              </button>
              <button
                type="button"
                className={imgWidth === '75%' ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); applyImageStyle('75%', imgHeight, imgAlign); }}
              >
                75%
              </button>
              <button
                type="button"
                className={imgWidth === '100%' ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); applyImageStyle('100%', imgHeight, imgAlign); }}
              >
                100%
              </button>
              <input
                type="text"
                placeholder="e.g. 300px"
                value={imgWidth}
                onChange={(e) => applyImageStyle(e.target.value, imgHeight, imgAlign)}
                className="img-dim-input"
              />
            </div>

            <div className="image-toolbar-group">
              <span>Height:</span>
              <button
                type="button"
                className={imgHeight === 'auto' ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); applyImageStyle(imgWidth, 'auto', imgAlign); }}
              >
                Auto
              </button>
              <input
                type="text"
                placeholder="e.g. 200px"
                value={imgHeight}
                onChange={(e) => applyImageStyle(imgWidth, e.target.value, imgAlign)}
                className="img-dim-input"
              />
            </div>

            <div className="image-toolbar-group">
              <span>Align:</span>
              <button
                type="button"
                className={imgAlign === 'left' ? 'active' : ''}
                title="Align Left"
                onMouseDown={(e) => { e.preventDefault(); applyImageStyle(imgWidth, imgHeight, 'left'); }}
              >
                Left
              </button>
              <button
                type="button"
                className={imgAlign === 'center' ? 'active' : ''}
                title="Align Center"
                onMouseDown={(e) => { e.preventDefault(); applyImageStyle(imgWidth, imgHeight, 'center'); }}
              >
                🎯 Center
              </button>
              <button
                type="button"
                className={imgAlign === 'right' ? 'active' : ''}
                title="Align Right"
                onMouseDown={(e) => { e.preventDefault(); applyImageStyle(imgWidth, imgHeight, 'right'); }}
              >
                Right
              </button>
            </div>

            <div className="image-toolbar-group" style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                className="btn-delete-img"
                title="Delete Image"
                onClick={() => {
                  if (selectedImg) {
                    selectedImg.remove();
                    setSelectedImg(null);
                  }
                }}
              >
                <Trash2 size={13} /> Delete Image
              </button>
              <button
                type="button"
                className="btn-close-img-tool"
                onClick={() => {
                  if (canvasRef.current) {
                    canvasRef.current.querySelectorAll('img').forEach((i) => i.classList.remove('img-selected'));
                  }
                  setSelectedImg(null);
                }}
              >
                <X size={14} /> Done
              </button>
            </div>
          </div>
        )}

        <div className="word-doc-canvas-wrapper">
          <div
            ref={canvasRef}
            className="word-doc-canvas"
            contentEditable
            suppressContentEditableWarning
            onClick={handleCanvasClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                const sel = window.getSelection();
                const anchorNode = sel?.anchorNode;
                const parentElem = anchorNode ? (anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode as HTMLElement) : null;

                if (parentElem?.closest('li')) {
                  // Inside list item <li>, allow browser native bullet creation!
                  return;
                }

                e.preventDefault();
                try {
                  document.execCommand('insertParagraph', false, undefined);
                } catch {
                  document.execCommand('insertHTML', false, '<p><br></p>');
                }
              }
            }}
            dangerouslySetInnerHTML={{ __html: paper.content || '<p>Type your question paper here...</p>' }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

const WORKSHEET_SUBJECTS = [
  'Science',
  'General Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Mathematics',
  'Algebra',
  'Geometry',
  'Trigonometry',
  'English',
  'English Grammar & Literature',
  'Social Studies (SST)',
  'History',
  'Geography',
  'Civics / Political Science',
  'Economics',
  'Computer Science',
  'Information Technology (IT)',
  'Coding & AI',
  'Environmental Studies (EVS)',
  'Hindi',
  'Sanskrit',
  'Accountancy / Commerce',
  'Business Studies',
  'General Knowledge (GK)',
  'Moral Science & Ethics',
  'Physical Education',
  'Art & Design',
  'Other / Custom Subject',
];

function AIWorksheetModal({ onClose, onGenerated, onNavigateToAISettings }: { onClose: () => void; onGenerated: () => void; onNavigateToAISettings?: () => void }) {
  const [selectedSubject, setSelectedSubject] = useState('Science');
  const [customSubject, setCustomSubject] = useState('');
  const [grade, setGrade] = useState('Grade 6');
  const [topic, setTopic] = useState('');
  const [subtopics, setSubtopics] = useState('');
  const [questionCount, setQuestionCount] = useState(10);
  const [totalMarks, setTotalMarks] = useState(100);
  const [details, setDetails] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const provider = localStorage.getItem('livequiz_ai_provider') || 'auto';
  const apiKey = localStorage.getItem('livequiz_ai_key') || '';
  const activeSubject = selectedSubject === 'Other / Custom Subject' ? (customSubject.trim() || 'General') : selectedSubject;

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) { setError('Please enter a main topic.'); return; }
    if (selectedSubject === 'Other / Custom Subject' && !customSubject.trim()) {
      setError('Please enter your custom subject name.');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      await api('/api/worksheets/ai-generate', {
        method: 'POST',
        body: JSON.stringify({ subject: activeSubject, grade, topic, subtopics, questionCount, totalMarks, details, provider, apiKey: apiKey.trim() || undefined }),
      });
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI Generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <form onSubmit={generate} className="ai-form-grid">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px', color: '#0369a1', fontSize: '13.5px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} />
          <span>AI Engine Settings: <strong>{provider === 'gemini' ? 'Google Gemini AI' : provider === 'openai' ? 'ChatGPT (OpenAI)' : 'Auto Select'}</strong> {apiKey ? '(Custom API Key Active)' : '(Server Key)'}</span>
        </div>
        {onNavigateToAISettings && (
          <button type="button" className="text-button" style={{ fontSize: '12.5px', color: '#0284c7', fontWeight: 600, padding: 0 }} onClick={onNavigateToAISettings}>
            Configure AI Settings →
          </button>
        )}
      </div>

      {error && <div className="inline-error">{error}</div>}
      <div className="form-grid-2">
        <label className="field compact-field">
          <span>Subject</span>
          <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)}>
            {WORKSHEET_SUBJECTS.map((subj) => (
              <option key={subj} value={subj}>{subj}</option>
            ))}
          </select>
        </label>
        <label className="field compact-field">
          <span>Grade / Class</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>

      {selectedSubject === 'Other / Custom Subject' && (
        <label className="field compact-field">
          <span>Custom Subject Name <span className="required-star">*</span></span>
          <input
            value={customSubject}
            onChange={(e) => setCustomSubject(e.target.value)}
            placeholder="e.g. Astronomy, Statistics, French"
            required
          />
        </label>
      )}

      <label className="field compact-field">
        <span>Main Topic <span className="required-star">*</span></span>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Electricity, Cell Structure, Geometry" required />
      </label>

      <label className="field compact-field">
        <span>Sub-topics (Optional)</span>
        <input value={subtopics} onChange={(e) => setSubtopics(e.target.value)} placeholder="e.g. Circuits, Resistance, Ohm Law" />
      </label>

      <div className="form-grid-2">
        <label className="field compact-field">
          <span>Number of Questions</span>
          <select value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
            <option value={5}>5 Questions</option>
            <option value={10}>10 Questions</option>
            <option value={15}>15 Questions</option>
            <option value={20}>20 Questions</option>
            <option value={25}>25 Questions</option>
            <option value={30}>30 Questions</option>
          </select>
        </label>
        <label className="field compact-field">
          <span>Total Marks</span>
          <input type="number" value={totalMarks} onChange={(e) => setTotalMarks(Number(e.target.value))} />
        </label>
      </div>

      <label className="field compact-field">
        <span>Special Instructions for AI (Optional)</span>
        <textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. Include 2 problem solving questions and clear student instructions." />
      </label>

      <div className="compact-modal-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={generating}>
          {generating ? <><RefreshCw size={16} className="spin" /> Generating Paper...</> : <><Sparkles size={16} /> Generate Question Paper</>}
        </button>
      </div>
    </form>
  );
}

function WorksheetSubmissionsModal({
  paper,
  onClose,
  onRefresh,
  setNotice,
}: {
  paper: WorksheetPaper;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  setNotice: (msg: string) => void;
}) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [gradingState, setGradingState] = useState<Record<string, { score: number; remarks: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const submissions = paper.submissions || [];

  async function handleGrade(submissionId: string) {
    const state = gradingState[submissionId];
    if (!state) return;
    setSavingId(submissionId);
    try {
      await api(`/api/worksheets/submissions/${submissionId}/grade`, {
        method: 'PATCH',
        body: JSON.stringify({ score: Number(state.score), remarks: state.remarks }),
      });
      setNotice('Grade & remarks saved for student!');
      await onRefresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save grade.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteImages(submissionId: string, studentName: string) {
    if (!window.confirm(`Delete uploaded answer sheet images for ${studentName}? (The student's score and remarks will be retained).`)) return;
    try {
      await api(`/api/worksheets/submissions/${submissionId}/images`, { method: 'DELETE' });
      setNotice(`Uploaded answer sheet images deleted for ${studentName}.`);
      await onRefresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete images.');
    }
  }

  return (
    <div className="word-doc-modal-overlay">
      <div className="word-doc-modal-container" style={{ maxWidth: '900px' }}>
        <div className="word-doc-modal-header">
          <h3><CheckSquare size={20} color="#059669" /> Student Answer Sheet Submissions - {paper.title}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {paper.status === 'PUBLISHED' ? (
              <button
                className="button button-secondary"
                style={{ fontSize: '13px', padding: '6px 12px', color: '#047857', borderColor: '#a7f3d0', background: '#ecfdf5' }}
                title="Mark all student answer sheet submissions complete"
                onClick={async () => {
                  await api(`/api/worksheets/${paper.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: 'ARCHIVED' }),
                  });
                  setNotice('✓ Submissions marked complete for this question paper.');
                  await onRefresh();
                }}
              >
                <CheckCircle2 size={14} color="#047857" /> Mark Submissions Complete
              </button>
            ) : paper.status === 'ARCHIVED' ? (
              <span className="worksheet-badge badge-published" style={{ background: '#dcfce7', color: '#15803d' }}>
                <CheckCircle2 size={13} /> Submissions Completed
              </span>
            ) : null}
            <button className="icon-button quiet" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          <p style={{ margin: '0 0 20px 0', color: '#64748b' }}>
            Check students' uploaded workbook answer sheet photos, assign final scores with remarks, and delete answer sheet images after checking.
          </p>

          {submissions.length === 0 ? (
            <div className="roster-empty">No students have uploaded answer sheets for this paper yet.</div>
          ) : (
            submissions.map((sub) => {
              let images: string[] = [];
              try { images = JSON.parse(sub.images || '[]'); } catch { images = []; }
              const currentScore = gradingState[sub.id]?.score ?? sub.score ?? 0;
              const currentRemarks = gradingState[sub.id]?.remarks ?? sub.remarks ?? '';

              return (
                <div className="submission-detail-card" key={sub.id}>
                  <div className="submission-header">
                    <div>
                      <span className="student-name-tag">👤 {sub.student?.name || 'Student'}</span>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                        Submitted on {new Date(sub.submittedAt).toLocaleString()}
                        {sub.status === 'GRADED' && <span style={{ marginLeft: '10px', color: '#059669', fontWeight: 'bold' }}>✓ GRADED</span>}
                      </div>
                    </div>
                    {sub.score !== null && sub.score !== undefined && (
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#059669' }}>
                          {sub.score} / {paper.totalMarks}
                        </span>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>Final Score</div>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '13px', color: '#334155' }}>
                        Uploaded Answer Sheets ({images.length} Page{images.length === 1 ? '' : 's'}):
                      </strong>
                      {images.length > 0 && (
                        <button
                          className="button danger-hover"
                          style={{ fontSize: '12px', padding: '4px 8px' }}
                          onClick={() => void handleDeleteImages(sub.id, sub.student?.name || 'Student')}
                        >
                          <Trash2 size={13} /> Delete Answer Sheets After Checking
                        </button>
                      )}
                    </div>

                    {images.length === 0 ? (
                      <div style={{ fontStyle: 'italic', color: '#94a3b8', fontSize: '13px' }}>
                        No answer sheet images stored (or deleted after checking).
                      </div>
                    ) : (
                      <div className="image-preview-strip">
                        {images.map((imgUrl, idx) => (
                          <div className="image-preview-thumb" key={idx} onClick={() => setSelectedImage(imgUrl)} style={{ cursor: 'pointer' }}>
                            <img src={imgUrl} alt={`Page ${idx + 1}`} />
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', textAlign: 'center', padding: '2px' }}>
                              Page {idx + 1} (Click)
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grading-panel">
                    <h4>Teacher Assessment & Remarks</h4>
                    <div className="form-grid-2">
                      <label className="field compact-field">
                        <span>Final Score (Out of {paper.totalMarks})</span>
                        <input
                          type="number"
                          min={0}
                          max={paper.totalMarks}
                          value={currentScore}
                          onChange={(e) =>
                            setGradingState({
                              ...gradingState,
                              [sub.id]: { score: Number(e.target.value), remarks: currentRemarks },
                            })
                          }
                        />
                      </label>
                      <label className="field compact-field">
                        <span>Teacher Remarks / Feedback</span>
                        <input
                          value={currentRemarks}
                          onChange={(e) =>
                            setGradingState({
                              ...gradingState,
                              [sub.id]: { score: currentScore, remarks: e.target.value },
                            })
                          }
                          placeholder="e.g. Excellent work on Q1-Q3! Neat handwriting."
                        />
                      </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                      <button
                        className="button button-primary"
                        style={{ fontSize: '13px', padding: '6px 14px' }}
                        disabled={savingId === sub.id}
                        onClick={() => void handleGrade(sub.id)}
                      >
                        {savingId === sub.id ? 'Saving...' : <><Check size={14} /> Save Score & Remarks</>}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {selectedImage && (
        <div className="word-doc-modal-overlay" style={{ zIndex: 1050 }} onClick={() => setSelectedImage(null)}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <img src={selectedImage} alt="Answer sheet full view" style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }} />
            <button className="icon-button quiet" style={{ position: 'absolute', top: '-15px', right: '-15px', background: '#e11d48', color: '#fff', borderRadius: '50%' }} onClick={() => setSelectedImage(null)}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentOpenWorksheetsSection({ setNotice }: { setNotice: (msg: string) => void }) {
  const [worksheets, setWorksheets] = useState<WorksheetPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePaper, setActivePaper] = useState<WorksheetPaper | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ worksheets: WorksheetPaper[] }>('/api/worksheets');
      setWorksheets(data.worksheets);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const openWorksheets = worksheets.filter(
    (p) => p.status !== 'ARCHIVED' && !p.submission
  );

  return (
    <div className="student-quiz-list" style={{ marginTop: '40px' }}>
      <div className="section-heading">
        <div>
          <h2>Open Question Papers</h2>
          <p>Solve these in your workbook and upload your answer sheet photos</p>
        </div>
        <button className="icon-button" title="Refresh worksheets" onClick={() => void load()}>
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="student-loading"><RefreshCw size={16} className="spin" /> Loading papers...</div>
      ) : openWorksheets.length === 0 ? (
        <div className="student-waiting-home">
          <FileText size={22} color="#94a3b8" />
          <h2>No open question papers assigned yet.</h2>
          <p>Your teacher will post printable worksheets and question papers here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {openWorksheets.map((paper) => (
            <div
              key={paper.id}
              className="student-quiz-tile"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={async () => {
                const full = await api<{ worksheet: WorksheetPaper }>(`/api/worksheets/${paper.id}`);
                setActivePaper(full.worksheet);
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="quiz-mode-icon" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                  <FileText size={20} />
                </span>
                <div>
                  <strong style={{ fontSize: '16px', display: 'block', color: '#0f172a' }}>{paper.title}</strong>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>
                    {paper.subject} • {paper.grade} • Total Marks: {paper.totalMarks}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="tile-start">
                  Open Paper & Upload <ArrowRight size={14} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activePaper && (
        <StudentPaperModal
          paper={activePaper}
          onClose={() => setActivePaper(null)}
          onSubmitted={async () => {
            setNotice('Your workbook answer sheet has been submitted to your teacher!');
            const full = await api<{ worksheet: WorksheetPaper }>(`/api/worksheets/${activePaper.id}`);
            setActivePaper(full.worksheet);
            await load();
          }}
        />
      )}
    </div>
  );
}

function StudentWorksheetHistorySection({ setNotice }: { setNotice: (msg: string) => void }) {
  const [worksheets, setWorksheets] = useState<WorksheetPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePaper, setActivePaper] = useState<WorksheetPaper | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ worksheets: WorksheetPaper[] }>('/api/worksheets');
      setWorksheets(data.worksheets);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const historyWorksheets = worksheets.filter(
    (p) => Boolean(p.submission) || p.status === 'ARCHIVED'
  );

  return (
    <div className="student-quiz-list" style={{ marginTop: '0' }}>
      <div className="section-heading">
        <div>
          <h2>Question Papers History</h2>
          <p>Your submitted question papers, answer sheets, and teacher evaluation scores</p>
        </div>
        <button className="icon-button" title="Refresh history" onClick={() => void load()}>
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="student-loading"><RefreshCw size={16} className="spin" /> Loading history...</div>
      ) : historyWorksheets.length === 0 ? (
        <div className="student-waiting-home">
          <FileText size={22} color="#94a3b8" />
          <h2>No completed question papers yet.</h2>
          <p>When your teacher grades your submitted answer sheets, your score and evaluation feedback will appear here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {historyWorksheets.map((paper) => {
            const sub = paper.submission;
            const isGraded = sub?.status === 'GRADED';
            const isSubmitted = sub?.status === 'SUBMITTED';

            return (
              <div
                key={paper.id}
                className={`student-quiz-tile ${isGraded ? 'history-tile' : ''}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={async () => {
                  const full = await api<{ worksheet: WorksheetPaper }>(`/api/worksheets/${paper.id}`);
                  setActivePaper(full.worksheet);
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className={`quiz-mode-icon ${isGraded ? 'mode-history' : ''}`} style={!isGraded ? { background: '#e0f2fe', color: '#0369a1' } : undefined}>
                    <FileText size={20} />
                  </span>
                  <div>
                    <strong style={{ fontSize: '16px', display: 'block', color: '#0f172a' }}>{paper.title}</strong>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>
                      {paper.subject} • {paper.grade} • Total Marks: {paper.totalMarks}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {isGraded ? (
                    <div style={{ textAlign: 'right' }}>
                      <span className="history-score-pill" style={{ background: '#dcfce7', color: '#15803d', fontWeight: 'bold' }}>
                        Score: <strong>{sub?.score}</strong> / {paper.totalMarks} ({Math.round(((sub?.score ?? 0) / (paper.totalMarks || 1)) * 100)}%)
                      </span>
                      <div style={{ fontSize: '11px', color: '#15803d', fontWeight: 'bold', marginTop: '2px' }}>✓ EVALUATION COMPLETE</div>
                    </div>
                  ) : isSubmitted ? (
                    <span className="history-score-pill" style={{ background: '#fef3c7', color: '#b45309' }}>
                      Submitted (Pending Grade)
                    </span>
                  ) : paper.status === 'ARCHIVED' ? (
                    <span className="worksheet-badge badge-archived">Completed Paper</span>
                  ) : (
                    <span className="tile-start">
                      Open Paper & Upload <ArrowRight size={14} />
                    </span>
                  )}
                  <span className="tile-start text-button" style={{ fontSize: '14px' }}>
                    Review <ArrowRight size={14} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activePaper && (
        <StudentPaperModal
          paper={activePaper}
          onClose={() => setActivePaper(null)}
          onSubmitted={async () => {
            setNotice('Your workbook answer sheet has been submitted to your teacher!');
            const full = await api<{ worksheet: WorksheetPaper }>(`/api/worksheets/${activePaper.id}`);
            setActivePaper(full.worksheet);
            await load();
          }}
        />
      )}
    </div>
  );
}

function StudentPaperModal({
  paper,
  onClose,
  onSubmitted,
}: {
  paper: WorksheetPaper;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  const sub = paper.submission;
  let existingImages: string[] = [];
  try { existingImages = JSON.parse(sub?.images || '[]'); } catch { existingImages = []; }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        if (base64) {
          setImages((prev) => [...prev, base64]);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleSubmit() {
    if (images.length === 0) {
      setError('Please select at least one photo/scan of your workbook page.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      await api(`/api/worksheets/${paper.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ images }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setUploading(false);
    }
  }

  return createPortal(
    <div className="word-doc-modal-overlay">
      <div className="word-doc-modal-container" style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div className="word-doc-modal-header">
          <h3><FileText size={20} color="#0284c7" /> {paper.title}</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="button button-secondary" onClick={() => printHtmlContent(paper.content)}>
              <Printer size={15} /> Print Paper
            </button>
            <button className="icon-button quiet" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {sub?.status === 'GRADED' && (
            <div style={{ background: '#ecfdf5', border: '2px solid #a7f3d0', borderRadius: '14px', padding: '20px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(5,150,105,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#047857', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Evaluation Result & Assessment</span>
                  <h2 style={{ margin: '4px 0 0 0', fontSize: '24px', color: '#065f46', fontWeight: 800 }}>
                    🏆 Score: {sub.score} / {paper.totalMarks} <span style={{ fontSize: '16px', fontWeight: 600, color: '#059669' }}>({Math.round(((sub.score ?? 0) / (paper.totalMarks || 1)) * 100)}%)</span>
                  </h2>
                </div>
                <span className="worksheet-badge badge-published" style={{ background: '#059669', color: '#fff', padding: '6px 14px', fontSize: '13px', borderRadius: '20px' }}>
                  ✓ Graded by Teacher
                </span>
              </div>
              {sub.remarks ? (
                <div style={{ marginTop: '14px', background: '#ffffff', border: '1px solid #6ee7b7', borderRadius: '10px', padding: '14px 16px', color: '#064e3b' }}>
                  <strong style={{ display: 'block', fontSize: '13px', color: '#047857', marginBottom: '4px' }}>💬 Teacher Feedback / Remarks for Student & Parent:</strong>
                  <p style={{ margin: 0, fontSize: '15px', fontStyle: 'italic', color: '#0f172a', lineHeight: '1.5' }}>"{sub.remarks}"</p>
                </div>
              ) : (
                <div style={{ marginTop: '10px', fontSize: '13px', color: '#047857' }}>
                  No written remarks provided by teacher.
                </div>
              )}
            </div>
          )}

          {sub?.status === 'SUBMITTED' && (
            <div style={{ background: '#fffbeb', border: '2px solid #fde68a', borderRadius: '14px', padding: '18px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#b45309', textTransform: 'uppercase' }}>Submission Status</span>
                  <h3 style={{ margin: '4px 0 0 0', fontSize: '17px', color: '#92400e' }}>⏳ Answer Sheets Submitted (Pending Teacher Evaluation)</h3>
                </div>
                <span className="worksheet-badge badge-draft" style={{ background: '#f59e0b', color: '#fff', padding: '6px 12px' }}>
                  Under Review
                </span>
              </div>
            </div>
          )}

          {paper.status === 'ARCHIVED' && sub?.status !== 'GRADED' && sub?.status !== 'SUBMITTED' && (
            <div style={{ background: '#f1f5f9', border: '2px solid #cbd5e1', borderRadius: '14px', padding: '18px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', textTransform: 'uppercase' }}>Question Paper Status</span>
                  <h3 style={{ margin: '4px 0 0 0', fontSize: '16px', color: '#334155' }}>✓ Question Paper Marked Completed by Teacher</h3>
                </div>
                <span className="worksheet-badge badge-archived">Archived</span>
              </div>
            </div>
          )}

          <div className="word-doc-canvas" style={{ margin: '0 auto 30px auto', boxShadow: 'none' }} dangerouslySetInnerHTML={{ __html: paper.content }} />

          <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '20px', marginTop: '20px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UploadCloud size={18} color="#0284c7" /> {sub?.status === 'GRADED' || sub?.status === 'SUBMITTED' ? 'Your Answer Sheets' : 'Upload Your Workbook Answer Sheets'}
            </h4>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
              {sub?.status === 'GRADED' || sub?.status === 'SUBMITTED'
                ? 'Review your uploaded answer sheet pages below or attach additional photos.'
                : 'Solve the questions on paper in your physical workbook, take clear photos of your pages, and upload them here for your teacher to check.'}
            </p>

            {error && <div className="inline-error" style={{ marginBottom: '12px' }}>{error}</div>}

            <label className="upload-box">
              <UploadCloud size={32} color="#0284c7" />
              <p>Click or Tap to Select/Take Photos of Answer Sheet Pages</p>
              <input type="file" accept="image/*" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
            </label>

            {images.length > 0 && (
              <div>
                <strong style={{ fontSize: '13px', color: '#334155' }}>Selected Pages to Submit ({images.length}):</strong>
                <div className="image-preview-strip">
                  {images.map((img, idx) => (
                    <div className="image-preview-thumb" key={idx} onClick={() => setPreviewImg(img)} style={{ cursor: 'pointer' }}>
                      <img src={img} alt={`Page ${idx + 1}`} />
                      <button type="button" title="Remove page" onClick={(e) => { e.stopPropagation(); setImages(images.filter((_, i) => i !== idx)); }}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="button button-primary" onClick={() => void handleSubmit()} disabled={uploading}>
                    {uploading ? <><RefreshCw size={16} className="spin" /> Submitting...</> : <><Send size={15} /> Submit Answer Sheets to Teacher</>}
                  </button>
                </div>
              </div>
            )}

            {existingImages.length > 0 && images.length === 0 && (
              <div style={{ marginTop: '12px' }}>
                <strong style={{ fontSize: '13px', color: '#059669', display: 'block', marginBottom: '8px' }}>
                  ✓ Previously Submitted Pages ({existingImages.length} Page{existingImages.length === 1 ? '' : 's'}):
                </strong>
                <div className="image-preview-strip">
                  {existingImages.map((img, idx) => (
                    <div className="image-preview-thumb" key={idx} onClick={() => setPreviewImg(img)} style={{ cursor: 'pointer' }}>
                      <img src={img} alt={`Page ${idx + 1}`} />
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', textAlign: 'center', padding: '2px' }}>
                        Page {idx + 1} (Click)
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '12px', color: '#64748b' }}>
              <Lock size={14} color="#059669" /> Your answer sheet photos are private and only visible to you and your teacher.
            </div>
          </div>
        </div>

        {previewImg && (
          <div className="word-doc-modal-overlay" style={{ zIndex: 1100 }} onClick={() => setPreviewImg(null)}>
            <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
              <img src={previewImg} alt="Answer sheet full view" style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }} />
              <button className="icon-button quiet" style={{ position: 'absolute', top: '-15px', right: '-15px', background: '#e11d48', color: '#fff', borderRadius: '50%' }} onClick={() => setPreviewImg(null)}>
                <X size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function PaperPreviewModal({ paper, onClose }: { paper: WorksheetPaper; onClose: () => void }) {
  return createPortal(
    <div className="word-doc-modal-overlay">
      <div className="word-doc-modal-container" style={{ maxWidth: '850px' }}>
        <div className="word-doc-modal-header">
          <h3><Eye size={18} /> {paper.title}</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="button button-secondary" onClick={() => printHtmlContent(paper.content)}>
              <Printer size={15} /> Print Paper
            </button>
            <button className="icon-button quiet" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          <div className="word-doc-canvas" style={{ margin: '0 auto', boxShadow: 'none' }} dangerouslySetInnerHTML={{ __html: paper.content }} />
        </div>
      </div>
    </div>,
    document.body
  );
}

export default App;
