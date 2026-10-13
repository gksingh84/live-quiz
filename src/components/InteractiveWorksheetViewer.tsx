import { useState, useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  RotateCcw,
  Download,
  Printer,
  ChevronRight,
  ChevronLeft,
  Award,
  BookOpen,
  Sparkles,
  FileText,
  Lightbulb,
} from 'lucide-react';
import { type StudyMaterial, type WorksheetData, parseWorksheetData } from '../types/studyMaterial';

interface InteractiveWorksheetViewerProps {
  material: StudyMaterial;
  onOpenQuizLogin?: () => void;
}

export function InteractiveWorksheetViewer({ material }: InteractiveWorksheetViewerProps) {
  const worksheetData: WorksheetData | null = useMemo(() => {
    return parseWorksheetData(material.content);
  }, [material.content]);

  const questions = worksheetData?.questions || [];
  const totalQuestions = questions.length;

  const [currentIndex, setCurrentIndex] = useState(0);
  // Map of questionId -> selectedOptionIndex
  const [userAnswers, setUserAnswers] = useState<Record<string, number>>({});
  const [isCompleted, setIsCompleted] = useState(false);
  const [showHint, setShowHint] = useState<Record<string, boolean>>({});

  const currentQ = questions[currentIndex];
  const hasAnsweredCurrent = currentQ ? userAnswers[currentQ.id] !== undefined : false;

  // Calculate live score
  const score = useMemo(() => {
    return questions.reduce((acc, q) => {
      const ans = userAnswers[q.id];
      return ans !== undefined && ans === q.correctIndex ? acc + 1 : acc;
    }, 0);
  }, [questions, userAnswers]);

  const answeredCount = Object.keys(userAnswers).length;

  function handleSelectOption(optionIndex: number) {
    if (!currentQ || hasAnsweredCurrent || isCompleted) return;
    setUserAnswers((prev) => ({
      ...prev,
      [currentQ.id]: optionIndex,
    }));
  }

  function handleRestart() {
    setUserAnswers({});
    setCurrentIndex(0);
    setIsCompleted(false);
    setShowHint({});
  }

  function handlePrint() {
    const win = window.open('', '_blank');
    if (!win) return;
    const questionsHtml = questions
      .map(
        (q, idx) => `
        <div style="margin-bottom: 22px; page-break-inside: avoid;">
          <p style="font-weight: 700; font-size: 15px; margin-bottom: 8px;">Q${idx + 1}. ${q.question}</p>
          <div style="margin-left: 18px;">
            ${q.options.map((opt, oIdx) => `<div style="margin-bottom: 5px;">( ) ${String.fromCharCode(65 + oIdx)}. ${opt}</div>`).join('')}
          </div>
        </div>
      `
      )
      .join('');

    win.document.write(`<!DOCTYPE html>
    <html>
      <head>
        <title>${material.title} - EduAshram Worksheet</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25mm 20mm; color: #0f172a; line-height: 1.5; }
          .header { border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 24px; }
          .title { font-size: 22px; font-weight: 800; margin: 0 0 6px; }
          .meta { font-size: 13px; color: #475569; }
          .passage-box { background: #f8fafc; border-left: 3px solid #0284c7; padding: 12px; margin-bottom: 20px; font-style: italic; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">${material.title}</div>
          <div class="meta">${material.grade} · ${material.subject} · EduAshram Worksheet (eduashram.in)</div>
        </div>
        ${worksheetData?.passage ? `<div class="passage-box"><strong>Reading Context:</strong><br/>${worksheetData.passage}</div>` : ''}
        ${questionsHtml}
      </body>
    </html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  // Fallback if no questions are configured yet
  if (!worksheetData || questions.length === 0) {
    return (
      <div className="worksheet-viewer-empty">
        <div className="empty-icon-circle">
          <FileText size={36} color="#0284c7" />
        </div>
        <h3>Printable & Interactive Worksheet</h3>
        <p>{material.description || 'Practice worksheet prepared for this chapter.'}</p>
        {material.fileUrl && (
          <div className="empty-download-box">
            <a
              href={material.fileUrl}
              download={material.fileName || 'worksheet.pdf'}
              target="_blank"
              rel="noopener noreferrer"
              className="button button-primary"
            >
              <Download size={16} /> Download Worksheet PDF
            </a>
            <button className="button button-secondary" onClick={handlePrint}>
              <Printer size={16} /> Print Worksheet
            </button>
          </div>
        )}
      </div>
    );
  }

  const percentage = Math.round((score / totalQuestions) * 100);

  return (
    <div className="interactive-worksheet-shell">
      {/* Top Action & Material Header */}
      <div className="worksheet-meta-strip">
        <div className="worksheet-badges-row">
          <span className="worksheet-type-pill">
            <FileText size={13} /> Interactive Worksheet
          </span>
          <span className="worksheet-grade-pill">{material.grade}</span>
          <span className="worksheet-subject-pill">{material.subject}</span>
        </div>

        <div className="worksheet-quick-actions">
          {material.fileUrl && (
            <a
              href={material.fileUrl}
              download={material.fileName || 'worksheet.pdf'}
              target="_blank"
              rel="noopener noreferrer"
              className="action-link-btn"
              title="Download PDF version"
            >
              <Download size={14} /> PDF
            </a>
          )}
          <button className="action-link-btn" onClick={handlePrint} title="Print worksheet">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {!isCompleted ? (
        <div className="worksheet-active-container">
          {/* Progress and Live Score Tracker */}
          <div className="worksheet-progress-bar-wrap">
            <div className="progress-labels-row">
              <span className="progress-count-text">
                Question <strong>{currentIndex + 1}</strong> of <strong>{totalQuestions}</strong>
              </span>
              <span className="progress-score-text">
                Live Score: <strong>{score}</strong> / {answeredCount}
              </span>
            </div>
            <div className="worksheet-progress-track">
              <div
                className="worksheet-progress-fill"
                style={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }}
              />
            </div>
          </div>

          {/* Reading Context / Passage (if present) */}
          {worksheetData.passage && (
            <div className="worksheet-passage-box">
              <div className="passage-title">
                <BookOpen size={16} /> Reading Context / Problem Scenario
              </div>
              <p className="passage-body">{worksheetData.passage}</p>
            </div>
          )}

          {/* Question Card */}
          <div className="worksheet-question-card">
            <div className="question-header-row">
              <span className="question-number-pill">Q{currentIndex + 1}</span>
              {currentQ.hint && (
                <button
                  type="button"
                  className="hint-toggle-btn"
                  onClick={() => setShowHint((prev) => ({ ...prev, [currentQ.id]: !prev[currentQ.id] }))}
                >
                  <Lightbulb size={14} /> {showHint[currentQ.id] ? 'Hide Hint' : 'Need a Hint?'}
                </button>
              )}
            </div>

            {showHint[currentQ.id] && currentQ.hint && (
              <div className="question-hint-box">
                <Lightbulb size={15} color="#d97706" />
                <span>{currentQ.hint}</span>
              </div>
            )}

            <h2 className="worksheet-question-text">{currentQ.question}</h2>

            {/* Options List */}
            <div className="worksheet-options-grid">
              {currentQ.options.map((opt, oIndex) => {
                const isSelected = userAnswers[currentQ.id] === oIndex;
                const isCorrect = oIndex === currentQ.correctIndex;

                let optionStateClass = 'option-neutral';
                if (hasAnsweredCurrent) {
                  if (isSelected && isCorrect) {
                    optionStateClass = 'option-correct-picked';
                  } else if (isSelected && !isCorrect) {
                    optionStateClass = 'option-wrong-picked';
                  } else if (!isSelected && isCorrect) {
                    optionStateClass = 'option-correct-revealed';
                  } else {
                    optionStateClass = 'option-disabled';
                  }
                }

                return (
                  <button
                    key={oIndex}
                    type="button"
                    className={`worksheet-option-card ${optionStateClass}`}
                    onClick={() => handleSelectOption(oIndex)}
                    disabled={hasAnsweredCurrent}
                  >
                    <div className="option-letter-badge">{String.fromCharCode(65 + oIndex)}</div>
                    <div className="option-text">{opt}</div>
                    <div className="option-feedback-icon">
                      {hasAnsweredCurrent && isCorrect && <CheckCircle2 size={18} className="feedback-check" />}
                      {hasAnsweredCurrent && isSelected && !isCorrect && (
                        <XCircle size={18} className="feedback-cross" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Instant Feedback Explanation Box */}
            {hasAnsweredCurrent && (
              <div
                className={`worksheet-explanation-banner ${
                  userAnswers[currentQ.id] === currentQ.correctIndex ? 'banner-correct' : 'banner-incorrect'
                }`}
              >
                <div className="banner-top">
                  {userAnswers[currentQ.id] === currentQ.correctIndex ? (
                    <>
                      <Sparkles size={18} color="#059669" />
                      <strong>Correct! Great job!</strong>
                    </>
                  ) : (
                    <>
                      <HelpCircle size={18} color="#dc2626" />
                      <strong>
                        Not quite! The correct answer is Option {String.fromCharCode(65 + currentQ.correctIndex)}:{' '}
                        <em>{currentQ.options[currentQ.correctIndex]}</em>
                      </strong>
                    </>
                  )}
                </div>
                {currentQ.explanation && (
                  <div className="banner-explanation-body">
                    <strong>Explanation:</strong> {currentQ.explanation}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Navigation Buttons */}
          <div className="worksheet-nav-toolbar">
            <button
              type="button"
              className="button button-secondary nav-btn"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
            >
              <ChevronLeft size={16} /> Previous
            </button>

            {currentIndex < totalQuestions - 1 ? (
              <button
                type="button"
                className="button button-primary nav-btn"
                onClick={() => setCurrentIndex((idx) => idx + 1)}
              >
                Next Question <ChevronRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="button button-primary nav-btn complete-btn"
                onClick={() => setIsCompleted(true)}
              >
                Finish & View Score <Award size={16} />
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Final Score Card */
        <div className="worksheet-scorecard-view">
          <div className="scorecard-hero-block">
            <div className="celebration-badge-circle">
              {percentage >= 80 ? '🌟' : percentage >= 50 ? '👏' : '💪'}
            </div>
            <h2>
              {percentage >= 80
                ? 'Outstanding Mastery!'
                : percentage >= 50
                ? 'Well Done! Good Practice!'
                : 'Good Effort! Keep Practicing!'}
            </h2>
            <p className="scorecard-subtitle">
              You completed the worksheet for <strong>{material.title}</strong>
            </p>

            <div className="score-stat-pills-row">
              <div className="stat-pill">
                <span className="stat-num">
                  {score} / {totalQuestions}
                </span>
                <span className="stat-desc">Correct Answers</span>
              </div>
              <div className="stat-pill stat-accent">
                <span className="stat-num">{percentage}%</span>
                <span className="stat-desc">Score</span>
              </div>
              <div className="stat-pill">
                <span className="stat-num">{totalQuestions - score}</span>
                <span className="stat-desc">Needs Revision</span>
              </div>
            </div>

            <div className="scorecard-actions-row">
              <button type="button" className="button button-primary" onClick={handleRestart}>
                <RotateCcw size={16} /> Practice Worksheet Again
              </button>
              {material.fileUrl && (
                <a
                  href={material.fileUrl}
                  download={material.fileName || 'worksheet.pdf'}
                  className="button button-secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download size={16} /> Download Printable PDF
                </a>
              )}
              <button type="button" className="button button-secondary" onClick={handlePrint}>
                <Printer size={16} /> Print Worksheet
              </button>
            </div>
          </div>

          {/* Breakdown Review List */}
          <div className="worksheet-review-section">
            <h3>Question-by-Question Review</h3>
            <div className="review-questions-list">
              {questions.map((q, idx) => {
                const ans = userAnswers[q.id];
                const isUserCorrect = ans === q.correctIndex;
                return (
                  <div
                    key={q.id}
                    className={`review-question-item ${isUserCorrect ? 'review-item-correct' : 'review-item-wrong'}`}
                  >
                    <div className="review-item-top">
                      <span className="review-q-num">Q{idx + 1}</span>
                      <span className="review-status-badge">
                        {isUserCorrect ? (
                          <>
                            <CheckCircle2 size={14} color="#059669" /> Correct
                          </>
                        ) : (
                          <>
                            <XCircle size={14} color="#dc2626" /> Incorrect
                          </>
                        )}
                      </span>
                    </div>
                    <p className="review-question-text">{q.question}</p>
                    <div className="review-answers-box">
                      <div className="user-choice">
                        <strong>Your choice:</strong>{' '}
                        {ans !== undefined ? (
                          <span>
                            {String.fromCharCode(65 + ans)}. {q.options[ans]}
                          </span>
                        ) : (
                          <em>Skipped</em>
                        )}
                      </div>
                      {!isUserCorrect && (
                        <div className="correct-choice">
                          <strong>Correct answer:</strong>{' '}
                          <span>
                            {String.fromCharCode(65 + q.correctIndex)}. {q.options[q.correctIndex]}
                          </span>
                        </div>
                      )}
                    </div>
                    {q.explanation && (
                      <div className="review-explanation">
                        <strong>Explanation:</strong> {q.explanation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
