import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
  await prisma.admin.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(password, 12) },
    create: { email, passwordHash: await bcrypt.hash(password, 12) },
  });
  console.log(`Admin account ready for ${email}`);

  const existingCount = await (prisma as any).studyMaterial.count();
  if (existingCount === 0) {
    console.log('Seeding initial Study Materials for Grade 4 to Grade 10...');
    const sampleMaterials = [
      {
        title: 'Visual Guide to Fractions: Parts of a Whole',
        description: 'Understand proper, improper, and mixed fractions with intuitive visual circle diagrams and real-world pizza slices.',
        content: `<h3>What is a Fraction?</h3>
<p>A fraction represents equal parts of a whole or a collection. When an object or number is divided into equal sections, each section is a fraction.</p>
<h4>Key Components:</h4>
<ul>
  <li><strong>Numerator (Top Number):</strong> How many equal parts you have taken or are looking at.</li>
  <li><strong>Denominator (Bottom Number):</strong> The total number of equal parts into which the whole is divided.</li>
</ul>
<blockquote><em>Example:</em> If a pizza is sliced into 8 equal slices and you eat 3 slices, you have eaten <strong>3/8</strong> of the pizza.</blockquote>
<h4>Types of Fractions:</h4>
<ol>
  <li><strong>Proper Fractions:</strong> Numerator is strictly less than denominator (e.g., 2/5, 7/9).</li>
  <li><strong>Improper Fractions:</strong> Numerator is greater than or equal to denominator (e.g., 7/4, 9/2).</li>
  <li><strong>Mixed Numbers:</strong> A combination of a whole number and a proper fraction (e.g., 1 3/4).</li>
</ol>
<p>Practice converting between improper fractions and mixed numbers to master basic arithmetic!</p>`,
        grade: 'Grade 4',
        subject: 'Mathematics',
        mediaType: 'ARTICLE',
        coverImage: 'https://images.unsplash.com/photo-1596495578065-6e0763fa1178?w=800&auto=format&fit=crop&q=60',
        readTime: '5 min read',
        authorName: 'Maths Mentor Faculty',
        views: 142,
      },
      {
        title: 'Decimals, Money and Place Value Decoded',
        description: 'Interactive lesson connecting tenths and hundredths directly to currency, weights, and measurements.',
        content: `<h3>Understanding the Decimal Point</h3>
<p>The decimal point acts as a separator between whole units and fractional parts less than one.</p>
<ul>
  <li>The first digit to the right of the decimal point is the <strong>Tenths</strong> place (1/10 = 0.1).</li>
  <li>The second digit is the <strong>Hundredths</strong> place (1/100 = 0.01).</li>
  <li>The third digit is the <strong>Thousandths</strong> place (1/1000 = 0.001).</li>
</ul>
<p>Think of Indian Currency: ₹1 = 100 paise. So 50 paise = ₹0.50!</p>`,
        grade: 'Grade 5',
        subject: 'Mathematics',
        mediaType: 'PRESENTATION',
        coverImage: 'https://images.unsplash.com/photo-1634128221889-82ed6efebfc3?w=800&auto=format&fit=crop&q=60',
        readTime: '8 min slides',
        authorName: 'Maths Mentor Faculty',
        views: 98,
      },
      {
        title: 'Integers & The Real-World Number Line',
        description: 'Why do we need negative numbers? Explore sea level, temperature, and profit-loss on the number line in this animated video lesson.',
        content: `<h3>Why Negative Numbers Matter</h3>
<p>Negative integers allow us to measure quantities that decrease below a reference zero point:</p>
<ul>
  <li>Freezing point of water: Sub-zero temperatures like -5°C.</li>
  <li>Elevation: Deep sea trenches below sea level (0m).</li>
  <li>Finance: Debt, debits, or business loss.</li>
</ul>
<h4>Golden Rules for Adding and Subtracting Integers:</h4>
<ol>
  <li>Adding two positive numbers yields a positive number: (+5) + (+3) = +8</li>
  <li>Adding two negative numbers yields a negative number: (-5) + (-3) = -8</li>
  <li>When signs differ, subtract the smaller absolute value from the larger, and keep the sign of the larger absolute value: (-7) + (+4) = -3</li>
</ol>`,
        grade: 'Grade 6',
        subject: 'Mathematics',
        mediaType: 'VIDEO',
        videoUrl: 'https://www.youtube.com/watch?v=OAoLCXpao6s',
        coverImage: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=800&auto=format&fit=crop&q=60',
        readTime: '12 min video',
        authorName: 'Maths Mentor Faculty',
        views: 310,
      },
      {
        title: 'Components of Food & Balanced Diet Blueprint',
        description: 'Comprehensive chapter revision notes on carbohydrates, proteins, fats, vitamins, and deficiency diseases.',
        content: `<h3>Major Nutrients in Our Food</h3>
<p>Our bodies need essential chemical substances called nutrients to survive, grow, and repair tissue:</p>
<ul>
  <li><strong>Carbohydrates:</strong> Provide immediate energy. Sources: Rice, wheat, potatoes, sugar.</li>
  <li><strong>Fats:</strong> Provide concentrated energy reserves and thermal insulation. Sources: Butter, ghee, nuts, vegetable oils.</li>
  <li><strong>Proteins:</strong> Body-building nutrients essential for muscle repair and enzyme synthesis. Sources: Pulses, milk, paneer, eggs.</li>
  <li><strong>Vitamins & Minerals:</strong> Protective nutrients defending against infections.</li>
</ul>
<h4>Common Deficiency Diseases:</h4>
<ul>
  <li>Vitamin A deficiency &rarr; Night blindness</li>
  <li>Vitamin C deficiency &rarr; Scurvy (bleeding gums)</li>
  <li>Vitamin D deficiency &rarr; Rickets (soft bones)</li>
  <li>Iron deficiency &rarr; Anaemia (fatigue, paleness)</li>
</ul>`,
        grade: 'Grade 6',
        subject: 'Science',
        mediaType: 'PDF',
        coverImage: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=60',
        readTime: '10 min read',
        authorName: 'Science Department',
        views: 220,
      },
      {
        title: 'Algebraic Expressions: Variables, Constants & Like Terms',
        description: 'Demystifying algebra by looking at balance scales. Learn how to combine like terms and evaluate expressions.',
        content: `<h3>Translating Everyday Words into Algebra</h3>
<p>In algebra, letters like <em>x</em>, <em>y</em>, and <em>z</em> represent variables whose values can change or are currently unknown.</p>
<h4>Key Terms:</h4>
<ul>
  <li><strong>Constant:</strong> A symbol with a fixed numerical value (e.g., 5, -8, 12).</li>
  <li><strong>Variable:</strong> A symbol that can take various numerical values (e.g., x, a, t).</li>
  <li><strong>Coefficient:</strong> The numerical factor multiplying a variable (in 7x, 7 is the coefficient).</li>
  <li><strong>Like Terms:</strong> Terms that share the exact same algebraic factors with identical powers (e.g., 3xy and -5xy).</li>
</ul>
<p>Remember: Only like terms can be added or subtracted together!</p>`,
        grade: 'Grade 7',
        subject: 'Mathematics',
        mediaType: 'ARTICLE',
        coverImage: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&auto=format&fit=crop&q=60',
        readTime: '7 min read',
        authorName: 'Maths Mentor Faculty',
        views: 185,
      },
      {
        title: 'Linear Equations in One Variable - Complete Masterclass',
        description: 'Transposition method vs inverse operations. Solved word problems on age, perimeter, and digits with detailed breakdown.',
        content: `<h3>What is a Linear Equation?</h3>
<p>An algebraic equation where the highest exponent of the variable is exactly 1 is known as a linear equation in one variable.</p>
<p>Standard form: <code>ax + b = 0</code> (where a &ne; 0)</p>
<h4>The Transposition Method:</h4>
<p>When moving a term from one side of the equals sign to the other:</p>
<ul>
  <li>Addition becomes Subtraction: <code>x + 7 = 15 &rarr; x = 15 - 7 = 8</code></li>
  <li>Subtraction becomes Addition: <code>x - 4 = 10 &rarr; x = 10 + 4 = 14</code></li>
  <li>Multiplication becomes Division: <code>3x = 21 &rarr; x = 21 / 3 = 7</code></li>
  <li>Division becomes Multiplication: <code>x / 5 = 6 &rarr; x = 6 &times; 5 = 30</code></li>
</ul>`,
        grade: 'Grade 8',
        subject: 'Mathematics',
        mediaType: 'ARTICLE',
        coverImage: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop&q=60',
        readTime: '9 min read',
        authorName: 'Maths Mentor Faculty',
        views: 412,
      },
      {
        title: 'Force and Pressure: Contact Forces & Hydraulic Mechanisms',
        description: 'Visual presentation breaking down Newton\'s laws, atmospheric pressure, and hydraulic systems with diagrams.',
        content: `<h3>What is Force?</h3>
<p>A push or pull acting upon an object as a result of its interaction with another object. Unit: Newton (N).</p>
<h4>Types of Forces:</h4>
<ul>
  <li><strong>Contact Forces:</strong> Muscular Force, Frictional Force, Normal Reaction Force.</li>
  <li><strong>Non-Contact Forces:</strong> Gravitational Force, Electrostatic Force, Magnetic Force.</li>
</ul>
<h3>Pressure: Force per Unit Area</h3>
<p>Formula: <code>Pressure = Force / Area</code> (Unit: Pascal or N/m&sup2;).</p>
<p>Why do sharp knives cut better than blunt ones? Because a smaller contact area creates immense pressure with the same applied force!</p>`,
        grade: 'Grade 8',
        subject: 'Science',
        mediaType: 'PRESENTATION',
        coverImage: 'https://images.unsplash.com/photo-1507668077129-56e32842fceb?w=800&auto=format&fit=crop&q=60',
        readTime: '11 min slides',
        authorName: 'Science Department',
        views: 260,
      },
      {
        title: 'Real Numbers & Rationalizing the Denominator',
        description: 'Irrational numbers on the real line, laws of exponents, and rationalizing surds step-by-step with proofs.',
        content: `<h3>Classification of Real Numbers</h3>
<p>Real numbers (R) include all Rational (Q) and Irrational (Q') numbers.</p>
<h4>Rationalizing Surds:</h4>
<p>When an algebraic fraction has an irrational root in its denominator, we multiply numerator and denominator by its conjugate radical to eliminate the radical.</p>
<blockquote>Example: To rationalize <code>1 / (sqrt(3) - 1)</code>, multiply by <code>(sqrt(3) + 1) / (sqrt(3) + 1)</code>.<br/>Denominator becomes <code>(sqrt(3))&sup2; - 1&sup2; = 3 - 1 = 2</code>.</blockquote>`,
        grade: 'Grade 9',
        subject: 'Mathematics',
        mediaType: 'ARTICLE',
        coverImage: 'https://images.unsplash.com/photo-1453733197797-0b96869576a1?w=800&auto=format&fit=crop&q=60',
        readTime: '8 min read',
        authorName: 'Maths Mentor Faculty',
        views: 380,
      },
      {
        title: 'Trigonometry Formulas, Identities & Height-Distance Tricks',
        description: 'Essential formula sheet and mind-map for sin, cos, tan identities, Pythagorean relations, and angles of elevation/depression.',
        content: `<h3>Right Triangle Ratios</h3>
<p>For an acute angle &theta; in a right-angled triangle:</p>
<ul>
  <li><code>sin &theta; = Opposite / Hypotenuse</code></li>
  <li><code>cos &theta; = Adjacent / Hypotenuse</code></li>
  <li><code>tan &theta; = Opposite / Adjacent</code></li>
  <li><code>cosec &theta; = 1 / sin &theta;</code></li>
  <li><code>sec &theta; = 1 / cos &theta;</code></li>
  <li><code>cot &theta; = 1 / tan &theta;</code></li>
</ul>
<h4>Fundamental Pythagorean Identities:</h4>
<ol>
  <li><code>sin&sup2; &theta; + cos&sup2; &theta; = 1</code></li>
  <li><code>1 + tan&sup2; &theta; = sec&sup2; &theta;</code></li>
  <li><code>1 + cot&sup2; &theta; = cosec&sup2; &theta;</code></li>
</ol>`,
        grade: 'Grade 10',
        subject: 'Mathematics',
        mediaType: 'PDF',
        coverImage: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=800&auto=format&fit=crop&q=60',
        readTime: '15 min read',
        authorName: 'Maths Mentor Faculty',
        views: 740,
      },
      {
        title: 'Quadratic Equations: Complete Solution & Nature of Roots',
        description: 'Deep dive into finding roots, discriminant analysis (nature of roots), and framing quadratic equations from word problems.',
        content: `<h3>General Form of Quadratic Equation</h3>
<p><code>ax&sup2; + bx + c = 0</code> (where a &ne; 0)</p>
<h4>The Quadratic Formula:</h4>
<p><code>x = (-b &plusmn; sqrt(b&sup2; - 4ac)) / (2a)</code></p>
<h4>The Discriminant (D = b&sup2; - 4ac):</h4>
<ul>
  <li>If <strong>D &gt; 0</strong>: Two distinct real roots exist.</li>
  <li>If <strong>D = 0</strong>: Two equal real roots exist (x = -b / 2a).</li>
  <li>If <strong>D &lt; 0</strong>: No real roots exist (complex conjugate roots).</li>
</ul>`,
        grade: 'Grade 10',
        subject: 'Mathematics',
        mediaType: 'VIDEO',
        videoUrl: 'https://www.youtube.com/watch?v=IlNAgd5U3iM',
        coverImage: 'https://images.unsplash.com/photo-1596495578065-6e0763fa1178?w=800&auto=format&fit=crop&q=60',
        readTime: '16 min video',
        authorName: 'Maths Mentor Faculty',
        views: 615,
      },
    ];

    for (const item of sampleMaterials) {
      await (prisma as any).studyMaterial.create({ data: item });
    }
    console.log(`Successfully seeded ${sampleMaterials.length} sample study materials!`);
  }
}

main().finally(() => prisma.$disconnect());
