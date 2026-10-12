import React, { useState } from 'react';
import { KeyRound, ShieldCheck, ArrowRight, X, GraduationCap, LogIn, Sparkles } from 'lucide-react';

interface AuthModalProps {
  mode?: 'student' | 'admin';
  initialMode?: 'student' | 'admin';
  onClose: () => void;
  onSuccess: (user: any) => void;
}

export function AuthModal({ mode: propMode, initialMode, onClose, onSuccess }: AuthModalProps) {
  const mode = propMode || initialMode || 'student';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [passkey, setPasskey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const body = mode === 'student' ? { passkey } : { email, password };
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sign in. Please verify your credentials.');
      }

      onSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="word-doc-modal-overlay auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="icon-button quiet modal-close-btn" onClick={onClose} aria-label="Close modal">
          <X size={18} />
        </button>

        <div className="auth-modal-header">
          <div className="auth-modal-brand">
            <span className="brand-mark"><img src="/logo.png" alt="Maths Mentor" className="brand-logo" /></span>
            <span className="brand-title">Maths Mentor</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            <span
              className={`auth-role-pill ${mode === 'student' ? 'auth-role-student' : 'auth-role-teacher'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 700,
                padding: '4px 12px',
                borderRadius: '9999px',
                background: mode === 'student' ? '#f0f9ff' : '#f0fdf4',
                color: mode === 'student' ? '#0284c7' : '#047857',
                border: mode === 'student' ? '1px solid #bae6fd' : '1px solid #bbf7d0',
              }}
            >
              {mode === 'student' ? <><GraduationCap size={14} /> Student Passkey Access</> : <><LogIn size={14} /> Teacher Administration</>}
            </span>
          </div>

          <h2>{mode === 'student' ? 'Enter Student Passkey' : 'Teacher Sign In'}</h2>
          <p className="auth-subtext" style={{ marginBottom: 0 }}>
            {mode === 'student'
              ? 'Enter the 6-character passkey your teacher shared to join quizzes and submit homework.'
              : 'Sign in with your teacher credentials to manage quizzes, question papers, and study resources.'}
          </p>
        </div>

        <form onSubmit={submit} className="form-stack auth-form">
          {mode === 'student' ? (
            <label className="field">
              <span>Your Passkey</span>
              <div className="input-with-icon">
                <KeyRound size={17} />
                <input
                  autoFocus
                  required
                  value={passkey}
                  onChange={(e) => setPasskey(e.target.value.toUpperCase())}
                  placeholder="e.g. MATH99"
                  autoCapitalize="characters"
                  maxLength={12}
                />
              </div>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Teacher Email</span>
                <input
                  autoFocus
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teacher@school.com"
                  autoComplete="username"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </label>
            </>
          )}

          {error && <div className="inline-error">{error}</div>}

          <button className="button button-primary button-wide" type="submit" disabled={busy}>
            {busy ? (
              'Verifying...'
            ) : mode === 'student' ? (
              <>Join Classroom <ArrowRight size={16} /></>
            ) : (
              <>Sign In to Dashboard <ArrowRight size={16} /></>
            )}
          </button>
        </form>

        <div className="auth-modal-footer">
          {mode === 'student' ? (
            <div className="student-tip">
              <Sparkles size={14} color="#0284c7" /> Don't have a passkey? Ask your Maths Mentor teacher!
            </div>
          ) : (
            <div className="secure-note">
              <ShieldCheck size={14} color="#059669" /> Encrypted teacher session
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
