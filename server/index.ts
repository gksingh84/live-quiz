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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { Prisma, PrismaClient, type QuizMode } from '@prisma/client';
import { Server } from 'socket.io';
import { z } from 'zod';

const prisma = new PrismaClient();
const db: any = prisma;
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
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdnjs.cloudflare.com'],
      workerSrc: ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
      frameSrc: ["'self'", 'https://www.youtube.com', 'https://youtube.com'],
      connectSrc: ["'self'", 'https:', 'wss:', 'ws:'],
    }
  },
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));
app.use(cookieParser());
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/me' || req.path === '/logout',
  message: { error: 'Too many authentication attempts. Please try again in a few minutes.' },
}));

const sessionCookie = 'livequiz_session';
type Role = 'superadmin' | 'teacher' | 'admin' | 'student';
type Session = { id: string; role: Role; username?: string; email?: string; name?: string };
type AuthRequest = Request & { session?: Session };
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12, path: '/' };
const passkeyLookup = (passkey: string) => createHmac('sha256', 'livequiz-passkey-lookup-salt').update(passkey.toUpperCase()).digest('hex');
const signSession = (session: Session) => jwt.sign(session, secret, { expiresIn: '12h' });
const sendSession = (res: Response, session: Session) => res.cookie(sessionCookie, signSession(session), cookieOptions);

const authenticate = (allowedRoles?: Role | Role[]) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies[sessionCookie] as string | undefined;
  try {
    const payload = jwt.verify(token ?? '', secret) as JwtPayload & Session;
    if (!payload.id || !payload.role) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (allowedRoles) {
      const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
      const match = roles.includes(payload.role) || (roles.includes('teacher') && payload.role === 'admin');
      if (!match) {
        return res.status(403).json({ error: 'Access denied: insufficient permissions.' });
      }
    }
    req.session = { id: payload.id, role: payload.role, username: payload.username, email: payload.email, name: payload.name };
    if (payload.role === 'student') {
      const student = await prisma.student.findUnique({ where: { id: payload.id }, select: { active: true } });
      if (!student?.active) return res.status(401).json({ error: 'This student passkey has been disabled.' });
    } else if (payload.role === 'teacher') {
      const teacher = await db.teacher.findUnique({ where: { id: payload.id }, select: { active: true } });
      if (!teacher?.active) return res.status(403).json({ error: 'This teacher account is pending activation by the Administrator.' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
};
const superAdminOnly = authenticate('superadmin');
const teacherOnly = authenticate(['teacher', 'admin']);
const adminOnly = teacherOnly; // Backward compatibility alias
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
  grade: z.string().trim().min(1).max(50).nullable().optional(),
  mode: z.enum(['LIVE', 'SELF_PACED']),
  timeLimitSeconds: z.number().int().nullable().optional(),
  showResults: z.boolean(),
  questions: z.array(questionInput).min(1).max(100),
});
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
    const attemptFilter = quiz.status === 'ACTIVE' ? { quizId, status: 'IN_PROGRESS' as const } : { quizId };
    const [answers, participants, responses] = await Promise.all([
      prisma.answer.groupBy({ by: ['optionId'], where: { questionId: question.id, attempt: attemptFilter }, _count: { _all: true } }),
      prisma.attempt.count({ where: attemptFilter }),
      prisma.answer.findMany({
        where: { questionId: question.id, attempt: attemptFilter },
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

// Super Admin Auth Endpoint (Username/Email + Password + Secret Key)
app.post('/api/auth/superadmin', async (req: Request, res: Response) => {
  try {
    const data = parse(z.object({
      username: z.string().trim().min(1).max(100),
      password: z.string().min(1).max(200),
      secretKey: z.string().min(1).max(200),
    }), req.body);

    const inputUser = data.username.toLowerCase();
    const envUser = (process.env.SUPERADMIN_USERNAME || 'admin').toLowerCase();
    const envPass = process.env.SUPERADMIN_PASSWORD || 'adminpassword123';
    const envSecret = process.env.SUPERADMIN_SECRET_KEY || 'eduashram@secret2026';
    const envEmail = (process.env.SUPERADMIN_EMAIL || 'gaurav.kr.singh@hotmail.com').toLowerCase();

    let superAdmin = await db.superAdmin.findFirst({
      where: {
        OR: [
          { username: { equals: inputUser, mode: 'insensitive' } },
          { email: { equals: inputUser, mode: 'insensitive' } },
        ]
      }
    });

    let isValid = false;
    if (superAdmin) {
      const passMatch = (await bcrypt.compare(data.password, superAdmin.passwordHash)) || (data.password === envPass);
      const secretMatch = (await bcrypt.compare(data.secretKey, superAdmin.secretKeyHash)) || (data.secretKey === envSecret);
      if (passMatch && secretMatch) isValid = true;
    } else if ((inputUser === envUser || inputUser === envEmail) && data.password === envPass && data.secretKey === envSecret) {
      // Auto-create from .env if record missing
      const superAdminPasswordHash = await bcrypt.hash(envPass, 12);
      const superAdminSecretKeyHash = await bcrypt.hash(envSecret, 12);
      superAdmin = await db.superAdmin.create({
        data: {
          username: envUser,
          email: envEmail,
          passwordHash: superAdminPasswordHash,
          secretKeyHash: superAdminSecretKeyHash,
        }
      });
      isValid = true;
    }

    if (!isValid || !superAdmin) {
      return res.status(401).json({ error: 'Invalid Super Admin credentials or Secret Key.' });
    }

    const session: Session = { id: superAdmin.id, role: 'superadmin', username: superAdmin.username, email: superAdmin.email };
    sendSession(res, session);
    res.json({ user: session });
  } catch (error) { errorResponse(res, error); }
});

// Teacher Sign Up (Pending Super Admin Approval)
app.post('/api/auth/teacher/signup', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().email().max(150),
      password: z.string().min(6).max(200),
      school: z.string().trim().max(200).optional().nullable(),
      subject: z.string().trim().max(100).optional().nullable(),
      phone: z.string().trim().max(30).optional().nullable(),
    });
    const data = parse(schema, req.body);
    const existing = await db.teacher.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email address already exists. Please sign in or contact the platform administrator.' });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const teacher = await db.teacher.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase(),
        passwordHash,
        school: data.school || null,
        subject: data.subject || null,
        phone: data.phone || null,
        active: false, // Inactive by default, requires Super Admin approval!
      },
    });

    res.status(201).json({
      ok: true,
      message: 'Teacher registration submitted successfully! Your account will be activated once reviewed and approved by the EduAshram Administrator.',
      teacher: { id: teacher.id, name: teacher.name, email: teacher.email },
    });
  } catch (error) { errorResponse(res, error); }
});

