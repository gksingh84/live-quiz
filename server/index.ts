import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Prisma, PrismaClient, type QuizMode } from '@prisma/client';
import { Server } from 'socket.io';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const port = Number(process.env.PORT ?? 4000);
const rawSecret = process.env.SESSION_SECRET;
const secret = rawSecret && rawSecret.length >= 32
  ? rawSecret
  : (rawSecret
      ? createHmac('sha256', 'livequiz-secret-salt').update(rawSecret).digest('hex')
      : 'default-livequiz-secure-session-secret-key-32-chars-minimum-fallback');

app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: { directives: {
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  } },
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

const sessionCookie = 'livequiz_session';
type Role = 'admin' | 'student';
type Session = { id: string; role: Role };
type AuthRequest = Request & { session?: Session };
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12, path: '/' };
const passkeyLookup = (passkey: string) => createHmac('sha256', secret).update(passkey.toUpperCase()).digest('hex');
const signSession = (session: Session) => jwt.sign(session, secret, { expiresIn: '12h' });
const sendSession = (res: Response, session: Session) => res.cookie(sessionCookie, signSession(session), cookieOptions);
const authenticate = (role?: Role) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies[sessionCookie] as string | undefined;
  try {
    const payload = jwt.verify(token ?? '', secret) as JwtPayload & Session;
    if (!payload.id || (payload.role !== 'admin' && payload.role !== 'student') || (role && payload.role !== role)) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    req.session = { id: payload.id, role: payload.role };
    if (payload.role === 'student') {
      const student = await prisma.student.findUnique({ where: { id: payload.id }, select: { active: true } });
      if (!student?.active) return res.status(401).json({ error: 'This student passkey has been disabled.' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
};
const adminOnly = authenticate('admin');
const studentOnly = authenticate('student');
const objectId = z.string().min(1).max(40);
const questionInput = z.object({
  prompt: z.string().trim().min(1).max(1000),
  marks: z.number().int().min(1).max(100),
  imageUrl: z.string().trim().max(2000).optional().nullable(),
  type: z.enum(['MCQ', 'FILL_BLANK', 'TRUE_FALSE', 'SOLVE']).optional().default('MCQ'),
  options: z.array(z.object({ text: z.string().trim().min(1).max(300), isCorrect: z.boolean() })).min(2).max(8)
    .refine((options) => options.filter((option) => option.isCorrect).length === 1, 'Choose exactly one correct option.'),
});
const quizInput = z.object({
  title: z.string().trim().min(1).max(120),
  mode: z.enum(['LIVE', 'SELF_PACED']),
  timeLimitSeconds: z.number().int().min(60).max(86400).nullable(),
  showResults: z.boolean(),
  questions: z.array(questionInput).min(1).max(100),
}).refine((quiz) => quiz.mode === 'LIVE' || quiz.timeLimitSeconds !== null, 'Timed quizzes need a time limit.');
const parse = <Output, Def extends z.ZodTypeDef = z.ZodTypeDef, Input = any>(schema: z.ZodType<Output, Def, Input>, value: unknown): Output => schema.parse(value);
const errorResponse = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request.' });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'This record already exists.' });
  if (error instanceof Error && error.message) return res.status(400).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
};

async function scoreAttempt(attemptId: string) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId }, include: { answers: { include: { option: true, question: true } } } });
  if (!attempt) return null;
  const score = attempt.answers.reduce((total, answer) => total + (answer.option.isCorrect ? answer.question.marks : 0), 0);
  return prisma.attempt.update({ where: { id: attemptId }, data: { score, status: 'SUBMITTED', submittedAt: attempt.submittedAt ?? new Date() } });
}

async function finishExpiredAttempts() {
  const expired = await prisma.attempt.findMany({ where: { status: 'IN_PROGRESS', deadlineAt: { lte: new Date() } }, select: { id: true } });
  for (const attempt of expired) await scoreAttempt(attempt.id);
}

const questionForStudent = (question: { id: string; prompt: string; marks: number; imageUrl?: string | null; type?: string | null; options: { id: string; text: string; isCorrect: boolean }[] }, reveal: boolean) => ({
  id: question.id,
  prompt: question.prompt,
  marks: question.marks,
  imageUrl: question.imageUrl ?? null,
  type: question.type ?? 'MCQ',
  options: question.options.map(({ id, text, isCorrect }) => reveal ? { id, text, isCorrect } : { id, text }),
});

async function studentQuizState(quizId: string, studentId: string) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } }, attempts: { where: { studentId }, include: { answers: true } } },
  });
  if (!quiz) return null;
  const attempt = quiz.attempts[0] ?? null;
  const isFinished = attempt?.status === 'SUBMITTED' || quiz.status === 'CLOSED';
  const reveal = isFinished || (quiz.mode === 'LIVE' && quiz.currentAnswerRevealed);

  const questions = (quiz.mode === 'LIVE' && !isFinished)
    ? quiz.questions.slice(quiz.currentQuestionIndex, quiz.currentQuestionIndex + 1)
    : quiz.questions;

  const totalMarks = quiz.questions.reduce((sum, q) => sum + q.marks, 0);

  return {
    id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status,
    timeLimitSeconds: quiz.timeLimitSeconds, showResults: quiz.showResults,
    currentQuestionIndex: quiz.currentQuestionIndex, currentAnswerRevealed: quiz.currentAnswerRevealed,
    questionCount: quiz.questions.length,
    totalMarks,
    questions: questions.map((question) => questionForStudent(question, reveal)),
    attempt: attempt ? { id: attempt.id, status: attempt.status, startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt, submittedAt: attempt.submittedAt, score: quiz.showResults ? attempt.score : null, answers: attempt.answers.map(({ questionId, optionId }) => ({ questionId, optionId })) } : null,
  };
}

