import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, ArrowRight, BarChart3, BookOpenCheck, Calculator, Check, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, Clock3, Copy, Download, Eye, KeyRound, ListChecks, LogOut, MonitorPlay, Pencil, PenTool, Plus, Radio, RefreshCw, RotateCcw, Send, ShieldCheck, Sparkles, Trash2, UserCheck, Users, UserX, X } from 'lucide-react';

type Mode = 'LIVE' | 'SELF_PACED';
type QuestionType = 'MCQ' | 'FILL_BLANK' | 'TRUE_FALSE' | 'SOLVE';
type Status = 'DRAFT' | 'ACTIVE' | 'CLOSED';
type Option = { id?: string; text: string; isCorrect?: boolean; correct?: boolean };
type Question = { id?: string; prompt: string; marks: number; imageUrl?: string | null; type?: QuestionType; options: Option[] };
type Quiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; showResults: boolean; currentQuestionIndex: number; currentAnswerRevealed: boolean; questions?: Question[]; _count?: { questions: number; attempts: number } };
type Student = { id: string; name: string; passkey?: string | null; active: boolean; _count: { attempts: number } };
type User = { role: 'admin' | 'student'; name?: string; email?: string };
type QuizDraft = { title: string; mode: Mode; minutes: number; showResults: boolean; questions: Question[] };
type StudentQuiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; questionCount: number; totalMarks?: number; attempt: { status: string; deadlineAt: string | null; score: number | null; submittedAt?: string | null } | null };
type ActiveQuiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; showResults: boolean; currentQuestionIndex: number; currentAnswerRevealed: boolean; questionCount?: number; totalMarks?: number; questions: Question[]; attempt: { status: string; deadlineAt: string | null; score: number | null; answers: { questionId: string; optionId: string }[] } | null };
type Result = { id: string; name: string; status: string; submittedAt: string | null; score: number | null; totalMarks: number; answers: { question: string; response: string; correct: boolean; marks: number }[] };
type LiveStats = { answered: number; participants: number; distribution: { optionId: string; count: number }[]; responses: { name: string; optionId: string; text: string }[] };

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
const newDraft = (): QuizDraft => ({ title: '', mode: 'LIVE', minutes: 20, showResults: true, questions: [emptyQuestion()] });

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
  const [tab, setTab] = useState<'overview' | 'quizzes' | 'students' | 'results'>('overview');
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [distribution, setDistribution] = useState<{ question: string; options: { text: string; correct: boolean; count: number }[] }[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const [quizData, studentData] = await Promise.all([api<{ quizzes: Quiz[] }>('/api/quizzes'), api<{ students: Student[] }>('/api/students')]);
      setQuizzes(quizData.quizzes);
      setStudents(studentData.students);
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

  const activeCount = quizzes.filter((quiz) => quiz.status === 'ACTIVE').length;
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
        <NavItem active={tab === 'quizzes'} icon={<BookOpenCheck size={17} />} label="Quizzes" count={quizzes.length} onClick={() => setTab('quizzes')} />
        <NavItem active={tab === 'students'} icon={<Users size={17} />} label="Students" count={students.length} onClick={() => setTab('students')} />
        <NavItem active={tab === 'results'} icon={<CheckCircle2 size={17} />} label="Results" onClick={() => setTab('results')} />
      </nav>
      <div className="sidebar-bottom"><div className="teacher-profile"><div className="avatar avatar-green">{(user.email ?? 'T').slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.email?.split('@')[0]}</strong><span>Teacher account</span></div><button className="icon-button quiet" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div><div className="sidebar-footnote">A little progress, every day.</div></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="breadcrumb">Your classroom <span>/</span> <strong>{tabLabel(tab)}</strong></div><div className="topbar-actions"><span className="today-label">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span><button className="icon-button" title="Refresh dashboard" aria-label="Refresh dashboard" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button><div className="avatar avatar-small">{(user.email ?? 'T').slice(0, 1).toUpperCase()}</div></div></header>
      <div className="content-area">
        {tab === 'overview' && <section className="view-enter"><div className="page-heading"><div><span className="overline">Good to see you.</span><h1>Your classroom at a glance</h1></div><button className="button button-primary" onClick={() => setTab('quizzes')}><Plus size={17} /> Create a quiz</button></div>
          <div className="metrics-grid"><Metric label="Quizzes made" value={quizzes.length} icon={<BookOpenCheck size={17} />} tint="sage" /><Metric label="In progress" value={activeCount} icon={<Radio size={17} />} tint="coral" /><Metric label="Student attempts" value={totalAttempts} icon={<Users size={17} />} tint="blue" /></div>
          <div className="section-heading"><div><h2>Recent quizzes</h2><p>Your latest classroom activities</p></div><button className="text-button" onClick={() => setTab('quizzes')}>All quizzes <ArrowRight size={15} /></button></div>
          <QuizList quizzes={quizzes.slice(0, 4)} onEdit={(quiz) => { setSelectedQuiz(quiz.id); setTab('quizzes'); }} onSelect={(quiz) => { setSelectedQuiz(quiz.id); setTab(quiz.mode === 'LIVE' ? 'quizzes' : 'results'); }} onOpenAI={() => setTab('quizzes')} onRefresh={refresh} setNotice={setNotice} />
        </section>}
        {tab === 'quizzes' && <QuizManager quizzes={quizzes} selectedQuiz={selectedQuiz} setSelectedQuiz={setSelectedQuiz} liveQuiz={liveQuiz} refresh={refresh} setNotice={setNotice} />}
        {tab === 'students' && <StudentManager students={students} refresh={refresh} setNotice={setNotice} />}
        {tab === 'results' && <ResultsPanel quizzes={quizzes} selectedQuiz={selectedQuiz} setSelectedQuiz={setSelectedQuiz} results={results} distribution={distribution} onExport={exportCsv} />}
      </div>
      {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}
    </main>
  </div>;
}