// Teacher Login
app.post('/api/auth/teacher/login', async (req: Request, res: Response) => {
  try {
    const data = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const teacher = await db.teacher.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!teacher || !(await bcrypt.compare(data.password, teacher.passwordHash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    if (!teacher.active) {
      return res.status(403).json({
        error: 'Your teacher account is pending activation by the EduAshram Administrator. Please contact the administrator to activate your access.',
      });
    }

    const session: Session = { id: teacher.id, role: 'teacher', email: teacher.email, name: teacher.name };
    sendSession(res, session);
    res.json({
      user: {
        id: teacher.id,
        role: 'teacher',
        email: teacher.email,
        name: teacher.name,
        school: teacher.school,
        subject: teacher.subject,
        hasApiKey: Boolean(teacher.apiKey),
      }
    });
  } catch (error) { errorResponse(res, error); }
});

// Backward-compatible Admin / Teacher Login
app.post('/api/auth/admin', async (req: Request, res: Response) => {
  try {
    const data = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    
    // Check Teacher account first
    const teacher = await db.teacher.findUnique({ where: { email: data.email.toLowerCase() } });
    if (teacher && (await bcrypt.compare(data.password, teacher.passwordHash))) {
      if (!teacher.active) {
        return res.status(403).json({ error: 'Your teacher account is pending activation by the EduAshram Administrator.' });
      }
      sendSession(res, { id: teacher.id, role: 'teacher', email: teacher.email, name: teacher.name });
      return res.json({ user: { id: teacher.id, role: 'teacher', email: teacher.email, name: teacher.name, school: teacher.school } });
    }

    // Check legacy Admin table
    const admin = await prisma.admin.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!admin || !(await bcrypt.compare(data.password, admin.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    sendSession(res, { id: admin.id, role: 'teacher', email: admin.email });
    res.json({ user: { role: 'teacher', email: admin.email } });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/auth/student', async (req: Request, res: Response) => {
  try {
    const data = parse(z.object({ passkey: z.string().trim().min(4).max(40) }), req.body);
    const lookupHash = passkeyLookup(data.passkey);
    let student = await prisma.student.findUnique({ where: { passkeyLookup: lookupHash } });

    if (!student) {
      const activeStudents = await prisma.student.findMany({ where: { active: true } });
      for (const s of activeStudents) {
        if (await bcrypt.compare(data.passkey.toUpperCase(), s.passkeyHash)) {
          student = s;
          await prisma.student.update({ where: { id: s.id }, data: { passkeyLookup: lookupHash } }).catch(() => { });
          break;
        }
      }
    }

    if (!student?.active || !(await bcrypt.compare(data.passkey.toUpperCase(), student.passkeyHash))) {
      return res.status(401).json({ error: 'That passkey was not recognized.' });
    }

    sendSession(res, { id: student.id, role: 'student', name: student.name });
    res.json({ user: { id: student.id, role: 'student', name: student.name, teacherId: (student as any).teacherId, grade: (student as any).grade || 'Grade 6' } });
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/auth/me', authenticate(), async (req: AuthRequest, res: Response) => {
  if (req.session?.role === 'superadmin') {
    const superAdmin = await db.superAdmin.findUnique({ where: { id: req.session.id }, select: { id: true, username: true, email: true } });
    return res.json({ user: superAdmin ? { id: superAdmin.id, role: 'superadmin', username: superAdmin.username, email: superAdmin.email } : null });
  }

  if (req.session?.role === 'teacher' || req.session?.role === 'admin') {
    const teacher = await db.teacher.findUnique({
      where: { id: req.session.id },
      select: { id: true, name: true, email: true, school: true, subject: true, active: true, apiKey: true }
    });
    if (teacher) {
      if (!teacher.active) return res.status(403).json({ error: 'This teacher account is pending activation by the Administrator.' });
      return res.json({
        user: {
          id: teacher.id,
          role: 'teacher',
          name: teacher.name,
          email: teacher.email,
          school: teacher.school,
          subject: teacher.subject,
          hasApiKey: Boolean(teacher.apiKey),
        }
      });
    }
    const admin = await prisma.admin.findUnique({ where: { id: req.session.id }, select: { id: true, email: true } });
    return res.json({ user: admin ? { id: admin.id, role: 'teacher', email: admin.email, name: 'Teacher' } : null });
  }

  const student: any = await (prisma as any).student.findUnique({ where: { id: req.session!.id }, select: { id: true, name: true, active: true, teacherId: true, grade: true } });
  if (!student?.active) return res.status(401).json({ error: 'This student passkey has been disabled.' });
  return res.json({ user: { id: student.id, role: 'student', name: student.name, teacherId: student.teacherId, grade: student.grade || 'Grade 6' } });
});

// Teacher Profile & API Key Management
app.get('/api/teacher/profile', teacherOnly, async (req: AuthRequest, res: Response) => {
  try {
    const teacher = await db.teacher.findUnique({
      where: { id: req.session!.id },
      select: { id: true, name: true, email: true, school: true, subject: true, phone: true, active: true, apiKey: true, createdAt: true },
    });
    if (!teacher) return res.status(404).json({ error: 'Teacher profile not found.' });
    res.json({
      teacher: {
        ...teacher,
        apiKey: teacher.apiKey ? '••••••••' + teacher.apiKey.slice(-4) : '',
        hasApiKey: Boolean(teacher.apiKey),
      }
    });
  } catch (error) { errorResponse(res, error); }
});

app.patch('/api/teacher/api-key', teacherOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { apiKey } = parse(z.object({ apiKey: z.string().trim().max(500) }), req.body);
    await db.teacher.update({
      where: { id: req.session!.id },
      data: { apiKey: apiKey || null },
    });
    res.json({ ok: true, message: 'Your personal AI API Key has been saved successfully!' });
  } catch (error) { errorResponse(res, error); }
});

app.patch('/api/teacher/profile', teacherOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = parse(z.object({
      name: z.string().trim().min(2).max(100).optional(),
      school: z.string().trim().max(200).optional().nullable(),
      subject: z.string().trim().max(100).optional().nullable(),
      phone: z.string().trim().max(30).optional().nullable(),
    }), req.body);

    const updated = await db.teacher.update({
      where: { id: req.session!.id },
      data,
      select: { id: true, name: true, email: true, school: true, subject: true, phone: true },
    });
    res.json({ teacher: updated, ok: true });
  } catch (error) { errorResponse(res, error); }
});

// Super Admin Teacher Management Endpoints
app.get('/api/superadmin/teachers', superAdminOnly, async (_req: Request, res: Response) => {
  try {
    const teachers = await db.teacher.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        school: true,
        subject: true,
        phone: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            students: true,
            quizzes: true,
            worksheetPapers: true,
          }
        }
      }
    });
    res.json({ teachers });
  } catch (error) { errorResponse(res, error); }
});

app.patch('/api/superadmin/teachers/:id/toggle-status', superAdminOnly, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const teacher = await db.teacher.findUnique({ where: { id } });
    if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });

    const updated = await db.teacher.update({
      where: { id },
      data: { active: !teacher.active },
      select: { id: true, name: true, email: true, active: true },
    });
    res.json({ teacher: updated, ok: true });
  } catch (error) { errorResponse(res, error); }
});

app.delete('/api/superadmin/teachers/:id', superAdminOnly, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await db.teacher.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});