async function publishQuizState(quizId: string) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: {
        orderBy: { position: 'asc' },
        include: {
          options: {
            orderBy: { position: 'asc' },
          }
        }
      }
    }
  });
  if (!quiz) return;
  const question = quiz.questions[quiz.currentQuestionIndex];
  const totalMarks = quiz.questions.reduce((sum, q) => sum + q.marks, 0);
  let stats = { answered: 0, participants: 0, distribution: [] as { optionId: string; count: number }[], responses: [] as { name: string; optionId: string; text: string }[] };
  if (question) {
    const [answers, participants, responses] = await Promise.all([
      prisma.answer.groupBy({ by: ['optionId'], where: { questionId: question.id, attempt: { quizId } }, _count: { _all: true } }),
      prisma.attempt.count({ where: { quizId } }),
      prisma.answer.findMany({
        where: { questionId: question.id, attempt: { quizId } },
        select: { optionId: true, option: { select: { id: true, text: true } }, attempt: { select: { student: { select: { name: true } } } } },
        orderBy: { updatedAt: 'asc' }
      }),
    ]);
    stats = {
      answered: answers.reduce((sum, answer) => sum + answer._count._all, 0),
      participants,
      distribution: question.options.map((option) => ({ optionId: option.id, count: answers.find((answer) => answer.optionId === option.id)?._count._all ?? 0 })),
      responses: responses.map((answer) => ({ name: answer.attempt.student.name, optionId: answer.option.id, text: answer.option.text })),
    };
  }
  const state = {
    id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status,
    currentQuestionIndex: quiz.currentQuestionIndex, currentAnswerRevealed: quiz.currentAnswerRevealed,
    questionCount: quiz.questions.length,
    totalMarks,
    question: question ? questionForStudent(question, quiz.currentAnswerRevealed) : null,
  };
  io.to(`teachers:${quizId}`).emit('quiz:state', state);
  io.to(`students:${quizId}`).emit('quiz:state', state);
  io.to(`teachers:${quizId}`).emit('quiz:stats', stats);
  io.to('students:lobby').emit('quiz:lobby_updated');
}

