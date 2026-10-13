import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Sparkles,
  HelpCircle,
  Lightbulb,
  BookOpen,
  ArrowUp,
  ArrowDown,
  Layers,
} from 'lucide-react';
import { type WorksheetData, type WorksheetQuestion, parseWorksheetData } from '../types/studyMaterial';

interface WorksheetQuestionBuilderProps {
  initialContent?: string | null;
  onChange: (jsonContent: string) => void;
  subject?: string;
}

const DEFAULT_SAMPLE_QUESTIONS: WorksheetQuestion[] = [
  {
    id: 'q1',
    question: 'What is 3/4 expressed as a decimal?',
    options: ['0.25', '0.50', '0.75', '1.25'],
    correctIndex: 2,
    explanation: '3 divided by 4 equals 0.75 (3 ÷ 4 = 0.75).',
    hint: 'Think of 3 quarters of 1 dollar (100 cents).',
  },
  {
    id: 'q2',
    question: 'Which of the following is an improper fraction?',
    options: ['2/3', '5/4', '1/2', '3/8'],
    correctIndex: 1,
    explanation: 'An improper fraction has a numerator greater than or equal to its denominator (5 > 4).',
    hint: 'Look for the fraction where the top number is bigger than the bottom number.',
  },
  {
    id: 'q3',
    question: 'Simplify the fraction 12/16 to its lowest terms:',
    options: ['6/8', '2/3', '3/4', '4/5'],
    correctIndex: 2,
    explanation: 'Dividing both numerator and denominator by their greatest common factor (4) gives 3/4.',
    hint: 'What common factor divides both 12 and 16 evenly?',
  },
];