app.all('/api/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie(sessionCookie, { ...cookieOptions, maxAge: 0 });
  res.clearCookie(sessionCookie, { path: '/' });
  res.clearCookie(sessionCookie);
  return res.json({ ok: true });
});
const uploadedFileSchema = z.object({
  name: z.string().max(255),
  type: z.string().max(100),
  data: z.string(),
  size: z.number().optional(),
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
  strictSourceContent: z.boolean().optional(),
  uploadedFiles: z.array(uploadedFileSchema).max(15).optional(),
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

function buildUploadedContentPrompt(data: z.infer<typeof aiQuizInput>) {
  const isStrict = Boolean(data.strictSourceContent);
  const fileCount = data.uploadedFiles?.length || 0;

  let textDocs = '';
  if (data.uploadedFiles) {
    for (const file of data.uploadedFiles) {
      if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        try {
          let text = file.data;
          if (text.includes(';base64,')) {
            text = Buffer.from(text.split(';base64,')[1], 'base64').toString('utf-8');
          } else if (!text.startsWith('data:')) {
            const dec = Buffer.from(text, 'base64').toString('utf-8');
            if (/[\x20-\x7E\r\n\t]{10,}/.test(dec)) text = dec;
          }
          textDocs += `\n\n--- [ATTACHED TEXT DOCUMENT: "${file.name}"] ---\n${text.slice(0, 25000)}\n--- [END OF "${file.name}"] ---\n`;
        } catch {
          // ignore
        }
      }
    }
  }

  return `# CRITICAL ASSESSMENT MISSION: CHAPTER-BASED QUIZ & QUESTION PAPER GENERATION

You are an expert curriculum designer, CBSE master teacher, and senior question paper author.
You have been provided with ${fileCount} attached file(s) (scanned textbook pages, chapter photographs, sample papers, or lesson notes).

---

## 1. SOURCE MATERIAL INVENTORY & COMPREHENSIVE TOPIC COVERAGE (MANDATORY)
The attached files are your PRIMARY SOURCE OF KNOWLEDGE. You must:
1. **Examine every attached image, scan, and page systematically**:
   - Carefully read all headings, sub-headings, section texts, definitions, diagrams, charts, worked examples, and footnotes visible across ALL attached files.
2. **Comprehensive Topic Coverage (NO TOPIC OMITTED)**:
   - Identify every distinct concept, topic, and sub-topic covered across the uploaded material.
   - Distribute the ${data.questionCount} questions proportionally across ALL the topics present in the uploaded pages.
   - Do NOT concentrate all questions on just one page or the opening paragraph. Every section/topic from the uploaded material must be assessed.
3. **Strict Content Boundary**:
   ${isStrict
     ? '• STRICT MODE IS ACTIVE: All questions, correct answers, and options MUST be grounded exclusively in the concepts, laws, terms, and phenomena present in the uploaded material. DO NOT introduce topics from unattached chapters or external unmentioned syllabi.'
     : '• REFERENCE MODE: Use the uploaded pages as the central anchor of truth, while leveraging curriculum context to create polished, age-appropriate questions for Grade ' + data.grade + '.'
   }

---

## 2. TRANSFORM HOW QUESTIONS ARE ASKED (DO NOT MERELY COPY THE FORMAT)
CRITICAL INSTRUCTION: Do NOT simply duplicate, rephrase, or mimic the back-of-the-chapter exercise questions, end-of-textbook quizzes, or rote definition prompts!
Instead, transform every topic from the uploaded pages into FRESH, NOVEL, AND COMPETENCY-BASED questions by fundamentally changing the way questions are formulated:

1. **Situational & Everyday Application Scenarios**:
   - Reframe abstract concepts into real-world scenarios, everyday situations, or classroom experiments described in the text.
   - Example style: Instead of asking "What is transpiration?", present: "A student wraps a transparent plastic bag around a leafy branch of a potted plant in direct sunlight. After 3 hours, water droplets form inside the bag. Which concept from the chapter explains this observation?"

2. **Cause-and-Effect & Mechanism Questions**:
   - Ask what happens when a specific condition changes: "If variable X increases while Y is kept constant, what effect is observed on Z according to the chapter?"
   - Test the 'Why' and 'How' behind processes, rather than just naming terms.

3. **Comparative & Analytical Thinking**:
   - Create questions that require comparing two concepts, classifications, or reactions discussed on the pages (e.g. similarities, distinguishing characteristics, boundary conditions).

4. **Hypothetical & Predictive "What If" Questions**:
   - "What would happen if step 2 in this process was omitted?" or "If an organism lacked this specific structure mentioned in the text, which function would be compromised?"

5. **Diagnostic Distractors (Misconception-Busting Options)**:
   - For Multiple Choice Questions, provide 4 plausible, well-thought-out options (A, B, C, D).
   - The 3 incorrect options must reflect authentic student misconceptions or common conceptual pitfalls related to the chapter, not obvious absurdities.

6. **Rich Pedagogical Explanations**:
   - For every question, write a comprehensive teacher explanation that directly references the concept from the uploaded pages and explains why the correct option is right and why other options are incorrect.

---

## 3. ASSESSMENT SPECIFICATIONS
- Subject: ${data.subject}
- Target Grade: ${data.grade}
- Topic: ${data.topic}${data.subtopics ? ` (Subtopics: ${data.subtopics})` : ''}
- Total Questions: ${data.questionCount}
- Difficulty Level: ${data.difficulty}
- Target Question Type: ${data.questionType || 'ALL'}
- Teacher Instructions: ${data.details || 'None specified'}
${textDocs}

---

## 4. OUTPUT FORMAT (STRICT RAW JSON ONLY)
Respond ONLY with a valid raw JSON object matching the exact schema below. Do not wrap in markdown code blocks or add introductory/concluding text:
{
  "title": "${data.subject}: ${data.topic} (${data.grade} - Chapter Assessment)",
  "questions": [
    {
      "question": "The transformed, context-rich question text testing a specific concept from the uploaded pages...",
      "options": [
        "First option",
        "Second option",
        "Third option",
        "Fourth option"
      ],
      "answer": "A",
      "explanation": "Detailed explanation citing the concept from the uploaded pages, clarifying the mechanism and addressing misconceptions.",
      "hint": "Clue to prompt student critical thinking."
    }
  ]
}

Ensure the questions array contains EXACTLY ${data.questionCount} questions covering all sections of the uploaded pages.`;
}

function buildMasterCBSEPrompt(data: z.infer<typeof aiQuizInput>) {
  let uploadedContext = '';
  if (data.uploadedFiles && data.uploadedFiles.length > 0) {
    const fileSummary = data.uploadedFiles.map((f, i) => `  ${i + 1}. "${f.name}" (${f.type})`).join('\n');
    if (data.strictSourceContent) {
      uploadedContext = `\n\n======================================================================
# MANDATORY STRICT UPLOADED SOURCE CONTENT REQUIREMENT (STRICT MODE IS ACTIVE)
The teacher has attached ${data.uploadedFiles.length} file(s) (sample question papers, textbook chapter scans, or exercise notes):
${fileSummary}

CRITICAL STRICT RULES (MANDATORY):
1. You MUST generate ALL questions, options, and explanations STRICTLY AND EXCLUSIVELY based on the facts, concepts, problems, and questions found in the uploaded content provided (chapter scans, sample papers, images, or documents).
2. DO NOT introduce external topics, unmentioned formulas, or concepts from other chapters that do not appear in the uploaded source content.
3. If the uploaded material contains specific sample questions or textbook exercises, adapt, paraphrase, or faithfully format them into the requested question structure.
4. If a fact or question is not supported by the uploaded files, DO NOT invent or extrapolate it.
======================================================================\n`;
    } else {
      uploadedContext = `\n\n----------------------------------------------------------------------
# REFERENCE MATERIAL ATTACHED (STANDARD LLM KNOWLEDGE MODE)
The teacher has attached ${data.uploadedFiles.length} file(s) for reference and guidance:
${fileSummary}

INSTRUCTIONS:
You may generate questions using your broader AI pedagogical knowledge and curriculum understanding for ${data.grade} ${data.subject}, while using the uploaded documents and images as helpful reference, context, and inspiration.
----------------------------------------------------------------------\n`;
    }

    for (const file of data.uploadedFiles) {
      if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        try {
          let text = file.data;
          if (text.includes(';base64,')) {
            text = Buffer.from(text.split(';base64,')[1], 'base64').toString('utf-8');
          } else if (!text.startsWith('data:')) {
            const dec = Buffer.from(text, 'base64').toString('utf-8');
            if (/[\x20-\x7E\r\n\t]{10,}/.test(dec)) text = dec;
          }
          uploadedContext += `\n\n--- CONTENT OF UPLOADED DOCUMENT: ${file.name} ---\n${text.slice(0, 20000)}\n--- END OF ${file.name} ---\n`;
        } catch {
          // skip binary decode
        }
      }
    }
  }

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
Strict Mode (Generate Strictly from Uploaded Content): ${data.strictSourceContent ? 'YES - STRICTLY FROM UPLOADED CONTENT ONLY' : 'NO - STANDARD LLM KNOWLEDGE'}
Uploaded Files Count: ${data.uploadedFiles?.length || 0}
${uploadedContext}
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

  const hasUploadedFiles = Boolean(data.uploadedFiles && data.uploadedFiles.length > 0);
  const systemRole = hasUploadedFiles
    ? `You are an expert curriculum designer, CBSE question paper author and pedagogical assessment specialist. Thoroughly inspect all attached chapter pages and formulate fresh, transformed, competency-based questions covering all topics without copying textbook question formats.`
    : `You are an experienced CBSE school teacher, examination question-paper setter and competency-based assessment expert. Generate high-quality quiz questions aligned with NEP 2020/2026 principles.`;
  const prompt = hasUploadedFiles
    ? buildUploadedContentPrompt(data)
    : buildMasterCBSEPrompt(data);

  if (selectedProvider === 'openai' || (selectedProvider === 'auto' && openaiKey && !geminiKey)) {
    let userContent: any = prompt;
    if (data.uploadedFiles && data.uploadedFiles.length > 0) {
      const imageFiles = data.uploadedFiles.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        userContent = [
          ...imageFiles.map(f => {
            const raw = f.data.trim();
            const url = raw.startsWith('data:') ? raw : `data:${f.type || 'image/jpeg'};base64,${raw}`;
            return {
              type: 'image_url',
              image_url: { url, detail: 'high' }
            };
          }),
          { type: 'text', text: prompt }
        ];
      }
    }

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
          { role: 'user', content: userContent }
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
    const candidateModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro', 'gemini-pro'];
    let lastError = '';

    const parts: Array<any> = [];

    if (data.uploadedFiles && data.uploadedFiles.length > 0) {
      for (const file of data.uploadedFiles) {
        if (file.type.startsWith('image/') || file.type === 'application/pdf') {
          let pureBase64 = file.data;
          if (pureBase64.includes(';base64,')) {
            pureBase64 = pureBase64.split(';base64,')[1];
          }
          pureBase64 = pureBase64.replace(/\s+/g, '');
          const mimeType = file.type === 'application/pdf' ? 'application/pdf' : (file.type || 'image/jpeg');

          // Standard Google Gemini REST API requires camelCase inlineData:
          parts.push({
            inlineData: {
              mimeType,
              data: pureBase64,
            }
          });
        }
      }
    }

    parts.push({ text: `${systemRole}\n\n${prompt}` });

    for (const modelName of candidateModels) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
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

app.post('/api/ai/generate-quiz', adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = parse(aiQuizInput, req.body);
    if (!data.apiKey && req.session?.id) {
      const teacher = await db.teacher.findUnique({ where: { id: req.session.id }, select: { apiKey: true } });
      if (teacher?.apiKey) {
        data.apiKey = teacher.apiKey;
      }
    }
    const quizResult = await generateAIQuiz(data);
    res.json(quizResult);
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/quizzes', adminOnly, async (req: AuthRequest, res: Response) => {
  const teacherId = req.session!.id;
  const where: any = req.session?.role === 'superadmin' ? {} : { teacherId };
  const quizzes = await prisma.quiz.findMany({ where, orderBy: { updatedAt: 'desc' }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } }, _count: { select: { questions: true, attempts: true } } } });
  res.json({ quizzes });
});

