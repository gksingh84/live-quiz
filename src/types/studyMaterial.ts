export type StudyMediaType = 'ARTICLE' | 'PDF' | 'VIDEO' | 'PRESENTATION' | 'IMAGE';
export type MaterialStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type StudyMaterial = {
  id: string;
  title: string;
  description?: string | null;
  content?: string | null;
  grade: string;
  subject: string;
  mediaType: StudyMediaType;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  videoUrl?: string | null;
  coverImage?: string | null;
  readTime?: string | null;
  authorName: string;
  status: MaterialStatus;
  views: number;
  createdAt: string;
  updatedAt: string;
};

export const STANDARD_GRADES = [
  'Grade 4',
  'Grade 5',
  'Grade 6',
  'Grade 7',
  'Grade 8',
  'Grade 9',
  'Grade 10',
] as const;

export const STANDARD_SUBJECTS = [
  'Mathematics',
  'Science',
  'Social Science',
  'English',
  'Hindi',
  'Computer Science',
  'Physics',
  'Chemistry',
  'Biology',
] as const;

export const GRADE_DETAILS: Record<string, { label: string; desc: string; topics: string[]; iconEmoji: string; color: string }> = {
  'Grade 4': {
    label: 'Grade 4',
    desc: 'Foundational Numbers, Shapes & Everyday Math',
    topics: ['Fractions Basics', 'Place Value to 10,000', 'Basic Geometry & Perimeter', 'Time & Measurement'],
    iconEmoji: '🧩',
    color: '#0284c7',
  },
  'Grade 5': {
    label: 'Grade 5',
    desc: 'Decimals, Multi-digit Operations & Data',
    topics: ['Decimals & Place Value', 'Area & Volume Basics', 'Factors & Multiples (LCM/HCF)', 'Bar Graphs'],
    iconEmoji: '📐',
    color: '#059669',
  },
  'Grade 6': {
    label: 'Grade 6',
    desc: 'Integers, Fractions, Ratio & Algebra Intro',
    topics: ['Integers on Number Line', 'Ratios & Proportions', 'Basic Algebra', 'Components of Food (Sci)'],
    iconEmoji: '🔍',
    color: '#7c3aed',
  },
  'Grade 7': {
    label: 'Grade 7',
    desc: 'Algebraic Expressions, Lines & Angles',
    topics: ['Algebraic Expressions', 'Lines, Angles & Triangles', 'Rational Numbers', 'Nutrition & Heat (Sci)'],
    iconEmoji: '⚖️',
    color: '#ea580c',
  },
  'Grade 8': {
    label: 'Grade 8',
    desc: 'Linear Equations, Exponents & Force',
    topics: ['Linear Equations in 1 Var', 'Squares & Square Roots', 'Exponents & Powers', 'Force & Pressure (Sci)'],
    iconEmoji: '⚡',
    color: '#0284c7',
  },
  'Grade 9': {
    label: 'Grade 9',
    desc: 'Real Numbers, Coordinate Geometry & Motion',
    topics: ['Number Systems & Surds', 'Polynomials & Factoring', 'Coordinate Geometry', 'Motion & Laws (Sci)'],
    iconEmoji: '🔬',
    color: '#16a34a',
  },
  'Grade 10': {
    label: 'Grade 10',
    desc: 'Board Prep: Trigonometry, Quadratics & Light',
    topics: ['Trigonometric Ratios & IDs', 'Quadratic Equations', 'Arithmetic Progressions', 'Light & Reflection (Sci)'],
    iconEmoji: '🎯',
    color: '#d97706',
  },
};