app.post('/api/auth/admin', async (req, res) => {
  try {
    const data = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const admin = await prisma.admin.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!admin || !(await bcrypt.compare(data.password, admin.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    sendSession(res, { id: admin.id, role: 'admin' });
    res.json({ user: { role: 'admin', email: admin.email } });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/auth/student', async (req, res) => {
  try {
    const data = parse(z.object({ passkey: z.string().trim().min(4).max(40) }), req.body);
    const student = await prisma.student.findUnique({ where: { passkeyLookup: passkeyLookup(data.passkey) } });
    if (!student?.active || !(await bcrypt.compare(data.passkey.toUpperCase(), student.passkeyHash))) return res.status(401).json({ error: 'That passkey was not recognized.' });
    sendSession(res, { id: student.id, role: 'student' });
    res.json({ user: { role: 'student', name: student.name } });
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/auth/me', authenticate(), async (req: AuthRequest, res) => {
  if (req.session?.role === 'admin') {
    const admin = await prisma.admin.findUnique({ where: { id: req.session.id }, select: { email: true } });
    return res.json({ user: admin ? { role: 'admin', email: admin.email } : null });
  }
  const student = await prisma.student.findUnique({ where: { id: req.session!.id }, select: { name: true, active: true } });
  if (!student?.active) return res.status(401).json({ error: 'This student passkey has been disabled.' });
  return res.json({ user: { role: 'student', name: student.name } });
});
const aiQuizInput = z.object({
  subject: z.string().trim().min(1).max(200),
  grade: z.string().trim().min(1).max(100),
  topic: z.string().trim().min(1).max(500),
  subtopics: z.string().trim().max(1000).optional(),
  difficulty: z.enum(['Easy', 'Moderate', 'Hard']),
  questionCount: z.number().int().min(1).max(50),
  questionType: z.enum(['ALL', 'MCQ', 'FILL_BLANK', 'TRUE_FALSE', 'SOLVE']).default('ALL'),
  mode: z.enum(['LIVE', 'SELF_PACED']),
  details: z.string().trim().max(2000).optional(),
  provider: z.enum(['auto', 'gemini', 'openai']).optional(),
  apiKey: z.string().trim().optional(),
});

function generateTopicQuestions(subject: string, topic: string, subtopics: string | undefined, grade: string, difficulty: string, count: number) {
  const t = topic.toLowerCase();
  const s = subject.toLowerCase();
  void subtopics;

  const generatedQuestions: Array<{ prompt: string; marks: number; options: Array<{ text: string; isCorrect: boolean }> }> = [];

  // Angles & Geometry Topic Bank
  if (t.includes('angle') || t.includes('geometry') || t.includes('triangle') || t.includes('shape')) {
    const angleBank = [
      {
        prompt: `Which type of angle measures greater than 90° but less than 180°?`,
        marks: 1,
        options: [
          { text: `Obtuse angle`, isCorrect: true },
          { text: `Acute angle`, isCorrect: false },
          { text: `Right angle`, isCorrect: false },
          { text: `Reflex angle`, isCorrect: false },
        ]
      },
      {
        prompt: `Two angles are complementary. If one angle measures 35°, what is the measure of the second angle?`,
        marks: 1,
        options: [
          { text: `55°`, isCorrect: true },
          { text: `145°`, isCorrect: false },
          { text: `65°`, isCorrect: false },
          { text: `90°`, isCorrect: false },
        ]
      },
      {
        prompt: `What is the sum of all interior angles of a triangle?`,
        marks: 1,
        options: [
          { text: `180°`, isCorrect: true },
          { text: `360°`, isCorrect: false },
          { text: `90°`, isCorrect: false },
          { text: `270°`, isCorrect: false },
        ]
      },
      {
        prompt: `A clock shows 3:00 PM. What is the measure of the smaller angle between the hour hand and minute hand?`,
        marks: 1,
        options: [
          { text: `90°`, isCorrect: true },
          { text: `45°`, isCorrect: false },
          { text: `120°`, isCorrect: false },
          { text: `180°`, isCorrect: false },
        ]
      },
      {
        prompt: `If two lines intersect each other, what can be stated about the vertically opposite angles formed?`,
        marks: 1,
        options: [
          { text: `They are always equal in measure`, isCorrect: true },
          { text: `They always add up to 90°`, isCorrect: false },
          { text: `One is always acute and one is obtuse`, isCorrect: false },
          { text: `They are always complementary`, isCorrect: false },
        ]
      },
      {
        prompt: `An angle measuring exactly 180° is called a:`,
        marks: 1,
        options: [
          { text: `Straight angle`, isCorrect: true },
          { text: `Right angle`, isCorrect: false },
          { text: `Complete angle`, isCorrect: false },
          { text: `Reflex angle`, isCorrect: false },
        ]
      },
      {
        prompt: `In a triangle ABC, if Angle A = 60° and Angle B = 70°, what is the measure of Angle C?`,
        marks: 2,
        options: [
          { text: `50°`, isCorrect: true },
          { text: `60°`, isCorrect: false },
          { text: `130°`, isCorrect: false },
          { text: `40°`, isCorrect: false },
        ]
      },
      {
        prompt: `Two angles forming a linear pair are always:`,
        marks: 1,
        options: [
          { text: `Supplementary (sum = 180°)`, isCorrect: true },
          { text: `Complementary (sum = 90°)`, isCorrect: false },
          { text: `Equal in measure`, isCorrect: false },
          { text: `Vertically opposite`, isCorrect: false },
        ]
      }
    ];

    for (let i = 0; i < count; i++) {
      generatedQuestions.push(angleBank[i % angleBank.length]);
    }
    return generatedQuestions;
  }

  // Fractions & Arithmetic Bank
  if (s.includes('math') || t.includes('fraction') || t.includes('ratio') || t.includes('percent')) {
    const mathBank = [
      {
        prompt: `Ankit ate 2/8 of a pizza and Rahul ate 3/8 of the same pizza. What fraction of the pizza did they eat altogether?`,
        marks: 1,
        options: [
          { text: `5/8`, isCorrect: true },
          { text: `5/16`, isCorrect: false },
          { text: `6/8`, isCorrect: false },
          { text: `1/8`, isCorrect: false },
        ]
      },
      {
        prompt: `Which of the following fractions is equivalent to 3/4?`,
        marks: 1,
        options: [
          { text: `6/8`, isCorrect: true },
          { text: `3/8`, isCorrect: false },
          { text: `9/16`, isCorrect: false },
          { text: `4/3`, isCorrect: false },
        ]
      },
      {
        prompt: `Riya bought 1/2 kg of apples and 1/4 kg of grapes. How many kilograms of fruit did she buy in total?`,
        marks: 1,
        options: [
          { text: `3/4 kg`, isCorrect: true },
          { text: `2/4 kg`, isCorrect: false },
          { text: `1/6 kg`, isCorrect: false },
          { text: `1 kg`, isCorrect: false },
        ]
      },
      {
        prompt: `Which fraction is the largest among 1/2, 2/3, 3/4, and 1/4?`,
        marks: 2,
        options: [
          { text: `3/4`, isCorrect: true },
          { text: `2/3`, isCorrect: false },
          { text: `1/2`, isCorrect: false },
          { text: `1/4`, isCorrect: false },
        ]
      },
      {
        prompt: `If a cake is cut into 10 equal slices and 4 slices are eaten, what fraction of the cake remains?`,
        marks: 1,
        options: [
          { text: `6/10 (or 3/5)`, isCorrect: true },
          { text: `4/10`, isCorrect: false },
          { text: `2/5`, isCorrect: false },
          { text: `1/2`, isCorrect: false },
        ]
      }
    ];

    for (let i = 0; i < count; i++) {
      generatedQuestions.push(mathBank[i % mathBank.length]);
    }
    return generatedQuestions;
  }

  // Science Bank
  if (s.includes('sci') || s.includes('bio') || t.includes('photo') || t.includes('plant')) {
    const scienceBank = [
      {
        prompt: `During photosynthesis, green plants absorb solar energy using which specialized green pigment in their leaves?`,
        marks: 1,
        options: [
          { text: `Chlorophyll`, isCorrect: true },
          { text: `Carotenoid`, isCorrect: false },
          { text: `Hemoglobin`, isCorrect: false },
          { text: `Stomata`, isCorrect: false },
        ]
      },
      {
        prompt: `What are the two main raw materials taken in by plants to perform photosynthesis?`,
        marks: 1,
        options: [
          { text: `Carbon dioxide and Water`, isCorrect: true },
          { text: `Oxygen and Glucose`, isCorrect: false },
          { text: `Nitrogen and Soil`, isCorrect: false },
          { text: `Carbon dioxide and Oxygen`, isCorrect: false },
        ]
      },
      {
        prompt: `Which vital gas is released into the atmosphere as a byproduct during photosynthesis?`,
        marks: 1,
        options: [
          { text: `Oxygen (O2)`, isCorrect: true },
          { text: `Carbon Dioxide (CO2)`, isCorrect: false },
          { text: `Nitrogen (N2)`, isCorrect: false },
          { text: `Hydrogen (H2)`, isCorrect: false },
        ]
      }
    ];

    for (let i = 0; i < count; i++) {
      generatedQuestions.push(scienceBank[i % scienceBank.length]);
    }
    return generatedQuestions;
  }

  // Fallback realistic CBSE application questions (never meta questions)
  const defaultBank = [
    {
      prompt: `Which of the following statements best illustrates a practical application of ${topic} in daily life?`,
      marks: difficulty === 'Hard' ? 2 : 1,
      options: [
        { text: `Using core concepts of ${topic} to solve everyday practical problems efficiently.`, isCorrect: true },
        { text: `Memorizing formulas without understanding their real-world context.`, isCorrect: false },
        { text: `Assuming ${topic} only exists in textbook exercises.`, isCorrect: false },
        { text: `Ignoring measurements and estimating randomly without calculation.`, isCorrect: false },
      ]
    },
    {
      prompt: `When investigating ${topic} in ${grade} ${subject}, which step is essential for reaching a valid conclusion?`,
      marks: 1,
      options: [
        { text: `Observing given facts, collecting evidence, and applying key principles.`, isCorrect: true },
        { text: `Selecting an answer based on a guess without checking calculations.`, isCorrect: false },
        { text: `Disregarding experimental data that contradicts initial assumptions.`, isCorrect: false },
        { text: `Changing the original problem values to make the calculation simpler.`, isCorrect: false },
      ]
    }
  ];

  for (let i = 0; i < count; i++) {
    generatedQuestions.push(defaultBank[i % defaultBank.length]);
  }

  return generatedQuestions;
}

function parseAIResponseJSON(rawText: string, data: z.infer<typeof aiQuizInput>) {
  try {
    const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleanJson);
    const rawQuestions = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);

    if (!rawQuestions || rawQuestions.length === 0) return null;

    const questions = rawQuestions.map((q: any) => {
      const promptText = q.question || q.prompt || '';
      const rawOptions = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
      let correctIdx = 0;

      if (typeof q.answer === 'string') {
        const letter = q.answer.trim().toUpperCase();
        if (letter === 'B' || letter === '2') correctIdx = 1;
        else if (letter === 'C' || letter === '3') correctIdx = 2;
        else if (letter === 'D' || letter === '4') correctIdx = 3;
      }

      const options = rawOptions.map((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          return { text: opt, isCorrect: idx === correctIdx };
        }
        return { text: opt.text ?? String(opt), isCorrect: Boolean(opt.isCorrect ?? (idx === correctIdx)) };
      });

      if (!options.some((o: any) => o.isCorrect) && options.length > 0) {
        options[0].isCorrect = true;
      }

      const typeVal = (q.type && ['MCQ', 'FILL_BLANK', 'TRUE_FALSE', 'SOLVE'].includes(q.type))
        ? q.type
        : (data.questionType && data.questionType !== 'ALL' ? data.questionType : 'MCQ');

      return {
        prompt: promptText,
        marks: data.difficulty === 'Hard' ? 2 : 1,
        imageUrl: q.imageUrl && typeof q.imageUrl === 'string' ? q.imageUrl : null,
        type: typeVal,
        options,
      };
    });

    return {
      title: parsed.title || `${data.subject}: ${data.topic} (${data.grade} - CBSE NEP)`,
      questions,
    };
  } catch (err) {
    console.warn('Failed to parse AI JSON response:', err);
    return null;
  }
}

function buildMasterCBSEPrompt(data: z.infer<typeof aiQuizInput>) {
  return `# ROLE

You are an experienced CBSE school teacher, examination question-paper setter and competency-based assessment expert.

Your task is to generate high-quality quiz questions for a CBSE-based online learning and live quiz platform.

Questions must reflect the current teaching and assessment approach followed in CBSE schools and should be aligned with the competency-based education principles of NEP 2020 and the latest applicable CBSE curriculum and Sample Question Paper pattern.

Do NOT create questions that merely test rote memorisation unless factual recall is genuinely required for the topic.

The primary objective is to test:

1. Conceptual understanding
2. Application of knowledge
3. Reasoning
4. Critical thinking
5. Problem solving
6. Analysis
7. Interpretation
8. Evaluation
9. Real-life application
10. Ability to identify and correct misconceptions

---

# INPUTS

The quiz generator will receive the following information:

Class/Grade: ${data.grade}
Subject: ${data.subject}
Chapter/Topic: ${data.topic}
Number of Questions: ${data.questionCount}
Difficulty: ${data.difficulty}
Quiz Type: ${data.mode === 'LIVE' ? 'LIVE TEACHER-LED' : 'COMPLETE TIMED QUIZ'}
Language: ENGLISH
Question Type: ${data.questionType || 'ALL'}
Sub-Topics: ${data.subtopics || 'Core concepts'}
Additional Details: ${data.details || 'None'}

If any of these inputs are not provided, use sensible defaults appropriate for the selected class and subject.

---

# 1. CBSE ALIGNMENT

Generate questions according to the latest applicable CBSE curriculum and examination style.

Use the latest CBSE Sample Question Papers and question-paper design as the primary reference for Classes X and XII.

For lower classes, follow the same competency-based philosophy but adapt the complexity, vocabulary and reasoning level to the age of the learner.

Do not incorrectly apply the Class X/XII board-paper structure to primary or middle-school students.

Questions must remain within the prescribed syllabus.

Do not introduce advanced concepts simply to make a question difficult.

---

# 2. COMPETENCY DISTRIBUTION

Do not make the quiz entirely recall-based.

Prefer a balanced distribution such as:

• Knowledge & Understanding: approximately 30–40%
• Application: approximately 25–30%
• Analysis/Reasoning: approximately 20–25%
• Higher-order thinking/Evaluation: approximately 10–20%

The exact distribution may be adjusted according to the class, subject, chapter and nature of the topic.

For Classes IX–XII, increase the proportion of application, analysis and competency-based questions.

For Classes III–V, maintain age-appropriate conceptual and application-based questions without making the language unnecessarily difficult.

---

# 3. QUESTION TYPES

When "MIXED" is selected, intelligently combine suitable question formats.

Use:

### A. Standard MCQ

Four options:
A
B
C
D

Only ONE option must be correct.

Questions should test understanding rather than merely recognition.

Example style:

Instead of:
"What is the formula for the area of a rectangle?"

Prefer:
"Riya wants to cover a rectangular notice board measuring 2 m × 1.5 m with coloured paper. How much paper is required?"

The second question tests application of the concept.

---

### B. Assertion–Reason

Use the standard CBSE-style structure when appropriate.

Assertion (A): [statement]

Reason (R): [statement]

Options:

A. Both A and R are true and R is the correct explanation of A.
B. Both A and R are true but R is not the correct explanation of A.
C. A is true but R is false.
D. A is false but R is true.

Do not create artificial or ambiguous Assertion–Reason questions.

The Reason must have a meaningful logical relationship with the Assertion.

---

### C. Case-Based Questions

Present a short real-life situation, experiment, table, data set, scenario or passage.

Then ask one or more questions based on it.

The case should contain enough information for students to solve the question.

Do not make the case unnecessarily long.

Examples of contexts:
Shopping, Banking, School activities, Sports, Environment, Transportation, Household situations, Science experiments, Business, Technology, Data interpretation, Everyday mathematical situations.

---

### D. Competency/Application Question

Give a situation where the student must apply a known concept in a slightly unfamiliar context.

Avoid simply changing numbers in a textbook question.

The question should require the student to decide WHICH concept or method should be used.

---

### E. Data/Graph/Table-Based Question

Where appropriate, provide tables, graphs, charts, measurements, experimental observations, numerical data.

Ask students to interpret the information rather than merely read a value.

---

### F. HOTS / Reasoning Question

Use questions beginning with ideas such as:

• Which conclusion is most reasonable?
• What would happen if...?
• Which method would be most appropriate?
• Why would this result occur?
• Which statement best explains...?
• Which option provides the strongest evidence?
• What can you infer from the information?
• Which solution is more efficient and why?

Do not use "HOTS" merely as a label. The actual question must require reasoning.

---

# 4. DISTRACTOR DESIGN

This is extremely important.

Incorrect options must NOT be random or silly.

Each distractor should represent a realistic student misconception, calculation error or misunderstanding.

Every option must be independently checked to ensure that only one option is correct.

---

# 5. REAL-LIFE APPLICATION

Whenever naturally possible, connect concepts to real-life situations.

---

# 6. DIFFICULTY LEVEL

Difficulty must be controlled intelligently.

EASY: Tests basic understanding directly.
MODERATE: Requires application, interpretation or 1-2 reasoning steps.
DIFFICULT: Requires multiple steps, comparison, inference, analysis or application in an unfamiliar situation.

---

# 7. LANGUAGE

Use clear, natural CBSE-style language.

Questions should be:
• grammatically correct
• age appropriate
• concise
• unambiguous
• free from unnecessary jargon

---

# 8. MATHEMATICS QUESTIONS

For Mathematics:
• Verify every calculation independently.
• Ensure exactly one answer is correct.
• Use realistic numerical values.
• Avoid unnecessary calculations.
• Test conceptual understanding wherever possible.
• Include application-based problems.
• Include reasoning questions.
• Include error-analysis questions where appropriate.
• Use units correctly.

---

# 9. SCIENCE QUESTIONS

For Science:
Include a suitable mixture of conceptual understanding, everyday applications, experiments, observation-based questions, cause-and-effect reasoning, data interpretation, Assertion–Reason, case-based questions.

---

# 10. SOCIAL SCIENCE QUESTIONS

For Social Science:
Include source-based questions, case studies, map/data interpretation, cause-effect relationships, comparison, Assertion–Reason.

---

# 11. ENGLISH / LANGUAGES

For language subjects: reading comprehension, grammar in context, vocabulary in context, inference, critical reading.

---

# 12. QUESTION QUALITY RULES

Before returning ANY question, verify syllabus alignment, factual accuracy, unambiguous wording, exactly one correct answer, plausible distractors, assessing understanding over memorisation.

---

# 13. LIVE QUIZ MODE

When "LIVE TEACHER-LED": Generate concise questions suitable for displaying one at a time for live classroom participation.

---

# 14. COMPLETE TIMED QUIZ MODE

When "COMPLETE TIMED QUIZ": Generate a balanced examination-style question set.

---

# 15. QUESTION SEQUENCING

Vary order and test different competencies progressively.

---

# 16. FEEDBACK

For every question, generate a teacher-quality explanation detailing why the correct answer is right and common misconceptions involved.

---

# 17. HINT

Every question should optionally have a pedagogical hint guiding student thinking without revealing the answer.

---

# 18. AVOID QUESTION REPETITION

Maintain awareness of previously generated questions. Do not repeat questions or numerical structures.

---

# 19. ANSWER DISTRIBUTION

Distribute correct answers naturally across A, B, C and D.

---

# 20. TEACHER/ADMIN METADATA

Maintain internal metadata including Learning Outcome and Misconception Tested.

---

# 21. LEARNING OUTCOME ALIGNMENT

Every question should map to an appropriate learning outcome.

---

# 22. FINAL VALIDATION

Act as a strict CBSE examiner. Review every question once more. Reject and regenerate any question that contains errors or ambiguous wording.

The final quiz must be classroom-ready and suitable for use by a CBSE teacher.

---

# IMPORTANT PRINCIPLE

Do not try to make every question "difficult".
A good CBSE competency-based quiz measures whether students can:
UNDERSTAND -> APPLY -> REASON -> ANALYSE -> EVALUATE
rather than simply:
MEMORISE -> REPEAT

Generate questions like an experienced CBSE teacher, not like a generic AI question generator.

---

# OUTPUT FORMAT (STRICT JSON ONLY)

Return ONLY a valid raw JSON object (no markdown formatting, no code block fences, no extra text before or after JSON) using this exact schema:
{
  "title": "${data.subject}: ${data.topic} (${data.grade} - CBSE NEP)",
  "questions": [
    {
      "question": "Clear, contextual question text written like an authentic CBSE exam paper question...",
      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
      "answer": "A",
      "explanation": "Detailed teacher explanation clarifying concepts and misconceptions.",
      "hint": "Pedagogical hint guiding student thinking."
    }
  ]
}`;
}

async function generateAIQuiz(data: z.infer<typeof aiQuizInput>) {
  const customKey = data.apiKey?.trim();
  const selectedProvider = data.provider || 'auto';

  const geminiKey = selectedProvider === 'gemini' ? (customKey || process.env.GEMINI_API_KEY) : (process.env.GEMINI_API_KEY || (selectedProvider === 'auto' ? customKey : undefined));
  const openaiKey = selectedProvider === 'openai' ? (customKey || process.env.OPENAI_API_KEY) : (process.env.OPENAI_API_KEY || (selectedProvider === 'auto' ? customKey : undefined));

  // Enforce API Key requirements per provider selection
  if (selectedProvider === 'gemini' && !geminiKey) {
    throw new Error('Google Gemini API Key is required. Please paste your Gemini API Key in the field below or set GEMINI_API_KEY in your server .env file.');
  }
  if (selectedProvider === 'openai' && !openaiKey) {
    throw new Error('ChatGPT (OpenAI) API Key is required. Please paste your OpenAI API Key in the field below or set OPENAI_API_KEY in your server .env file.');
  }
  if (selectedProvider === 'auto' && !geminiKey && !openaiKey) {
    throw new Error('API Key is required for AI Quiz Generation. Please select Google Gemini or ChatGPT in the provider dropdown and paste your API key in the field below.');
  }

  const systemRole = `You are an experienced CBSE school teacher, examination question-paper setter and competency-based assessment expert. Generate high-quality quiz questions aligned with NEP 2020/2026 principles.`;
  const prompt = buildMasterCBSEPrompt(data);

  if (selectedProvider === 'openai' || (selectedProvider === 'auto' && openaiKey && !geminiKey)) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemRole },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });
    const jsonResult: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMessage = jsonResult?.error?.message ?? response.statusText;
      throw new Error(`ChatGPT OpenAI Error: ${errMessage}`);
    }
    const content = jsonResult.choices?.[0]?.message?.content;
    if (content) {
      const parsed = parseAIResponseJSON(content, data);
      if (parsed && parsed.questions.length > 0) return parsed;
    }
    throw new Error('ChatGPT returned an unparseable response. Please try again.');
  }

  if (selectedProvider === 'gemini' || (selectedProvider === 'auto' && geminiKey)) {
    const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro', 'gemini-pro'];
    let lastError = '';

    for (const modelName of candidateModels) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemRole}\n\n${prompt}` }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        });
        const jsonResult: any = await response.json().catch(() => ({}));
        if (!response.ok) {
          lastError = jsonResult?.error?.message ?? response.statusText;
          if (lastError.includes('not found') || response.status === 404) {
            continue;
          }
          throw new Error(`Google Gemini Error: ${lastError}`);
        }
        const textOutput = jsonResult.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textOutput) {
          const parsed = parseAIResponseJSON(textOutput, data);
          if (parsed && parsed.questions.length > 0) return parsed;
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Google Gemini Error:')) {
          throw err;
        }
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(`Google Gemini Error: ${lastError || 'No supported Gemini model found for your API Key.'}`);
  }

  const questions = generateTopicQuestions(data.subject, data.topic, data.subtopics, data.grade, data.difficulty, data.questionCount);
  return {
    title: `${data.subject}: ${data.topic} (${data.grade} - CBSE NEP)`,
    questions,
  };
}

app.post('/api/ai/generate-quiz', adminOnly, async (req, res) => {
  try {
    const data = parse(aiQuizInput, req.body);
    const quizResult = await generateAIQuiz(data);
    res.json(quizResult);
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/quizzes', adminOnly, async (_req, res) => {
  const quizzes = await prisma.quiz.findMany({ orderBy: { updatedAt: 'desc' }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } }, _count: { select: { questions: true, attempts: true } } } });
  res.json({ quizzes });
});
app.post('/api/quizzes', adminOnly, async (req, res) => {
  try {
    const data = parse(quizInput, req.body);
    const quiz = await prisma.quiz.create({ data: {
      title: data.title, mode: data.mode as QuizMode,
      timeLimitSeconds: data.mode === 'LIVE' ? null : data.timeLimitSeconds,
      showResults: data.showResults,
      questions: { create: data.questions.map((question, position) => ({ prompt: question.prompt, marks: question.marks, imageUrl: question.imageUrl ?? null, type: question.type ?? 'MCQ', position, options: { create: question.options.map((option, optionPosition) => ({ ...option, position: optionPosition })) } })) },
    } });
    res.status(201).json({ quiz });
  } catch (error) { errorResponse(res, error); }
});
app.get('/api/quizzes/:id/detail', adminOnly, async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: parse(objectId, req.params.id) }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    res.json({ quiz });
  } catch (error) { errorResponse(res, error); }
});
app.put('/api/quizzes/:id', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const data = parse(quizInput, req.body);
    const existing = await prisma.quiz.findUnique({ where: { id }, include: { _count: { select: { attempts: true } } } });
    if (!existing) return res.status(404).json({ error: 'Quiz not found.' });
    if (existing.status === 'ACTIVE' || existing._count.attempts > 0) return res.status(409).json({ error: 'A quiz with active or submitted attempts cannot be edited.' });
    await prisma.$transaction(async (tx) => {
      await tx.question.deleteMany({ where: { quizId: id } });
      await tx.quiz.update({ where: { id }, data: {
        title: data.title, mode: data.mode as QuizMode, timeLimitSeconds: data.mode === 'LIVE' ? null : data.timeLimitSeconds,
        showResults: data.showResults, currentQuestionIndex: 0, currentAnswerRevealed: false,
        questions: { create: data.questions.map((question, position) => ({ prompt: question.prompt, marks: question.marks, imageUrl: question.imageUrl ?? null, type: question.type ?? 'MCQ', position, options: { create: question.options.map((option, optionPosition) => ({ ...option, position: optionPosition })) } })) },
      } });
    }, { timeout: 30000, maxWait: 10000 });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});
app.delete('/api/quizzes/:id', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    await prisma.quiz.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});
app.patch('/api/quizzes/:id/status', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const { action } = parse(z.object({ action: z.enum(['start', 'stop']) }), req.body);
    const quiz = await prisma.quiz.findUnique({ where: { id } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    if (quiz.mode !== 'SELF_PACED') return res.status(400).json({ error: 'Use live controls for a classroom quiz.' });
    if (action === 'start' && quiz.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft quiz can be opened.' });
    if (action === 'stop' && quiz.status !== 'ACTIVE') return res.status(409).json({ error: 'This quiz is not open.' });
    await prisma.quiz.update({ where: { id }, data: { status: action === 'start' ? 'ACTIVE' : 'CLOSED' } });
    if (action === 'stop') {
      const attempts = await prisma.attempt.findMany({ where: { quizId: id, status: 'IN_PROGRESS' }, select: { id: true } });
      for (const attempt of attempts) await scoreAttempt(attempt.id);
    }
    res.json({ ok: true });
    void publishQuizState(id);
  } catch (error) { errorResponse(res, error); }
});
app.patch('/api/quizzes/:id/control', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const { action } = parse(z.object({ action: z.enum(['start', 'next', 'reveal', 'stop']) }), req.body);
    const quiz = await prisma.quiz.findUnique({ where: { id }, include: { _count: { select: { questions: true } } } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    if (quiz.mode !== 'LIVE') return res.status(400).json({ error: 'Only live quizzes have teacher controls.' });
    if (action === 'start') {
      if (quiz.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft quiz can be started.' });
      await prisma.quiz.update({ where: { id }, data: { status: 'ACTIVE', currentQuestionIndex: 0, currentAnswerRevealed: false } });
    } else if (action === 'next') {
      if (quiz.status !== 'ACTIVE') return res.status(409).json({ error: 'This quiz is not active.' });
      const nextIndex = quiz.currentQuestionIndex + 1;
      if (nextIndex >= quiz._count.questions) {
        await prisma.quiz.update({ where: { id }, data: { status: 'CLOSED' } });
        const attempts = await prisma.attempt.findMany({ where: { quizId: id, status: 'IN_PROGRESS' }, select: { id: true } });
        for (const attempt of attempts) await scoreAttempt(attempt.id);
      } else {
        await prisma.quiz.update({ where: { id }, data: { currentQuestionIndex: nextIndex, currentAnswerRevealed: false } });
      }
    } else if (action === 'reveal') {
      if (quiz.status !== 'ACTIVE') return res.status(409).json({ error: 'This quiz is not active.' });
      await prisma.quiz.update({ where: { id }, data: { currentAnswerRevealed: true } });
    } else {
      await prisma.quiz.update({ where: { id }, data: { status: 'CLOSED' } });
      const attempts = await prisma.attempt.findMany({ where: { quizId: id, status: 'IN_PROGRESS' }, select: { id: true } });
      for (const attempt of attempts) await scoreAttempt(attempt.id);
    }
    res.json({ ok: true });
    void publishQuizState(id);
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/quizzes/:id/restart', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const quiz = await prisma.quiz.findUnique({ where: { id } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });

    await prisma.$transaction(async (tx) => {
      const attempts = await tx.attempt.findMany({ where: { quizId: id }, select: { id: true } });
      const attemptIds = attempts.map((attempt) => attempt.id);
      if (attemptIds.length > 0) {
        await tx.answer.deleteMany({ where: { attemptId: { in: attemptIds } } });
        await tx.attempt.deleteMany({ where: { quizId: id } });
      }
      await tx.quiz.update({
        where: { id },
        data: {
          status: 'DRAFT',
          currentQuestionIndex: 0,
          currentAnswerRevealed: false,
        },
      });
    }, { timeout: 30000, maxWait: 10000 });

    await publishQuizState(id);
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});

function generateShortPasskey(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(6);
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

app.get('/api/students', adminOnly, async (_req, res) => {
  const students = await prisma.student.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, passkey: true, active: true, createdAt: true, _count: { select: { attempts: true } } } });
  for (const student of students) {
    if (!student.passkey) {
      const passkey = generateShortPasskey();
      await prisma.student.update({
        where: { id: student.id },
        data: { passkey, passkeyHash: await bcrypt.hash(passkey, 12), passkeyLookup: passkeyLookup(passkey) },
      });
      student.passkey = passkey;
    }
  }
  res.json({ students });
});
app.post('/api/students', adminOnly, async (req, res) => {
  try {
    const data = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
    const passkey = generateShortPasskey();
    const student = await prisma.student.create({ data: { name: data.name, passkey, passkeyHash: await bcrypt.hash(passkey, 12), passkeyLookup: passkeyLookup(passkey) }, select: { id: true, name: true, passkey: true, active: true } });
    res.status(201).json({ student, passkey });
  } catch (error) { errorResponse(res, error); }
});
app.patch('/api/students/:id', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const data = parse(z.object({ active: z.boolean().optional(), name: z.string().trim().min(1).max(100).optional(), resetPasskey: z.boolean().optional() }), req.body);
    const passkey = data.resetPasskey ? generateShortPasskey() : null;
    const student = await prisma.student.update({ where: { id }, data: { active: data.active, name: data.name, ...(passkey ? { passkey, passkeyHash: await bcrypt.hash(passkey, 12), passkeyLookup: passkeyLookup(passkey) } : {}) }, select: { id: true, name: true, passkey: true, active: true } });
    res.json({ student, ...(passkey ? { passkey } : {}) });
  } catch (error) { errorResponse(res, error); }
});
app.delete('/api/students/:id', adminOnly, async (req, res) => {
  try { await prisma.student.delete({ where: { id: parse(objectId, req.params.id) } }); res.json({ ok: true }); }
  catch (error) { errorResponse(res, error); }
});
app.get('/api/quizzes/:id/results', adminOnly, async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: parse(objectId, req.params.id) }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } }, attempts: { include: { student: { select: { name: true } }, answers: { include: { question: true, option: true } } }, orderBy: { startedAt: 'asc' } } } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    const totalMarks = quiz.questions.reduce((sum, question) => sum + question.marks, 0);
    const results = quiz.attempts.map((attempt) => ({ id: attempt.id, name: attempt.student.name, status: attempt.status, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, score: attempt.score, totalMarks, answers: attempt.answers.map((answer) => ({ questionId: answer.questionId, question: answer.question.prompt, response: answer.option.text, correct: answer.option.isCorrect, marks: answer.question.marks })) }));
    const distribution = quiz.questions.map((question) => ({ question: question.prompt, options: question.options.map((option) => ({ text: option.text, correct: option.isCorrect, count: quiz.attempts.reduce((count, attempt) => count + attempt.answers.filter((answer) => answer.optionId === option.id).length, 0) })) }));
    res.json({ quiz: { id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status }, results, distribution });
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/student/quizzes', studentOnly, async (req: AuthRequest, res) => {
  const studentId = req.session!.id;
  const quizzes = await prisma.quiz.findMany({ where: { OR: [
    { status: 'ACTIVE' },
    { attempts: { some: { studentId } } },
  ] }, orderBy: { createdAt: 'desc' }, include: { questions: { select: { marks: true } }, _count: { select: { questions: true } }, attempts: { where: { studentId }, select: { status: true, deadlineAt: true, score: true, submittedAt: true } } } });
  res.json({ quizzes: quizzes.map((quiz) => {
    const totalMarks = quiz.questions.reduce((sum, q) => sum + q.marks, 0);
    return {
      id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status,
      timeLimitSeconds: quiz.timeLimitSeconds, questionCount: quiz._count.questions,
      totalMarks, attempt: quiz.attempts[0] ?? null
    };
  }) });
});
app.get('/api/student/quizzes/:id', studentOnly, async (req: AuthRequest, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const quiz = await prisma.quiz.findUnique({ where: { id }, select: { id: true, status: true, mode: true, timeLimitSeconds: true } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    let attempt = await prisma.attempt.findUnique({ where: { quizId_studentId: { quizId: id, studentId: req.session!.id } } });
    if (!attempt && quiz.status === 'ACTIVE') {
      const now = new Date();
      attempt = await prisma.attempt.upsert({
        where: { quizId_studentId: { quizId: id, studentId: req.session!.id } },
        update: {},
        create: { quizId: id, studentId: req.session!.id, deadlineAt: quiz.mode === 'SELF_PACED' ? new Date(now.getTime() + (quiz.timeLimitSeconds ?? 0) * 1000) : null },
      });
    }
    const state = await studentQuizState(id, req.session!.id);
    if (!state) return res.status(404).json({ error: 'Quiz details not found.' });
    res.json({ quiz: state });
  } catch (error) { errorResponse(res, error); }
});
app.put('/api/student/quizzes/:id/answers', studentOnly, async (req: AuthRequest, res) => {
  try {
    const quizId = parse(objectId, req.params.id);
    const { questionId, optionId } = parse(z.object({ questionId: objectId, optionId: objectId }), req.body);
    const [quiz, attempt, option] = await Promise.all([
      prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true, status: true, mode: true, currentQuestionIndex: true, currentAnswerRevealed: true } }),
      prisma.attempt.findUnique({ where: { quizId_studentId: { quizId, studentId: req.session!.id } }, select: { id: true, status: true } }),
      prisma.option.findUnique({ where: { id: optionId }, select: { id: true, questionId: true } }),
    ]);
    if (!quiz || !attempt || attempt.status !== 'IN_PROGRESS' || quiz.status !== 'ACTIVE') return res.status(409).json({ error: 'This quiz is no longer accepting answers.' });
    if (!option || option.questionId !== questionId) return res.status(400).json({ error: 'That answer does not belong to this question.' });
    if (quiz.mode === 'LIVE' && quiz.currentAnswerRevealed) return res.status(409).json({ error: 'The live question has been revealed.' });
    await prisma.answer.upsert({ where: { attemptId_questionId: { attemptId: attempt.id, questionId } }, create: { attemptId: attempt.id, questionId, optionId }, update: { optionId } });
    res.json({ ok: true });
    if (quiz.mode === 'LIVE') void publishQuizState(quizId);
  } catch (error) { errorResponse(res, error); }
});
app.post('/api/student/quizzes/:id/submit', studentOnly, async (req: AuthRequest, res) => {
  try {
    const quizId = parse(objectId, req.params.id);
    const attempt = await prisma.attempt.findUnique({ where: { quizId_studentId: { quizId, studentId: req.session!.id } } });
    if (!attempt) return res.status(404).json({ error: 'Quiz attempt not found.' });
    const submitted = attempt.status === 'SUBMITTED' ? attempt : await scoreAttempt(attempt.id);
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { showResults: true } });
    res.json({ submitted: true, score: quiz?.showResults ? submitted?.score : null });
  } catch (error) { errorResponse(res, error); }
});

io.use(async (socket, next) => {
  const cookie = socket.handshake.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`));
  try {
    const token = cookie?.slice(sessionCookie.length + 1) ?? '';
    const payload = jwt.verify(token, secret) as JwtPayload & Session;
    if (!payload.id || (payload.role !== 'admin' && payload.role !== 'student')) return next(new Error('Unauthorized'));
    if (payload.role === 'student' && !(await prisma.student.findFirst({ where: { id: payload.id, active: true }, select: { id: true } }))) return next(new Error('Unauthorized'));
    socket.data.session = { id: payload.id, role: payload.role } satisfies Session;
    next();
  } catch { next(new Error('Unauthorized')); }
});
io.on('connection', (socket) => {
  const session = socket.data.session as Session;
  if (session.role === 'student') {
    socket.join('students:lobby');
  }
  socket.on('watch:quiz', async (quizId: string) => {
    if (typeof quizId !== 'string') return;
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true, status: true } });
    if (!quiz) return;
    if (session.role === 'admin') socket.join(`teachers:${quizId}`);
    else if (quiz.status === 'ACTIVE' && await prisma.attempt.findUnique({ where: { quizId_studentId: { quizId, studentId: session.id } }, select: { id: true } })) socket.join(`students:${quizId}`);
    await publishQuizState(quizId);
  });
});

app.use(express.static(resolve('dist')));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(resolve('dist/index.html'), (error) => { if (error) next(error); });
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => errorResponse(res, error));

setInterval(() => { void finishExpiredAttempts().catch(() => {}); }, 5000).unref();
async function startServer() {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    try {
      const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await prisma.admin.upsert({ where: { email: process.env.ADMIN_EMAIL.toLowerCase() }, update: { passwordHash }, create: { email: process.env.ADMIN_EMAIL.toLowerCase(), passwordHash } });
      console.log('✅ Default admin account ready.');
    } catch (err) {
      console.error('⚠️ Admin seeding skipped (DB connection pending):', err);
    }
  }
  httpServer.listen(port, '0.0.0.0', () => console.log(`LiveQuiz server listening on port ${port}`));
}
void startServer();