export function WorksheetQuestionBuilder({
  initialContent,
  onChange,
}: WorksheetQuestionBuilderProps) {
  const [passage, setPassage] = useState<string>('');
  const [questions, setQuestions] = useState<WorksheetQuestion[]>(() => {
    const parsed = parseWorksheetData(initialContent);
    if (parsed && parsed.questions.length > 0) {
      return parsed.questions;
    }
    return DEFAULT_SAMPLE_QUESTIONS;
  });

  // Load existing passage from initialContent if present
  useEffect(() => {
    const parsed = parseWorksheetData(initialContent);
    if (parsed) {
      if (parsed.passage !== undefined) setPassage(parsed.passage);
      if (parsed.questions && parsed.questions.length > 0) {
        setQuestions(parsed.questions);
      }
    }
  }, [initialContent]);

  // Sync to parent whenever questions or passage change
  useEffect(() => {
    const data: WorksheetData = {
      passage: passage.trim() || undefined,
      questions,
    };
    onChange(JSON.stringify(data, null, 2));
  }, [questions, passage]);

  function handleAddQuestion() {
    const newQ: WorksheetQuestion = {
      id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      question: '',
      options: ['', '', '', ''],
      correctIndex: 0,
      explanation: '',
      hint: '',
    };
    setQuestions((prev) => [...prev, newQ]);
  }

  function handleRemoveQuestion(idx: number) {
    if (questions.length <= 1) {
      alert('A worksheet must have at least one question.');
      return;
    }
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleMoveQuestion(idx: number, direction: 'up' | 'down') {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= questions.length) return;
    setQuestions((prev) => {
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
  }

  function updateQuestion(idx: number, patch: Partial<WorksheetQuestion>) {
    setQuestions((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  }

  function updateOption(qIdx: number, optIdx: number, val: string) {
    setQuestions((prev) => {
      const copy = [...prev];
      const q = { ...copy[qIdx] };
      const options = [...q.options];
      options[optIdx] = val;
      q.options = options;
      copy[qIdx] = q;
      return copy;
    });
  }

  function handleLoadTemplate() {
    if (
      questions.length > 0 &&
      !window.confirm('Replace current questions with standard sample questions?')
    ) {
      return;
    }
    setQuestions(DEFAULT_SAMPLE_QUESTIONS);
    setPassage('');
  }

  return (
    <div className="worksheet-builder-root">
      <div className="worksheet-builder-header">
        <div>
          <h4 className="builder-title">
            <Layers size={18} color="#0284c7" /> Interactive Worksheet Questions Editor
          </h4>
          <p className="builder-subtitle">
            Students solve these questions directly on the public portal with instant feedback and a final scorecard.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="button button-secondary"
            style={{ fontSize: '12px', padding: '5px 12px' }}
            onClick={handleLoadTemplate}
          >
            <Sparkles size={13} /> Load Sample Set
          </button>
          <button
            type="button"
            className="button button-primary"
            style={{ fontSize: '12px', padding: '5px 14px' }}
            onClick={handleAddQuestion}
          >
            <Plus size={14} /> Add Question
          </button>
        </div>
      </div>

      {/* Optional Context/Passage Box */}
      <div className="builder-passage-field">
        <label>
          <span className="passage-label">
            <BookOpen size={14} /> Optional Reading Passage, Scenario, or Problem Context:
          </span>
          <textarea
            rows={2}
            value={passage}
            onChange={(e) => setPassage(e.target.value)}
            placeholder="e.g. Read the following paragraph on Photosynthesis, or view the instructions below before solving..."
            className="passage-textarea"
          />
        </label>
      </div>

      {/* Questions Stack */}
      <div className="builder-questions-list">
        {questions.map((q, qIndex) => (
          <div key={q.id || qIndex} className="builder-question-card">
            <div className="question-card-topbar">
              <span className="q-pill-badge">Question {qIndex + 1}</span>
              <div className="q-actions-row">
                <button
                  type="button"
                  className="icon-btn-micro"
                  disabled={qIndex === 0}
                  onClick={() => handleMoveQuestion(qIndex, 'up')}
                  title="Move Up"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn-micro"
                  disabled={qIndex === questions.length - 1}
                  onClick={() => handleMoveQuestion(qIndex, 'down')}
                  title="Move Down"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn-micro danger"
                  onClick={() => handleRemoveQuestion(qIndex)}
                  title="Delete Question"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Question Text */}
            <label className="field compact-field" style={{ marginTop: '8px' }}>
              <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Question Prompt:</span>
              <input
                required
                value={q.question}
                onChange={(e) => updateQuestion(qIndex, { question: e.target.value })}
                placeholder="e.g. Solve: 2/5 + 1/3 = ?"
                style={{ fontSize: '13.5px' }}
              />
            </label>

            {/* Options */}
            <div className="builder-options-block">
              <span className="options-legend">
                Options (Click the radio button beside the correct answer):
              </span>
              <div className="options-inputs-grid">
                {q.options.map((opt, optIndex) => {
                  const isCorrect = q.correctIndex === optIndex;
                  return (
                    <div
                      key={optIndex}
                      className={`builder-option-row ${isCorrect ? 'is-correct-target' : ''}`}
                    >
                      <label className="correct-radio-label" title="Mark as correct answer">
                        <input
                          type="radio"
                          name={`correct_${q.id || qIndex}`}
                          checked={isCorrect}
                          onChange={() => updateQuestion(qIndex, { correctIndex: optIndex })}
                        />
                        <span className="option-letter">{String.fromCharCode(65 + optIndex)}</span>
                      </label>
                      <input
                        required
                        value={opt}
                        onChange={(e) => updateOption(qIndex, optIndex, e.target.value)}
                        placeholder={`Option ${String.fromCharCode(65 + optIndex)}`}
                        className="builder-option-input"
                      />
                      {isCorrect && (
                        <span className="correct-tag-badge">
                          <CheckCircle2 size={12} /> Correct
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step-by-Step Explanation & Hint */}
            <div className="builder-explanation-grid">
              <label className="field compact-field">
                <span style={{ fontSize: '12px', color: '#047857', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <HelpCircle size={13} /> Step-by-Step Explanation (shown to student if wrong or to verify):
                </span>
                <input
                  value={q.explanation || ''}
                  onChange={(e) => updateQuestion(qIndex, { explanation: e.target.value })}
                  placeholder="e.g. LCM of 5 and 3 is 15. Convert 2/5 to 6/15 and 1/3 to 5/15. Sum is 11/15."
                  style={{ fontSize: '12.5px' }}
                />
              </label>

              <label className="field compact-field">
                <span style={{ fontSize: '12px', color: '#b45309', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Lightbulb size={13} /> Optional Hint (student can click 'Need a Hint'):
                </span>
                <input
                  value={q.hint || ''}
                  onChange={(e) => updateQuestion(qIndex, { hint: e.target.value })}
                  placeholder="e.g. Find the common denominator first."
                  style={{ fontSize: '12.5px' }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '14px', textAlign: 'center' }}>
        <button
          type="button"
          className="button button-secondary"
          style={{ width: '100%', padding: '8px' }}
          onClick={handleAddQuestion}
        >
          <Plus size={15} /> Add Another Question ({questions.length} currently)
        </button>
      </div>
    </div>
  );
}