app.post('/api/quizzes', adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = parse(quizInput, req.body);
    const teacherId = req.session!.id;
    const quiz = await prisma.$transaction(async (tx) => {
      const createdQuiz = await (tx as any).quiz.create({
        data: {
          title: data.title,
          grade: data.grade || null,
          mode: data.mode as QuizMode,
          timeLimitSeconds: data.mode === 'LIVE' ? null : data.timeLimitSeconds,
          showResults: data.showResults,
          teacherId,
        },
      });

      if (data.questions.length > 0) {
        const createdQuestions = await tx.question.createManyAndReturn({
          data: data.questions.map((question, position) => ({
            quizId: createdQuiz.id,
            prompt: question.prompt,
            marks: question.marks,
            imageUrl: question.imageUrl ?? null,
            type: question.type ?? 'MCQ',
            position,
          })),
          select: { id: true, position: true },
        });

        const allOptions = createdQuestions.flatMap((createdQ) => {
          const originalQ = data.questions[createdQ.position];
          return (originalQ?.options ?? []).map((option, optionPosition) => ({
            questionId: createdQ.id,
            position: optionPosition,
            text: option.text,
            isCorrect: option.isCorrect,
          }));
        });

        if (allOptions.length > 0) {
          await tx.option.createMany({
            data: allOptions,
          });
        }
      }

      return createdQuiz;
    }, { timeout: 60000, maxWait: 20000 });
    res.status(201).json({ quiz });
  } catch (error) { errorResponse(res, error); }
});
app.get('/api/quizzes/:id/detail', adminOnly, async (req: Request, res: Response) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: parse(objectId, req.params.id) }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    res.json({ quiz });
  } catch (error) { errorResponse(res, error); }
});
app.put('/api/quizzes/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = parse(objectId, req.params.id);
    const data = parse(quizInput, req.body);
    const existing = await prisma.quiz.findUnique({ where: { id }, include: { _count: { select: { attempts: true } } } });
    if (!existing) return res.status(404).json({ error: 'Quiz not found.' });
    if (existing.status === 'ACTIVE') return res.status(409).json({ error: 'Please stop or close the active quiz before editing.' });
    await prisma.$transaction(async (tx) => {
      if (existing._count.attempts > 0) {
        const attempts = await tx.attempt.findMany({ where: { quizId: id }, select: { id: true } });
        const attemptIds = attempts.map((attempt) => attempt.id);
        if (attemptIds.length > 0) {
          await tx.answer.deleteMany({ where: { attemptId: { in: attemptIds } } });
          await tx.attempt.deleteMany({ where: { quizId: id } });
        }
      }

      // Delete existing questions (and cascaded options)
      await tx.question.deleteMany({ where: { quizId: id } });

      // Update quiz metadata without heavy nested writes
      await (tx.quiz as any).update({
        where: { id },
        data: {
          title: data.title,
          grade: data.grade || null,
          mode: data.mode as QuizMode,
          timeLimitSeconds: data.mode === 'LIVE' ? null : data.timeLimitSeconds,
          showResults: data.showResults,
          currentQuestionIndex: 0,
          currentAnswerRevealed: false,
        },
      });

      // Bulk insert questions in a single query
      if (data.questions.length > 0) {
        const createdQuestions = await tx.question.createManyAndReturn({
          data: data.questions.map((question, position) => ({
            quizId: id,
            prompt: question.prompt,
            marks: question.marks,
            imageUrl: question.imageUrl ?? null,
            type: question.type ?? 'MCQ',
            position,
          })),
          select: { id: true, position: true },
        });

        // Bulk insert all options across questions in a single query
        const allOptions = createdQuestions.flatMap((createdQ) => {
          const originalQ = data.questions[createdQ.position];
          return (originalQ?.options ?? []).map((option, optionPosition) => ({
            questionId: createdQ.id,
            position: optionPosition,
            text: option.text,
            isCorrect: option.isCorrect,
          }));
        });

        if (allOptions.length > 0) {
          await tx.option.createMany({
            data: allOptions,
          });
        }
      }
    }, { timeout: 60000, maxWait: 20000 });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});