function tabLabel(tab: string) { return ({ overview: 'Overview', quizzes: 'Quizzes', students: 'Students', results: 'Results' } as Record<string, string>)[tab] ?? tab; }
function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <small>{count}</small>}</button>; }
function Metric({ label, value, icon, tint }: { label: string; value: number | string; icon: React.ReactNode; tint: string }) { return <div className="metric"><div className={`metric-icon ${tint}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div><div className="metric-trend">↗</div></div>; }

function AIQuizModal({ onClose, onGenerated }: { onClose: () => void; onGenerated: (quiz: { title: string; mode: Mode; questions: Question[] }) => void }) {
  const [subject, setSubject] = useState('Science');
  const [customSubject, setCustomSubject] = useState('');
  const [grade, setGrade] = useState('Grade 6');
  const [topic, setTopic] = useState('');
  const [subtopics, setSubtopics] = useState('');
  const [difficulty, setDifficulty] = useState<'Easy' | 'Moderate' | 'Hard'>('Moderate');
  const [questionCount, setQuestionCount] = useState(10);
  const [questionType, setQuestionType] = useState<'ALL' | 'MCQ' | 'FILL_BLANK' | 'TRUE_FALSE' | 'SOLVE'>('ALL');
  const [mode, setMode] = useState<Mode>('LIVE');
  const [details, setDetails] = useState('');
  const [provider, setProvider] = useState<'auto' | 'gemini' | 'openai'>('auto');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('livequiz_ai_key') ?? '');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) { setError('Please enter a topic.'); return; }
    setError('');
    setGenerating(true);
    if (apiKey.trim()) {
      localStorage.setItem('livequiz_ai_key', apiKey.trim());
    }
    try {
      const finalSubject = subject === 'Other' ? (customSubject || 'General') : subject;
      const res = await api<{ title: string; questions: Question[] }>('/api/ai/generate-quiz', {
        method: 'POST',
        body: JSON.stringify({ subject: finalSubject, grade, topic, subtopics, difficulty, questionCount, questionType, mode, details, provider, apiKey: apiKey.trim() || undefined }),
      });
      onGenerated({ title: res.title, mode, questions: res.questions });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate quiz.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ai-form-grid">
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

      <div className="form-grid-3">
        <label className="field compact-field">
          <span>Number of Questions</span>
          <select value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
            <option value={3}>3 Questions</option>
            <option value={5}>5 Questions</option>
            <option value={10}>10 Questions</option>
            <option value={15}>15 Questions</option>
            <option value={20}>20 Questions</option>
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

        <label className="field compact-field">
          <span>AI Engine Provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as any)}>
            <option value="auto">Auto (Gemini / GPT)</option>
            <option value="gemini">Google Gemini AI</option>
            <option value="openai">ChatGPT (GPT-4o)</option>
          </select>
        </label>
      </div>

      <label className="field compact-field">
        <span>API Key (Optional)</span>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste API Key..." />
      </label>

      <div className="form-grid-2">
        <div className="field compact-field">
          <span>Quiz Delivery Mode</span>
          <div className="mode-choice compact-mode-choice">
            <button type="button" className={mode === 'LIVE' ? 'chosen' : ''} onClick={() => setMode('LIVE')}>
              <Radio size={15} />
              <span><strong>Live classroom</strong></span>
            </button>
            <button type="button" className={mode === 'SELF_PACED' ? 'chosen' : ''} onClick={() => setMode('SELF_PACED')}>
              <Clock3 size={15} />
              <span><strong>Timed practice</strong></span>
            </button>
          </div>
        </div>

        <label className="field compact-field">
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
  return <div className="quiz-list">{quizzes.map((quiz) => <article className="quiz-row" key={quiz.id}><div className={`quiz-mode-icon ${quiz.mode === 'LIVE' ? 'mode-live' : 'mode-timed'}`}>{quiz.mode === 'LIVE' ? <Radio size={19} /> : <Clock3 size={19} />}</div><button className="quiz-row-main" onClick={() => onSelect(quiz)}><strong>{quiz.title}</strong><span>{quiz.mode === 'LIVE' ? 'Live classroom' : `${Math.round((quiz.timeLimitSeconds ?? 0) / 60)} min · Self-paced`} <i /> {quiz._count?.questions ?? 0} questions <i /> {quiz._count?.attempts ?? 0} attempts</span></button><StatusPill status={quiz.status} /><div className="quiz-row-actions">{onRestart && <button className="icon-button" title="Restart quiz (reset to Question 1)" aria-label={`Restart ${quiz.title}`} onClick={() => onRestart(quiz)}><RotateCcw size={15} /></button>}<button className="icon-button" title="Edit quiz" aria-label={`Edit ${quiz.title}`} disabled={quiz.status === 'ACTIVE' || (quiz._count?.attempts ?? 0) > 0} onClick={() => onEdit(quiz)}><Pencil size={15} /></button><button className="icon-button danger-hover" title="Delete quiz" aria-label={`Delete ${quiz.title}`} onClick={() => void remove(quiz)}><Trash2 size={15} /></button></div></article>)}</div>;
}
function StatusPill({ status }: { status: Status }) { return <span className={`status-pill status-${status.toLowerCase()}`}><i />{status === 'ACTIVE' ? 'Live' : status === 'CLOSED' ? 'Finished' : 'Draft'}</span>; }

function QuizManager({ quizzes, selectedQuiz, setSelectedQuiz, liveQuiz, refresh, setNotice, initialOpenAI }: { quizzes: Quiz[]; selectedQuiz: string; setSelectedQuiz: (id: string) => void; liveQuiz?: Quiz; refresh: () => Promise<void>; setNotice: (text: string) => void; initialOpenAI?: boolean }) {
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
      setDraft({ title: full.title, mode: full.mode, minutes: Math.max(1, Math.round((full.timeLimitSeconds ?? 1200) / 60)), showResults: full.showResults, questions: full.questions ?? [emptyQuestion()] });
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
      const body = { title: draft.title, mode: draft.mode, timeLimitSeconds: draft.mode === 'SELF_PACED' ? draft.minutes * 60 : null, showResults: draft.showResults, questions: draft.questions };
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

  function handleAIGenerated(result: { title: string; mode: Mode; questions: Question[] }) {
    setEditingId('');
    setDraft({
      title: result.title,
      mode: result.mode,
      minutes: 20,
      showResults: true,
      questions: result.questions,
    });
    setShowAIModal(false);
    setNotice('✨ AI Quiz generated with NEP 2026 alignment! Review and save below.');
  }

  if (draft) return <section className="view-enter"><div className="page-heading compact-heading"><div><button className="back-link" onClick={() => setDraft(null)}><ArrowLeft size={15} /> All quizzes</button><h1>{editingId ? 'Edit your quiz' : 'Build a quiz'}</h1><p>Keep each question clear and focused.</p></div><button className="button button-primary" onClick={(event) => void saveQuiz(event as unknown as React.FormEvent)} disabled={saving}>{saving ? 'Saving...' : <><Check size={16} /> Save quiz</>}</button></div>
    <form className="editor-layout" onSubmit={saveQuiz}>
      <div className="editor-main">
        <div className="form-panel"><div className="panel-title"><span className="step-count">01</span><div><h2>Quiz details</h2><p>Give your quiz a name students will recognize.</p></div></div><label className="field"><span>Quiz title</span><input required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Fractions, round one" /></label><div className="field"><span>How will students take it?</span><div className="mode-choice"><button type="button" className={draft.mode === 'LIVE' ? 'chosen' : ''} onClick={() => setDraft({ ...draft, mode: 'LIVE' })}><Radio size={18} /><span><strong>Live classroom</strong><small>One question at a time</small></span>{draft.mode === 'LIVE' && <Check size={16} />}</button><button type="button" className={draft.mode === 'SELF_PACED' ? 'chosen' : ''} onClick={() => setDraft({ ...draft, mode: 'SELF_PACED' })}><Clock3 size={18} /><span><strong>Timed practice</strong><small>Students move at their pace</small></span>{draft.mode === 'SELF_PACED' && <Check size={16} />}</button></div></div>{draft.mode === 'SELF_PACED' && <label className="field short-field"><span>Time limit</span><div className="input-suffix"><input type="number" min={1} max={1440} value={draft.minutes} onChange={(event) => setDraft({ ...draft, minutes: Number(event.target.value) })} /><span>minutes</span></div></label>}<label className="check-row"><input type="checkbox" checked={draft.showResults} onChange={(event) => setDraft({ ...draft, showResults: event.target.checked })} /><span><strong>Show results to students</strong></span></label></div>
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
          <AIQuizModal onClose={() => setShowAIModal(false)} onGenerated={handleAIGenerated} />
        </div>
      </section>
    );
  }

  return <section className="view-enter">
    <div className="page-heading">
      <div>
        <h1>Quizzes</h1>
      </div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button className="button button-primary" onClick={() => setShowAIModal(true)}><Sparkles size={17} /> Generate with AI</button>
        <button className="button button-secondary" onClick={() => void startEdit()}><Plus size={17} /> Create manually</button>
      </div>
    </div>

    <div className="live-panel live-panel-fullwidth">
      <div className="live-panel-head">
        <span className="overline">Classroom monitor</span>
        <span className="live-indicator">{liveQuiz?.status === 'ACTIVE' && liveQuiz.mode === 'LIVE' ? <><i /> Live now</> : 'Ready when you are'}</span>
      </div>

      <div className="monitor-select-bar">
        <label className="field monitor-select">
          <span>Select a quiz</span>
          <div className="select-wrap">
            <select value={selectedQuiz} onChange={(event) => setSelectedQuiz(event.target.value)}>
              <option value="">Choose a quiz from your library...</option>
              {quizzes.map((quiz) => (
                <option key={quiz.id} value={quiz.id}>
                  {quiz.title} ({quiz.mode === 'LIVE' ? 'Live classroom' : 'Self-paced'} · {quiz._count?.questions ?? 0} questions)
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </div>
        </label>

        {liveQuiz && (
          <div className="monitor-quiz-actions">
            <button className="icon-button" title="Restart quiz (reset to Question 1)" aria-label="Restart quiz" onClick={() => void restartQuiz(liveQuiz)}>
              <RotateCcw size={16} />
            </button>
            <button className="icon-button" title="Edit selected quiz" aria-label="Edit selected quiz" disabled={liveQuiz.status === 'ACTIVE' || (liveQuiz._count?.attempts ?? 0) > 0} onClick={() => void startEdit(liveQuiz)}>
              <Pencil size={16} />
            </button>
            <button className="icon-button danger-hover" title="Delete selected quiz" aria-label="Delete selected quiz" onClick={() => {
              if (window.confirm(`Delete "${liveQuiz.title}" and all its results?`)) {
                api(`/api/quizzes/${liveQuiz.id}`, { method: 'DELETE' }).then(() => { setNotice('Quiz deleted.'); void refresh(); }).catch(e => setNotice(e instanceof Error ? e.message : 'Unable to delete quiz'));
              }
            }}>
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      {liveQuiz ? <>
        {liveQuiz.mode === 'LIVE' ? <><div className="monitor-question"><div className="monitor-question-meta"><span>QUESTION {String((liveState?.currentQuestionIndex ?? liveQuiz.currentQuestionIndex) + 1).padStart(2, '0')} <span>/ {liveState?.questionCount ?? liveQuiz._count?.questions ?? 0}</span></span><span className="answer-counter"><Users size={14} /> {stats.answered} answered</span></div><h3>{liveState?.question?.prompt ?? liveQuiz.questions?.[liveQuiz.currentQuestionIndex]?.prompt ?? (liveQuiz.status === 'DRAFT' ? 'Start the quiz to reveal question one.' : liveQuiz.status === 'ACTIVE' ? 'Loading question...' : 'The quiz is complete.')}</h3></div>{liveQuiz.status === 'ACTIVE' && <div className="teacher-options-list">{(liveState?.question?.options ?? liveQuiz.questions?.[liveQuiz.currentQuestionIndex]?.options ?? []).map((option, index) => { const count = stats.distribution.find((entry) => entry.optionId === option.id)?.count ?? 0; const total = stats.answered; const percent = total > 0 ? Math.round((count / total) * 100) : 0; const isCorrectOption = Boolean(option.isCorrect); return <div className={`teacher-option-card ${liveState?.currentAnswerRevealed && isCorrectOption ? 'is-correct' : ''}`} key={option.id ?? index}><div className="teacher-option-header"><span className="student-option-letter">{String.fromCharCode(65 + index)}</span><span className="teacher-option-text">{option.text}</span><span className="teacher-option-count">{count} ({percent}%)</span>{liveState?.currentAnswerRevealed && isCorrectOption && <span className="correct-label"><Check size={14} /> Correct</span>}</div><div className="teacher-bar-track"><div className="teacher-bar-fill" style={{ width: `${percent}%` }} /></div></div>; })}{stats.responses.length > 0 && <div className="live-responses"><span className="live-responses-title">Student responses</span>{[...stats.responses].reverse().slice(0, 6).map((response, index) => <div className="live-response" key={`${response.name}-${index}`}><strong>{response.name}</strong><span>{response.text}</span></div>)}</div>}{liveState?.currentAnswerRevealed && <div className="reveal-note"><CheckCircle2 size={16} /> Correct answer is revealed on student screens</div>}</div>}
        <div className="monitor-actions">{liveQuiz.status === 'DRAFT' ? <button className="button button-primary button-wide" onClick={() => void control('start')}><Radio size={16} /> Start live quiz</button> : liveQuiz.status === 'ACTIVE' ? <><button className="button button-primary" onClick={() => void control(liveState?.currentAnswerRevealed ? 'next' : 'reveal')}>{liveState?.currentAnswerRevealed ? <><ArrowRight size={17} /> Next question</> : <><Eye size={17} /> Reveal answer</>}</button><button className="button button-quiet" onClick={() => void control('stop')}><X size={17} /> End quiz</button><button className="button button-quiet" onClick={() => void restartQuiz(liveQuiz)}><RotateCcw size={16} /> Restart quiz</button></> : <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}><div className="finished-note"><CheckCircle2 size={16} /> This live quiz has finished</div><button className="button button-secondary" onClick={() => void restartQuiz(liveQuiz)}><RotateCcw size={16} /> Restart quiz</button></div>}</div></> : <div className="timed-monitor"><div className="timed-icon"><Clock3 size={24} /></div><h3>{liveQuiz.title}</h3><p>{Math.round((liveQuiz.timeLimitSeconds ?? 0) / 60)} minutes · {liveQuiz._count?.questions ?? 0} questions</p>{liveQuiz.status === 'DRAFT' ? <button className="button button-primary button-wide" onClick={() => void setTimedStatus(liveQuiz, 'start')}><BookOpenCheck size={16} /> Open practice quiz</button> : liveQuiz.status === 'ACTIVE' ? <div style={{ display: 'flex', gap: '10px', width: '100%', flexWrap: 'wrap' }}><button className="button button-quiet" style={{ flex: 1 }} onClick={() => void setTimedStatus(liveQuiz, 'stop')}><X size={16} /> Close quiz</button><button className="button button-secondary" onClick={() => void restartQuiz(liveQuiz)}><RotateCcw size={16} /> Restart</button></div> : <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}><span className="finished-note"><CheckCircle2 size={16} /> Practice quiz closed</span><button className="button button-secondary" onClick={() => void restartQuiz(liveQuiz)}><RotateCcw size={16} /> Restart quiz</button></div>}<button className="text-button monitor-results" onClick={() => document.dispatchEvent(new CustomEvent('open-results', { detail: liveQuiz.id }))}>View student results <ArrowRight size={14} /></button></div>}
      </> : <div className="monitor-empty"><MonitorPlay size={36} /><strong>Your next lesson, at a glance.</strong><p>Choose a quiz from your library to monitor live responses in real time.</p></div>}
    </div>
  </section>;
}

function StudentManager({ students, refresh, setNotice }: { students: Student[]; refresh: () => Promise<void>; setNotice: (text: string) => void }) {
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

  return <section className="view-enter"><div className="page-heading"><div><span className="overline">Your people</span><h1>Students.</h1></div><span className="student-total"><Users size={16} /> {students.length} students</span></div>
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
  </section>;
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

    return <main className="student-shell"><header className="student-topbar"><div className="student-brand"><span className="brand-mark"><BookOpenCheck size={18} /></span><span>LiveQuiz</span></div><div className="student-top-right"><span className="student-name"><span className="avatar avatar-small">{user.name?.slice(0, 1).toUpperCase()}</span>{user.name}</span><button className="icon-button" title="Back to classroom" aria-label="Back to classroom" onClick={() => { setActiveQuiz(null); sessionStorage.removeItem('activeQuizId'); void loadQuizzes(); }}><LogOut size={16} /></button></div></header>
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
            <button className="button button-secondary" style={{ marginTop: '20px' }} onClick={() => { setActiveQuiz(null); sessionStorage.removeItem('activeQuizId'); void loadQuizzes(); }}>
              <ArrowLeft size={16} /> Back to classroom
            </button>
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
              <ArrowLeft size={16} /> Return to Classroom
            </button>
          </div>
        </div>
      ) : <>
        <div className="student-quiz-heading"><div><span className="overline">{activeQuiz.mode === 'LIVE' ? <><i className="live-dot" /> Live classroom</> : 'Self-paced practice'}</span><h1>{activeQuiz.title}</h1></div>{activeQuiz.mode === 'SELF_PACED' && <div className={`timer-chip ${remaining !== null && remaining < 60 ? 'timer-warning' : ''}`}><Clock3 size={16} /><span>{remaining === null ? '--:--' : `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`}</span></div>}</div>
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

  return <main className="student-home"><header className="student-topbar"><div className="student-brand"><span className="brand-mark"><BookOpenCheck size={18} /></span><span>LiveQuiz</span></div><div className="student-top-right"><span className="student-name"><span className="avatar avatar-small">{user.name?.slice(0, 1).toUpperCase()}</span>{user.name}</span><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div></header><section className="student-home-content"><div className="student-welcome"><div><span className="overline">Your classroom</span><h1>Hi, {user.name?.split(' ')[0]}.</h1><p>Ready to give it a go?</p></div><div className="welcome-mark"><Sparkles size={25} /></div></div>{error && <div className="inline-error">{error}</div>}{loading ? <div className="student-loading"><RefreshCw size={17} className="spin" /> Looking for your quizzes...</div> : <>
    <div className="student-quiz-list"><div className="section-heading"><div><h2>Open quizzes</h2><p>Active quizzes ready for you to take</p></div><button className="icon-button" title="Refresh quizzes" onClick={() => void loadQuizzes()}><RefreshCw size={16} /></button></div>{openQuizzes.length ? openQuizzes.map((quiz) => <button className="student-quiz-tile" key={quiz.id} onClick={() => void joinQuiz(quiz.id)}><span className={`quiz-mode-icon ${quiz.mode === 'LIVE' ? 'mode-live' : 'mode-timed'}`}>{quiz.mode === 'LIVE' ? <Radio size={20} /> : <Clock3 size={20} />}</span><span className="student-tile-copy"><strong>{quiz.title}</strong><span>{quiz.mode === 'LIVE' ? 'Live classroom · Teacher-led' : `${Math.round((quiz.timeLimitSeconds ?? 0) / 60)} minutes · Self-paced`}</span></span><span className="tile-start">{quiz.attempt?.status === 'IN_PROGRESS' ? 'Continue' : 'Join'} <ArrowRight size={15} /></span></button>) : <div className="student-waiting-home"><div className="waiting-pulse"><BookOpenCheck size={22} /></div><h2>No open quizzes right now.</h2><p>When your teacher opens a quiz, it will appear here.</p></div>}</div>
    {historyQuizzes.length > 0 && <div className="student-quiz-list" style={{ marginTop: '40px' }}><div className="section-heading"><div><h2>Quiz History</h2><p>Your completed quizzes and scores</p></div></div>{historyQuizzes.map((quiz) => <div className="student-quiz-tile history-tile" key={quiz.id} onClick={() => void joinQuiz(quiz.id)}><span className="quiz-mode-icon mode-history"><BookOpenCheck size={20} /></span><span className="student-tile-copy"><strong>{quiz.title}</strong><span>{quiz.mode === 'LIVE' ? 'Live round' : 'Self-paced practice'} · {quiz.questionCount} question{quiz.questionCount === 1 ? '' : 's'}</span></span>{quiz.attempt?.score !== null && quiz.attempt?.score !== undefined && <span className="history-score-pill">Score: <strong>{quiz.attempt.score}</strong> / {quiz.totalMarks ?? 0}</span>}<span className="tile-start text-button" style={{ fontSize: '14px' }}>Review <ArrowRight size={14} /></span></div>)}</div>}
  </>}<div className="student-home-tip"><ShieldCheck size={16} /> Your work is private and saved as you go.</div></section></main>;
}

export default App;
