import React, { useState } from 'react';
import { KeyRound, ShieldCheck, ArrowRight, X, GraduationCap, LogIn, Sparkles, UserPlus, Building, BookOpen, Phone, CheckCircle2 } from 'lucide-react';

export type AuthMode = 'student' | 'teacher_login' | 'teacher_signup' | 'admin';

interface AuthModalProps {
  mode: AuthMode;
  initialMode?: AuthMode;
  onClose: () => void;
  onSuccess: (user: any) => void;
  onSwitchMode?: (mode: AuthMode) => void;
}

export function AuthModal({ mode: propMode, initialMode, onClose, onSuccess, onSwitchMode }: AuthModalProps) {
  const [internalMode, setInternalMode] = useState<AuthMode>(() => propMode || initialMode || 'student');
  const activeMode = propMode || internalMode;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Student Fields
  const [passkey, setPasskey] = useState('');

  // Teacher Login Fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Teacher Signup Fields
  const [name, setName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [school, setSchool] = useState('');
  const [subject, setSubject] = useState('Mathematics');
  const [phone, setPhone] = useState('');

  const handleSwitch = (newMode: AuthMode) => {
    setError('');
    setSuccessMsg('');
    if (onSwitchMode) {
      onSwitchMode(newMode);
    } else {
      setInternalMode(newMode);
    }
  };

  async function handleStudentLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/student', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: passkey.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Invalid student passkey.');
      onSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with passkey.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTeacherLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/teacher/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Fallback to legacy /api/auth/admin if needed
        if (res.status === 401) {
          const fallbackRes = await fetch('/api/auth/admin', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
          });
          const fbData = await fallbackRes.json().catch(() => ({}));
          if (fallbackRes.ok) {
            onSuccess(fbData.user);
            return;
          }
        }
        throw new Error(data.error || 'Failed to sign in. Please verify your teacher credentials.');
      }
      onSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTeacherSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccessMsg('');

    if (signupPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-enter your password.');
      setBusy(false);
      return;
    }

    if (signupPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      setBusy(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/teacher/signup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: signupEmail.trim(),
          password: signupPassword,
          school: school.trim() || undefined,
          subject: subject.trim() || 'Mathematics',
          phone: phone.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to register teacher account.');
      }

      setSuccessMsg(data.message || 'Teacher registration submitted successfully! Your account will be activated once approved by the EduAshram Administrator.');
      localStorage.removeItem('livequiz_ai_key');
      setName('');
      setSignupEmail('');
      setSignupPassword('');
      setConfirmPassword('');
      setSchool('');
      setPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  // ==========================================
  // 1. DEDICATED STUDENT SIGN IN CARD
  // ==========================================
  if (activeMode === 'student') {
    return (
      <div className="word-doc-modal-overlay auth-modal-overlay">
        <div className="auth-modal-card auth-card-student" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
          <button className="icon-button quiet modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>

          <div className="auth-modal-header">
            <div className="auth-header-top">
              <div className="auth-modal-brand">
                <span className="brand-mark"><img src="/logo.png" alt="EduAshram" className="brand-logo" /></span>
                <span className="brand-title">EduAshram</span>
              </div>
              <span className="auth-role-badge auth-badge-student">
                <GraduationCap size={13} /> STUDENT PORTAL
              </span>
            </div>

            <h2>Enter Student Passkey</h2>
            <p className="auth-subtext" style={{ marginBottom: 0, fontSize: '13.5px', color: '#64748b' }}>
              Enter the 6-character passkey provided by your teacher to join classroom quizzes and view worksheets.
            </p>
          </div>

          <form onSubmit={handleStudentLogin} className="form-stack auth-form">
            <label className="field">
              <span>Your Classroom Passkey</span>
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

            {error && <div className="inline-error">{error}</div>}

            <button className="button button-primary button-wide" type="submit" disabled={busy} style={{ background: '#0284c7', borderColor: '#0284c7' }}>
              {busy ? 'Verifying passkey...' : <>Join Classroom <ArrowRight size={16} /></>}
            </button>
          </form>

          <div className="auth-modal-footer">
            <div className="student-tip">
              <Sparkles size={14} color="#0284c7" /> Don't have a passkey? Ask your EduAshram teacher to share one with you!
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 2. DEDICATED TEACHER SIGN IN CARD
  // ==========================================
  if (activeMode === 'teacher_login' || activeMode === 'admin') {
    return (
      <div className="word-doc-modal-overlay auth-modal-overlay">
        <div className="auth-modal-card auth-card-teacher" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
          <button className="icon-button quiet modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>

          <div className="auth-modal-header">
            <div className="auth-header-top">
              <div className="auth-modal-brand">
                <span className="brand-mark"><img src="/logo.png" alt="EduAshram" className="brand-logo" /></span>
                <span className="brand-title">EduAshram</span>
              </div>
              <span className="auth-role-badge auth-badge-teacher">
                <LogIn size={13} /> TEACHER WORKSPACE
              </span>
            </div>

            <h2>Teacher Sign In</h2>
            <p className="auth-subtext" style={{ marginBottom: 0, fontSize: '13.5px', color: '#64748b' }}>
              Sign in to access your personal classroom, student list, quiz generator, and question papers.
            </p>
          </div>

          <form onSubmit={handleTeacherLogin} className="form-stack auth-form">
            <label className="field">
              <span>Email Address</span>
              <input
                autoFocus
                required
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="teacher@school.com"
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                required
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </label>

            {error && <div className="inline-error">{error}</div>}

            <button className="button button-primary button-wide" type="submit" disabled={busy}>
              {busy ? 'Signing in...' : <>Sign In to Dashboard <ArrowRight size={16} /></>}
            </button>

            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <span style={{ fontSize: '13px', color: '#64748b' }}>
                New teacher?{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#7c3aed', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  onClick={() => handleSwitch('teacher_signup')}
                >
                  Apply for teacher account
                </button>
              </span>
            </div>
          </form>

          <div className="auth-modal-footer">
            <div className="secure-note">
              <ShieldCheck size={14} color="#059669" /> Encrypted teacher session · Isolated classroom workspace
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 3. DEDICATED TEACHER SIGN UP CARD
  // ==========================================
  return (
    <div className="word-doc-modal-overlay auth-modal-overlay">
      <div className="auth-modal-card auth-card-signup" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
        <button className="icon-button quiet modal-close-btn" onClick={onClose} aria-label="Close modal">
          <X size={18} />
        </button>

        <div className="auth-modal-header">
          <div className="auth-header-top">
            <div className="auth-modal-brand">
              <span className="brand-mark"><img src="/logo.png" alt="EduAshram" className="brand-logo" /></span>
              <span className="brand-title">EduAshram</span>
            </div>
            <span className="auth-role-badge auth-badge-signup">
              <UserPlus size={13} /> TEACHER REGISTRATION
            </span>
          </div>

          <h2>Create Teacher Account</h2>
          <p className="auth-subtext" style={{ marginBottom: 0, fontSize: '13.5px', color: '#64748b' }}>
            Register as a teacher on EduAshram. Once approved by the administrator, you will have your own isolated teaching workspace.
          </p>
        </div>

        {successMsg ? (
          <div style={{ padding: '24px 20px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '16px', textAlign: 'center', margin: '14px 0' }}>
            <CheckCircle2 size={46} color="#16a34a" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ margin: '0 0 8px', color: '#166534', fontSize: '18px' }}>Application Submitted!</h3>
            <p style={{ margin: '0 0 18px', fontSize: '13.5px', color: '#15803d', lineHeight: 1.5 }}>
              {successMsg}
            </p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => handleSwitch('teacher_login')}
            >
              Go to Teacher Sign In <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <form onSubmit={handleTeacherSignup} className="form-stack auth-form">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label className="field">
                <span>Full Name *</span>
                <input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                />
              </label>
              <label className="field">
                <span>Email Address *</span>
                <input
                  required
                  type="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="priya@school.com"
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label className="field">
                <span>School / Institution</span>
                <div className="input-with-icon">
                  <Building size={16} />
                  <input
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    placeholder="e.g. DPS / St. Xavier's"
                  />
                </div>
              </label>
              <label className="field">
                <span>Primary Subject</span>
                <div className="input-with-icon">
                  <BookOpen size={16} />
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '52px',
                      height: '52px',
                      paddingLeft: '48px',
                      paddingRight: '16px',
                      fontSize: '16px',
                      fontWeight: 600,
                      borderRadius: '12px',
                      border: '2px solid #cbd5e1',
                      backgroundColor: '#fff',
                      color: '#0f172a',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="Mathematics">Mathematics</option>
                    <option value="Science">Science</option>
                    <option value="Physics">Physics</option>
                    <option value="Chemistry">Chemistry</option>
                    <option value="Biology">Biology</option>
                    <option value="English">English</option>
                    <option value="Social Science">Social Science</option>
                    <option value="Computer Science">Computer Science</option>
                  </select>
                </div>
              </label>
            </div>

            <label className="field">
              <span>Contact Phone (Optional)</span>
              <div className="input-with-icon">
                <Phone size={16} />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </div>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label className="field">
                <span>Password *</span>
                <input
                  required
                  type="password"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="Min 6 characters"
                />
              </label>
              <label className="field">
                <span>Confirm Password *</span>
                <input
                  required
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-type password"
                />
              </label>
            </div>

            <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#64748b', lineHeight: 1.45 }}>
              <ShieldCheck size={14} color="#059669" style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '5px' }} />
              New teacher profiles undergo Super Admin review. You will manage your own unique kids, quizzes, and personal API key once approved.
            </div>

            {error && <div className="inline-error">{error}</div>}

            <button className="button button-primary button-wide" type="submit" disabled={busy} style={{ background: '#7c3aed', borderColor: '#7c3aed' }}>
              {busy ? 'Submitting Application...' : <>Submit Teacher Application <ArrowRight size={16} /></>}
            </button>

            <div style={{ textAlign: 'center', marginTop: '6px' }}>
              <span style={{ fontSize: '13px', color: '#64748b' }}>
                Already have an approved account?{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#047857', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  onClick={() => handleSwitch('teacher_login')}
                >
                  Sign in here
                </button>
              </span>
            </div>
          </form>
        )}

        <div className="auth-modal-footer" style={{ marginTop: '8px' }}>
          <div className="secure-note" style={{ marginTop: 0 }}>
            <ShieldCheck size={14} color="#7c3aed" /> Protected Registration · Multi-tenant workspace isolation
          </div>
        </div>
      </div>
    </div>
  );
}