app.patch('/api/quizzes/:id/mode', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = parse(objectId, req.params.id);
    const { mode, timeLimitSeconds } = parse(z.object({
      mode: z.enum(['LIVE', 'SELF_PACED']),
      timeLimitSeconds: z.number().int().nullable().optional(),
    }), req.body);

    const quiz = await prisma.quiz.findUnique({ where: { id } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });

    await prisma.quiz.update({
      where: { id },
      data: {
        mode: mode as QuizMode,
        timeLimitSeconds: mode === 'LIVE' ? null : (timeLimitSeconds !== undefined ? timeLimitSeconds : quiz.timeLimitSeconds),
      }
    });

    res.json({ ok: true });
    void publishQuizState(id);
  } catch (error) { errorResponse(res, error); }
});
app.delete('/api/quizzes/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = parse(objectId, req.params.id);
    await prisma.quiz.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});
app.patch('/api/quizzes/:id/status', adminOnly, async (req: Request, res: Response) => {
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
app.patch('/api/quizzes/:id/control', adminOnly, async (req: Request, res: Response) => {
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

app.post('/api/quizzes/:id/restart', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = parse(objectId, req.params.id);
    const quiz = await prisma.quiz.findUnique({ where: { id } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });

    await prisma.$transaction(async (tx) => {
      // Find ONLY unsubmitted attempts (IN_PROGRESS).
      // Completed student submissions (status: 'SUBMITTED') must remain untouched and preserved!
      const unsubmittedAttempts = await tx.attempt.findMany({
        where: { quizId: id, status: 'IN_PROGRESS' },
        select: { id: true, status: true },
      });
      const attemptIds = unsubmittedAttempts
        .filter((attempt) => attempt.status === 'IN_PROGRESS')
        .map((attempt) => attempt.id);

      if (attemptIds.length > 0) {
        await tx.answer.deleteMany({ where: { attemptId: { in: attemptIds } } });
        await tx.attempt.deleteMany({ where: { id: { in: attemptIds } } });
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
    io.to(`students:${id}`).emit('quiz:restarted', { quizId: id });
    io.to('students:lobby').emit('quiz:lobby_updated');
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

app.get('/api/students', adminOnly, async (req: AuthRequest, res: Response) => {
  const teacherId = req.session!.id;
  const where: any = req.session?.role === 'superadmin' ? {} : { teacherId };
  const students: any[] = await (prisma.student as any).findMany({ where, orderBy: { name: 'asc' }, select: { id: true, name: true, grade: true, passkey: true, active: true, createdAt: true, _count: { select: { attempts: true } } } });
  for (const student of students) {
    if (!student.passkey) {
      const passkey = generateShortPasskey();
      await (prisma.student as any).update({
        where: { id: student.id },
        data: { passkey, passkeyHash: await bcrypt.hash(passkey, 12), passkeyLookup: passkeyLookup(passkey) },
      });
      student.passkey = passkey;
    }
  }
  res.json({ students });
});
app.post('/api/students', adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = parse(z.object({
      name: z.string().trim().min(1).max(100),
      grade: z.string().trim().min(1).max(50).optional().default('Grade 6'),
    }), req.body);
    const passkey = generateShortPasskey();
    const teacherId = req.session!.id;
    const student = await (prisma.student as any).create({
      data: {
        name: data.name,
        grade: data.grade || 'Grade 6',
        passkey,
        passkeyHash: await bcrypt.hash(passkey, 12),
        passkeyLookup: passkeyLookup(passkey),
        teacherId,
      },
      select: { id: true, name: true, grade: true, passkey: true, active: true }
    });
    res.status(201).json({ student, passkey });
  } catch (error) { errorResponse(res, error); }
});
app.patch('/api/students/:id', adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const id = parse(objectId, req.params.id);
    const data = parse(z.object({
      active: z.boolean().optional(),
      name: z.string().trim().min(1).max(100).optional(),
      grade: z.string().trim().min(1).max(50).optional(),
      resetPasskey: z.boolean().optional(),
    }), req.body);
    const passkey = data.resetPasskey ? generateShortPasskey() : null;
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing || (req.session?.role !== 'superadmin' && (existing as any).teacherId !== req.session!.id)) {
      return res.status(404).json({ error: 'Student not found in your classroom.' });
    }
    const student = await (prisma.student as any).update({
      where: { id },
      data: {
        active: data.active,
        name: data.name,
        grade: data.grade,
        ...(passkey ? { passkey, passkeyHash: await bcrypt.hash(passkey, 12), passkeyLookup: passkeyLookup(passkey) } : {})
      },
      select: { id: true, name: true, grade: true, passkey: true, active: true }
    });
    res.json({ student, ...(passkey ? { passkey } : {}) });
  } catch (error) { errorResponse(res, error); }
});
app.delete('/api/students/:id', adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const id = parse(objectId, req.params.id);
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing || (req.session?.role !== 'superadmin' && (existing as any).teacherId !== req.session!.id)) {
      return res.status(404).json({ error: 'Student not found in your classroom.' });
    }
    await prisma.student.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});
app.get('/api/quizzes/:id/results', adminOnly, async (req: Request, res: Response) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: parse(objectId, req.params.id) }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } }, attempts: { include: { student: { select: { name: true } }, answers: { include: { question: true, option: true } } }, orderBy: { startedAt: 'asc' } } } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    const totalMarks = quiz.questions.reduce((sum, question) => sum + question.marks, 0);
    const results = quiz.attempts.map((attempt) => ({ id: attempt.id, studentId: attempt.studentId, name: attempt.student.name, status: attempt.status, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, score: attempt.score, totalMarks, answers: attempt.answers.map((answer) => ({ questionId: answer.questionId, question: answer.question.prompt, response: answer.option.text, correct: answer.option.isCorrect, marks: answer.question.marks })) }));
    const distribution = quiz.questions.map((question) => ({ question: question.prompt, options: question.options.map((option) => ({ text: option.text, correct: option.isCorrect, count: quiz.attempts.reduce((count, attempt) => count + attempt.answers.filter((answer) => answer.optionId === option.id).length, 0) })) }));
    res.json({ quiz: { id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status }, results, distribution });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/quizzes/:quizId/attempts/:attemptId/reset', adminOnly, async (req: Request, res: Response) => {
  try {
    const quizId = parse(objectId, req.params.quizId);
    const attemptId = parse(objectId, req.params.attemptId);

    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        student: { select: { id: true, name: true } },
        quiz: { select: { id: true, title: true } },
      },
    });

    if (!attempt || attempt.quizId !== quizId) {
      return res.status(404).json({ error: 'Quiz attempt not found.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.answer.deleteMany({ where: { attemptId } });
      await tx.attempt.delete({ where: { id: attemptId } });
    });

    void publishQuizState(quizId);
    io.to('students:lobby').emit('quiz:lobby_updated');
    io.to('students:lobby').to(`students:${quizId}`).emit('quiz:attempt_reset', {
      quizId,
      studentId: attempt.student.id,
      studentName: attempt.student.name,
    });

    res.json({
      ok: true,
      message: `Quiz attempt for ${attempt.student.name} has been reset. They can now retry the quiz.`
    });
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/student/quizzes', studentOnly, async (req: AuthRequest, res: Response) => {
  const studentId = req.session!.id;
  const student: any = await (prisma as any).student.findUnique({ where: { id: studentId }, select: { teacherId: true, grade: true } });
  const teacherFilter: any = student?.teacherId ? { teacherId: student.teacherId } : {};
  const studentGrade = student?.grade || 'Grade 6';

  const quizzes = await (prisma.quiz as any).findMany({
    where: {
      ...teacherFilter,
      AND: [
        {
          OR: [
            { grade: null },
            { grade: '' },
            { grade: studentGrade },
          ]
        },
        {
          OR: [
            { status: 'ACTIVE' },
            { attempts: { some: { studentId } } },
          ]
        }
      ]
    },
    orderBy: { createdAt: 'desc' },
    include: {
      questions: { select: { marks: true } },
      _count: { select: { questions: true } },
      attempts: { where: { studentId }, select: { status: true, deadlineAt: true, score: true, submittedAt: true } }
    }
  });
  res.json({
    quizzes: quizzes.map((quiz: any) => {
      const totalMarks = quiz.questions.reduce((sum: number, q: any) => sum + q.marks, 0);
      return {
        id: quiz.id,
        title: quiz.title,
        grade: quiz.grade,
        mode: quiz.mode,
        status: quiz.status,
        timeLimitSeconds: quiz.timeLimitSeconds,
        questionCount: quiz._count.questions,
        totalMarks,
        attempt: quiz.attempts[0] ?? null
      };
    })
  });
});
app.get('/api/student/quizzes/:id', studentOnly, async (req: AuthRequest, res: Response) => {
  try {
    const id = parse(objectId, req.params.id);
    const quiz: any = await (prisma.quiz as any).findUnique({ where: { id }, select: { id: true, status: true, mode: true, timeLimitSeconds: true, grade: true } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });

    const student: any = await (prisma.student as any).findUnique({ where: { id: req.session!.id }, select: { grade: true } });
    const studentGrade = student?.grade || 'Grade 6';
    if (quiz.grade && quiz.grade !== studentGrade) {
      return res.status(403).json({ error: `This quiz is assigned for ${quiz.grade} students only.` });
    }

    let attempt = await prisma.attempt.findUnique({ where: { quizId_studentId: { quizId: id, studentId: req.session!.id } } });
    if (!attempt && quiz.status === 'ACTIVE') {
      const now = new Date();
      attempt = await prisma.attempt.upsert({
        where: { quizId_studentId: { quizId: id, studentId: req.session!.id } },
        update: {},
        create: { quizId: id, studentId: req.session!.id, deadlineAt: (quiz.mode === 'SELF_PACED' && quiz.timeLimitSeconds !== null) ? new Date(now.getTime() + quiz.timeLimitSeconds * 1000) : null },
      });
    }
    const state = await studentQuizState(id, req.session!.id);
    if (!state) return res.status(404).json({ error: 'Quiz details not found.' });
    res.json({ quiz: state });
  } catch (error) { errorResponse(res, error); }
});
app.put('/api/student/quizzes/:id/answers', studentOnly, async (req: AuthRequest, res: Response) => {
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
app.post('/api/student/quizzes/:id/submit', studentOnly, async (req: AuthRequest, res: Response) => {
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
    if (!payload.id || (!['admin', 'teacher', 'superadmin', 'student'].includes(payload.role))) return next(new Error('Unauthorized'));
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
    if (session.role === 'admin' || session.role === 'teacher' || session.role === 'superadmin') socket.join(`teachers:${quizId}`);
    else if (session.role === 'student') socket.join(`students:${quizId}`);
    await publishQuizState(quizId);
  });
});

// --- WORKSHEET & QUESTION PAPER ROUTES ---

app.get('/api/worksheets', authenticate(), async (req: AuthRequest, res: Response) => {
  try {
    if (req.session?.role === 'admin' || req.session?.role === 'teacher' || req.session?.role === 'superadmin') {
      const where: any = req.session.role === 'superadmin' ? {} : { teacherId: req.session.id };
      const worksheets = await prisma.worksheetPaper.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { submissions: true } },
        },
      });
      return res.json({ worksheets });
    }

    const student: any = await (prisma as any).student.findUnique({ where: { id: req.session!.id }, select: { teacherId: true, grade: true } });
    const teacherFilter: any = student?.teacherId ? { teacherId: student.teacherId } : {};
    const studentGrade = student?.grade || 'Grade 6';
    const worksheets = await prisma.worksheetPaper.findMany({
      where: {
        ...teacherFilter,
        status: 'PUBLISHED',
        OR: [
          { grade: null },
          { grade: '' },
          { grade: studentGrade },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        submissions: {
          where: { studentId: req.session!.id },
          select: { id: true, status: true, score: true, remarks: true, submittedAt: true, gradedAt: true, images: true },
        },
      },
    });

    const studentWorksheets = worksheets.map((w) => ({
      ...w,
      submission: w.submissions[0] ?? null,
      submissions: undefined,
    }));

    res.json({ worksheets: studentWorksheets });
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/worksheets/:id', authenticate(), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const worksheet = await prisma.worksheetPaper.findUnique({
      where: { id },
      include: {
        submissions: (req.session?.role === 'admin' || req.session?.role === 'teacher' || req.session?.role === 'superadmin')
          ? {
            include: { student: { select: { id: true, name: true } } },
            orderBy: { submittedAt: 'desc' },
          }
          : {
            where: { studentId: req.session!.id },
          },
      },
    });

    if (!worksheet) return res.status(404).json({ error: 'Question paper not found.' });

    if (req.session?.role === 'student') {
      const student: any = await (prisma.student as any).findUnique({ where: { id: req.session!.id }, select: { grade: true } });
      const studentGrade = student?.grade || 'Grade 6';
      if ((worksheet as any).grade && (worksheet as any).grade !== studentGrade) {
        return res.status(403).json({ error: `This question paper is assigned for ${(worksheet as any).grade} students only.` });
      }
      const submission = worksheet.submissions?.[0] ?? null;
      return res.json({ worksheet: { ...worksheet, submission, submissions: undefined } });
    }

    res.json({ worksheet });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/worksheets', adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(200),
      subject: z.string().trim().max(100).optional(),
      grade: z.string().trim().max(50).optional(),
      totalMarks: z.number().int().min(1).default(100),
      content: z.string().trim().min(1),
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('PUBLISHED'),
    });
    const data = parse(schema, req.body);
    const teacherId = req.session!.id;
    const paper = await (prisma as any).worksheetPaper.create({ data: { ...data, teacherId } });
    res.status(201).json({ paper });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/worksheets/ai-generate', adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      subject: z.string().trim().min(1).max(100),
      grade: z.string().trim().min(1).max(50),
      topic: z.string().trim().min(1).max(300),
      subtopics: z.string().trim().max(500).optional(),
      questionCount: z.number().int().min(3).max(30).default(10),
      totalMarks: z.number().int().min(10).max(200).default(100),
      details: z.string().trim().max(500).optional(),
      apiKey: z.string().trim().optional(),
      provider: z.enum(['auto', 'gemini', 'openai']).optional(),
      strictSourceContent: z.boolean().optional(),
      uploadedFiles: z.array(uploadedFileSchema).max(15).optional(),
    });
    const data = parse(schema, req.body);

    if (!data.apiKey && req.session?.id) {
      const teacher = await db.teacher.findUnique({ where: { id: req.session.id }, select: { apiKey: true } });
      if (teacher?.apiKey) {
        data.apiKey = teacher.apiKey;
      }
    }

    let docHtml = '';
    const generated = await generateAIQuiz({
      mode: 'SELF_PACED',
      subject: data.subject,
      grade: data.grade,
      topic: data.topic,
      subtopics: data.subtopics,
      difficulty: 'Moderate',
      questionCount: data.questionCount,
      questionType: 'ALL',
      details: `Create a formal printable Word-document style Question Paper for ${data.subject} (${data.grade}) on "${data.topic}". Total Marks: ${data.totalMarks}. ${data.details ?? ''}`,
      apiKey: data.apiKey,
      provider: data.provider,
      strictSourceContent: data.strictSourceContent,
      uploadedFiles: data.uploadedFiles,
    });

    if (generated && generated.questions?.length > 0) {
      docHtml = `
<div style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.5; color: #1e293b; width: 100%;">
  <div style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px;">
    <h1 style="margin: 0; font-size: 22px; text-transform: uppercase; color: #0f172a; letter-spacing: 0.5px;">${data.subject.toUpperCase()} QUESTION PAPER</h1>
    <h3 style="margin: 4px 0 0 0; color: #475569; font-weight: 500; font-size: 15px;">Grade: ${data.grade} &nbsp;|&nbsp; Topic: ${data.topic}</h3>
    <div style="display: flex; justify-content: space-between; margin-top: 10px; font-weight: 600; font-size: 13px; color: #334155;">
      <span>Time Allowed: 60 Minutes</span>
      <span>Total Marks: ${data.totalMarks}</span>
    </div>
  </div>

  <div style="background-color: #f8fafc; border-left: 4px solid #0284c7; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; border-radius: 4px;">
    <strong style="color: #0369a1;">Instructions for Students:</strong>
    <ul style="margin: 4px 0 0 18px; padding-left: 16px; color: #334155;">
      <li>Solve these questions neatly on paper in your physical workbook.</li>
      <li>Write your answers with clear question numbers matching the paper.</li>
      <li>Upload clear photos/scans of your answer sheet pages when finished.</li>
    </ul>
  </div>

  <div style="display: flex; flex-direction: column; gap: 12px;">
${generated.questions.map((q: any, idx: number) => `
    <p style="margin: 0 0 12px 0; font-size: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px;">
      <strong>Q${idx + 1}.</strong> ${q.prompt} <span style="color: #64748b; font-size: 13px; font-weight: normal;">[${q.marks ?? 1} Mark${(q.marks ?? 1) > 1 ? 's' : ''}]</span>
      ${q.options && q.options.length > 0 ? `
      <br/>
      <span style="display: block; margin-left: 20px; margin-top: 6px; font-size: 14px; color: #334155; font-weight: normal;">
        ${q.options.map((opt: any, oIdx: number) => `(${String.fromCharCode(65 + oIdx)}) ${opt.text}`).join(' &nbsp;&nbsp;&nbsp; ')}
      </span>
      ` : ''}
    </p>
`).join('')}
  </div>
</div>`.trim();
    } else {
      docHtml = `
<div style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.5; color: #1e293b; width: 100%;">
  <div style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px;">
    <h1 style="margin: 0; font-size: 22px;">${data.subject.toUpperCase()} WORKSHEET</h1>
    <h3 style="margin: 4px 0 0 0; color: #475569;">Grade: ${data.grade} | Topic: ${data.topic}</h3>
  </div>
  <p style="margin-bottom: 10px;"><strong>Total Marks:</strong> ${data.totalMarks}</p>
  <p>Solve the questions below in your workbook and upload photos of your answer sheets.</p>
</div>`.trim();
    }

    const paper = await prisma.worksheetPaper.create({
      data: {
        title: `${data.subject}: ${data.topic} (${data.grade})`,
        subject: data.subject,
        grade: data.grade,
        totalMarks: data.totalMarks,
        content: docHtml,
        status: 'PUBLISHED',
      },
    });

    res.status(201).json({ paper });
  } catch (error) { errorResponse(res, error); }
});

app.patch('/api/worksheets/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const schema = z.object({
      title: z.string().trim().min(1).max(200).optional(),
      subject: z.string().trim().max(100).optional(),
      grade: z.string().trim().max(50).optional(),
      totalMarks: z.number().int().min(1).optional(),
      content: z.string().trim().min(1).optional(),
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    });
    const data = parse(schema, req.body);
    const paper = await prisma.worksheetPaper.update({ where: { id }, data });
    res.json({ paper });
  } catch (error) { errorResponse(res, error); }
});

app.delete('/api/worksheets/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.worksheetPaper.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/worksheets/:id/submit', authenticate('student'), async (req: AuthRequest, res: Response) => {
  try {
    const paperId = req.params.id as string;
    const studentId = req.session!.id;
    const schema = z.object({
      images: z.array(z.string().min(10)).min(1, 'Please upload at least one image of your answer sheet.'),
    });
    const data = parse(schema, req.body);

    const paper = await prisma.worksheetPaper.findUnique({ where: { id: paperId } });
    if (!paper || paper.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'Question paper not available for submission.' });
    }

    const submission = await prisma.worksheetSubmission.upsert({
      where: { paperId_studentId: { paperId, studentId } },
      update: {
        images: JSON.stringify(data.images),
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
      create: {
        paperId,
        studentId,
        images: JSON.stringify(data.images),
        status: 'SUBMITTED',
      },
    });

    res.json({ submission });
  } catch (error) { errorResponse(res, error); }
});

app.patch('/api/worksheets/submissions/:submissionId/grade', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = req.params.submissionId as string;
    const schema = z.object({
      score: z.number().int().min(0),
      remarks: z.string().trim().max(1000).optional(),
    });
    const data = parse(schema, req.body);

    const submission = await prisma.worksheetSubmission.update({
      where: { id },
      data: {
        score: data.score,
        remarks: data.remarks ?? null,
        status: 'GRADED',
        gradedAt: new Date(),
      },
      include: { student: { select: { id: true, name: true } } },
    });

    res.json({ submission });
  } catch (error) { errorResponse(res, error); }
});

app.delete('/api/worksheets/submissions/:submissionId/images', adminOnly, async (req: Request, res: Response) => {
  try {
    const id = req.params.submissionId as string;
    const submission = await prisma.worksheetSubmission.update({
      where: { id },
      data: {
        images: '[]',
      },
    });
    res.json({ submission, ok: true });
  } catch (error) { errorResponse(res, error); }
});

// --- STUDY MATERIAL MODULE (VERSION 2) ---

// Public Study Materials List
app.get('/api/public/study-materials', async (req: Request, res: Response) => {
  try {
    const grade = typeof req.query.grade === 'string' && req.query.grade ? req.query.grade : undefined;
    const subject = typeof req.query.subject === 'string' && req.query.subject ? req.query.subject : undefined;
    const mediaType = typeof req.query.mediaType === 'string' && req.query.mediaType ? req.query.mediaType : undefined;
    const search = typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim() : undefined;

    const where: any = { status: 'PUBLISHED' };
    if (grade && grade !== 'All Grades' && grade !== 'ALL') {
      where.grade = grade;
    }
    if (subject && subject !== 'All Subjects' && subject !== 'ALL') {
      where.subject = subject;
    }
    if (mediaType && mediaType !== 'ALL') {
      where.mediaType = mediaType;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    const materials = await prisma.studyMaterial.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        grade: true,
        subject: true,
        mediaType: true,
        fileUrl: true,
        fileName: true,
        fileSize: true,
        videoUrl: true,
        coverImage: true,
        readTime: true,
        authorName: true,
        status: true,
        views: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ materials, count: materials.length });
  } catch (error) { errorResponse(res, error); }
});

// Public Single Study Material Details (with view count increment)
app.get('/api/public/study-materials/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const material = await prisma.studyMaterial.update({
      where: { id },
      data: { views: { increment: 1 } },
    });
    if (!material) return res.status(404).json({ error: 'Study material not found.' });
    res.json({ material });
  } catch (error) { errorResponse(res, error); }
});

// Public Summary of Grades & Material Counts
app.get('/api/public/grades-summary', async (_req: Request, res: Response) => {
  try {
    const all = await prisma.studyMaterial.findMany({
      where: { status: 'PUBLISHED' },
      select: { grade: true, subject: true, mediaType: true },
    });

    const standardGrades = ['Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
    const gradeCounts: Record<string, number> = {};
    for (const g of standardGrades) gradeCounts[g] = 0;

    const subjectsSet = new Set<string>();
    for (const item of all) {
      if (item.grade) {
        gradeCounts[item.grade] = (gradeCounts[item.grade] ?? 0) + 1;
      }
      if (item.subject) subjectsSet.add(item.subject);
    }

    res.json({
      grades: gradeCounts,
      subjects: Array.from(subjectsSet),
      totalMaterials: all.length,
    });
  } catch (error) { errorResponse(res, error); }
});

// Super Admin Study Material Management Endpoints (Public Portal Control)
app.get('/api/study-materials', superAdminOnly, async (_req: Request, res: Response) => {
  try {
    const materials = await prisma.studyMaterial.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ materials });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/study-materials', superAdminOnly, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(1000).optional().nullable(),
      content: z.string().trim().optional().nullable(),
      grade: z.string().trim().min(1).max(50),
      subject: z.string().trim().min(1).max(50).default('Mathematics'),
      mediaType: z.enum(['ARTICLE', 'PDF', 'VIDEO', 'PRESENTATION', 'IMAGE', 'WORKSHEET']).default('ARTICLE'),
      fileUrl: z.string().trim().optional().nullable(),
      fileName: z.string().trim().optional().nullable(),
      fileSize: z.number().int().optional().nullable(),
      videoUrl: z.string().trim().optional().nullable(),
      coverImage: z.string().trim().optional().nullable(),
      readTime: z.string().trim().optional().nullable(),
      authorName: z.string().trim().optional().default('EduAshram'),
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('PUBLISHED'),
    });
    const data = parse(schema, req.body);
    const material = await prisma.studyMaterial.create({ data: data as Prisma.StudyMaterialCreateInput });
    res.status(201).json({ material });
  } catch (error) { errorResponse(res, error); }
});

app.put('/api/study-materials/:id', superAdminOnly, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const schema = z.object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(1000).optional().nullable(),
      content: z.string().trim().optional().nullable(),
      grade: z.string().trim().min(1).max(50).optional(),
      subject: z.string().trim().min(1).max(50).optional(),
      mediaType: z.enum(['ARTICLE', 'PDF', 'VIDEO', 'PRESENTATION', 'IMAGE', 'WORKSHEET']).optional(),
      fileUrl: z.string().trim().optional().nullable(),
      fileName: z.string().trim().optional().nullable(),
      fileSize: z.number().int().optional().nullable(),
      videoUrl: z.string().trim().optional().nullable(),
      coverImage: z.string().trim().optional().nullable(),
      readTime: z.string().trim().optional().nullable(),
      authorName: z.string().trim().optional(),
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    });
    const data = parse(schema, req.body);
    const material = await prisma.studyMaterial.update({ where: { id }, data: data as Prisma.StudyMaterialUpdateInput });
    res.json({ material });
  } catch (error) { errorResponse(res, error); }
});

app.delete('/api/study-materials/:id', superAdminOnly, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.studyMaterial.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/study-materials/upload', superAdminOnly, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      fileName: z.string().min(1),
      fileData: z.string().min(1), // base64
      mediaType: z.enum(['PDF', 'PRESENTATION', 'IMAGE', 'VIDEO']),
    });
    const data = parse(schema, req.body);
    const uploadsDir = resolve('public/uploads/materials');
    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true });
    }
    const ext = data.fileName.includes('.') ? data.fileName.substring(data.fileName.lastIndexOf('.')) : '.dat';
    const safeBase = randomBytes(8).toString('hex');
    const storedFileName = `${Date.now()}_${safeBase}${ext}`;
    const filePath = resolve(uploadsDir, storedFileName);

    let base64Pure = data.fileData;
    if (base64Pure.includes(';base64,')) {
      base64Pure = base64Pure.split(';base64,')[1];
    }
    const buffer = Buffer.from(base64Pure, 'base64');
    writeFileSync(filePath, buffer);

    const fileUrl = `/uploads/materials/${storedFileName}`;
    res.json({ fileUrl, fileName: data.fileName, fileSize: buffer.length });
  } catch (error) { errorResponse(res, error); }
});

// Ensure public/uploads exists and serve statically
const uploadsDir = resolve('public/uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

app.use(express.static(resolve('public')));
app.use(express.static(resolve('dist')));
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(resolve('dist/index.html'), (error) => { if (error) next(error); });
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => errorResponse(res, error));

setInterval(() => { void finishExpiredAttempts().catch(() => { }); }, 5000).unref();
async function startServer() {
  try {
    const email = process.env.ADMIN_EMAIL || 'gaurav.kr.singh@hotmail.com';
    const password = process.env.ADMIN_PASSWORD || 'adminpassword123';
    const superAdminUsername = process.env.SUPERADMIN_USERNAME || 'admin';
    const superAdminEmail = process.env.SUPERADMIN_EMAIL || email;
    const superAdminPassword = process.env.SUPERADMIN_PASSWORD || password;
    const superAdminSecretKey = process.env.SUPERADMIN_SECRET_KEY || 'eduashram@secret2026';

    const superAdminPasswordHash = await bcrypt.hash(superAdminPassword, 12);
    const superAdminSecretKeyHash = await bcrypt.hash(superAdminSecretKey, 12);
    await db.superAdmin.upsert({
      where: { username: superAdminUsername },
      update: { email: superAdminEmail, passwordHash: superAdminPasswordHash, secretKeyHash: superAdminSecretKeyHash },
      create: { username: superAdminUsername, email: superAdminEmail, passwordHash: superAdminPasswordHash, secretKeyHash: superAdminSecretKeyHash },
    });

    const teacherPasswordHash = await bcrypt.hash(password, 12);
    await db.teacher.upsert({
      where: { email },
      update: { name: 'Gaurav Kumar Singh', active: true },
      create: { name: 'Gaurav Kumar Singh', email, passwordHash: teacherPasswordHash, school: 'EduAshram Central', subject: 'Mathematics', active: true },
    });
    console.log('✅ Super Admin & First Teacher account verified.');
  } catch (err) {
    console.error('⚠️ Account initialization check skipped:', err);
  }
  httpServer.listen(port, '0.0.0.0', () => console.log(`EduAshram server listening on port ${port}`));
}
void startServer();
