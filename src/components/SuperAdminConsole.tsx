import React, { useEffect, useState } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  CheckCircle2,
  Search,
  BookOpen,
  ArrowRight,
  LogOut,
  ExternalLink,
  Trash2,
  Clock,
  Building,
  GraduationCap,
  RefreshCw,
  Eye,
  EyeOff
} from 'lucide-react';
import { TeacherStudyMaterials } from './TeacherStudyMaterials';

interface TeacherItem {
  id: string;
  name: string;
  email: string;
  school: string | null;
  subject: string | null;
  phone: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count: {
    students: number;
    quizzes: number;
    worksheetPapers: number;
  };
}

interface SuperAdminUser {
  id: string;
  role: 'superadmin';
  username: string;
  email: string;
}

interface SuperAdminConsoleProps {
  currentUser: any;
  onSignOut: () => void;
  onBackToPortal: () => void;
}

export function SuperAdminConsole({ currentUser, onSignOut, onBackToPortal }: SuperAdminConsoleProps) {
  const [adminUser, setAdminUser] = useState<SuperAdminUser | null>(
    currentUser?.role === 'superadmin' ? currentUser : null
  );

  // Login Form States (if not logged in as superadmin)
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginSecretKey, setLoginSecretKey] = useState('');
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Dashboard States
  const [activeTab, setActiveTab] = useState<'teachers' | 'study_materials'>('teachers');
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PENDING'>('ALL');
  const [actionNotice, setActionNotice] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Check auth session on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json());
        if (res.user?.role === 'superadmin') {
          setAdminUser(res.user);
        }
      } catch {
        // Not authenticated as superadmin
      }
    }
    if (!adminUser) {
      void checkAuth();
    }
  }, [adminUser]);

  // Fetch teachers when logged in
  async function loadTeachers() {
    setLoadingTeachers(true);
    try {
      const res = await fetch('/api/superadmin/teachers', { credentials: 'same-origin' });
      const data = await res.json();
      if (res.ok && data.teachers) {
        setTeachers(data.teachers);
      } else {
        throw new Error(data.error || 'Failed to load teachers.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTeachers(false);
    }
  }

  useEffect(() => {
    if (adminUser) {
      void loadTeachers();
    }
  }, [adminUser]);

  // Handle Super Admin Login
  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/superadmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
          secretKey: loginSecretKey.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Super Admin authentication failed.');
      }

      setAdminUser(data.user);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Invalid Super Admin credentials or Secret Key.');
    } finally {
      setLoginBusy(false);
    }
  }

  // Toggle teacher active status (Enable / Disable)
  async function toggleTeacherStatus(teacherId: string, currentActive: boolean) {
    setTogglingId(teacherId);
    try {
      const res = await fetch(`/api/superadmin/teachers/${teacherId}/toggle-status`, {
        method: 'PATCH',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status.');

      setTeachers((prev) =>
        prev.map((t) => (t.id === teacherId ? { ...t, active: !currentActive } : t))
      );
      setActionNotice(`✓ Teacher account has been ${!currentActive ? 'activated & approved' : 'disabled'}.`);
      setTimeout(() => setActionNotice(''), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update teacher status.');
    } finally {
      setTogglingId(null);
    }
  }

  // Delete Teacher
  async function deleteTeacher(teacher: TeacherItem) {
    if (!window.confirm(`Are you sure you want to delete teacher "${teacher.name}" (${teacher.email})? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/superadmin/teachers/${teacher.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('Failed to delete teacher.');

      setTeachers((prev) => prev.filter((t) => t.id !== teacher.id));
      setActionNotice(`✓ Teacher account "${teacher.name}" was removed.`);
      setTimeout(() => setActionNotice(''), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete teacher.');
    }
  }

  // Filter teachers
  const filteredTeachers = teachers.filter((t) => {
    if (statusFilter === 'ACTIVE' && !t.active) return false;
    if (statusFilter === 'PENDING' && t.active) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        t.name.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        (t.school && t.school.toLowerCase().includes(q)) ||
        (t.subject && t.subject.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const totalTeachers = teachers.length;
  const activeCount = teachers.filter((t) => t.active).length;
  const pendingCount = teachers.filter((t) => !t.active).length;
  const totalStudents = teachers.reduce((acc, t) => acc + (t._count?.students || 0), 0);

  // -------------------------------------------------------------
  // VIEW A: SUPER ADMIN LOGIN (If unauthenticated)
  // -------------------------------------------------------------
  if (!adminUser) {
    return (
      <div className="superadmin-login-screen" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse at top, #1e1b4b, #0f172a 80%)', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '440px', background: '#ffffff', borderRadius: '18px', padding: '36px 32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', marginBottom: '14px', boxShadow: '0 8px 16px -4px rgba(99, 102, 241, 0.5)' }}>
              <Shield size={30} />
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>Master Admin Console</h1>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
              Authorized Platform Owner Access for <strong>EduAshram</strong>
            </p>
          </div>

          <form onSubmit={handleAdminLogin} className="form-stack">
            <label className="field">
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>Admin Username or Email</span>
              <input
                autoFocus
                required
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="e.g. admin or gaurav.kr.singh@hotmail.com"
                style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
              />
            </label>

            <label className="field">
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>Master Password</span>
              <input
                required
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter admin password"
                style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
              />
            </label>

            <label className="field">
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>Secret Admin Key</span>
              <div style={{ position: 'relative' }}>
                <input
                  required
                  type={showSecretKey ? 'text' : 'password'}
                  value={loginSecretKey}
                  onChange={(e) => setLoginSecretKey(e.target.value)}
                  placeholder="Enter your secret key"
                  style={{ width: '100%', padding: '10px 40px 10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                />
                <button
                  type="button"
                  onClick={() => setShowSecretKey(!showSecretKey)}
                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '4px' }}
                >
                  {showSecretKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <small style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                Protected key known only to the platform owner.
              </small>
            </label>

            {loginError && (
              <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={16} />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loginBusy}
              className="button button-primary"
              style={{ width: '100%', padding: '12px', fontSize: '14px', fontWeight: 700, borderRadius: '8px', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', border: 'none', color: '#ffffff', marginTop: '6px', cursor: 'pointer' }}
            >
              {loginBusy ? 'Authenticating...' : <>Authenticate as Super Admin <ArrowRight size={16} /></>}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
            <button
              type="button"
              onClick={onBackToPortal}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              ← Back to EduAshram Public Portal
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW B: SUPER ADMIN DASHBOARD
  // -------------------------------------------------------------
  return (
    <div className="superadmin-console-root" style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a' }}>
      {/* Top Navbar */}
      <header style={{ background: '#0f172a', color: '#ffffff', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366f1, #a855f7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={20} color="#ffffff" />
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.01em' }}>EduAshram Admin Console</span>
              <span style={{ fontSize: '11px', fontWeight: 700, background: '#3b82f6', color: '#ffffff', padding: '2px 8px', borderRadius: '9999px' }}>SUPER ADMIN</span>
            </div>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>Logged in as: {adminUser.username} ({adminUser.email})</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="button button-secondary"
            onClick={onBackToPortal}
            style={{ fontSize: '13px', padding: '6px 14px', borderRadius: '8px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' }}
          >
            <ExternalLink size={14} /> Public Portal
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setAdminUser(null);
              onSignOut();
            }}
            style={{ fontSize: '13px', padding: '6px 14px', borderRadius: '8px', background: '#1e293b', color: '#f87171', border: '1px solid #334155' }}
          >
            <LogOut size={14} /> Logout
          </button>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '0 28px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('teachers')}
            style={{
              padding: '16px 20px',
              border: 'none',
              borderBottom: activeTab === 'teachers' ? '3px solid #6366f1' : '3px solid transparent',
              background: 'transparent',
              fontSize: '14px',
              fontWeight: activeTab === 'teachers' ? 700 : 500,
              color: activeTab === 'teachers' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Users size={17} /> Teachers & Access Management
            {pendingCount > 0 && (
              <span style={{ background: '#f59e0b', color: '#ffffff', fontSize: '11px', fontWeight: 800, padding: '2px 7px', borderRadius: '9999px' }}>
                {pendingCount} Pending
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('study_materials')}
            style={{
              padding: '16px 20px',
              border: 'none',
              borderBottom: activeTab === 'study_materials' ? '3px solid #6366f1' : '3px solid transparent',
              background: 'transparent',
              fontSize: '14px',
              fontWeight: activeTab === 'study_materials' ? 700 : 500,
              color: activeTab === 'study_materials' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <BookOpen size={17} /> Public Study Materials & Worksheets Control
          </button>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionNotice && (
        <div style={{ margin: '16px 28px 0', padding: '12px 18px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', color: '#065f46', fontSize: '13.5px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={18} />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* TAB 1: TEACHERS MANAGEMENT */}
      {activeTab === 'teachers' && (
        <div style={{ padding: '28px', maxWidth: '1400px', margin: '0 auto' }}>
          {/* Metrics Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>Total Teachers</span>
                <span style={{ padding: '8px', background: '#ede9fe', borderRadius: '10px', color: '#7c3aed' }}><Users size={18} /></span>
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginTop: '10px' }}>{totalTeachers}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>All registered teacher accounts</div>
            </div>

            <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>Active / Approved</span>
                <span style={{ padding: '8px', background: '#dcfce7', borderRadius: '10px', color: '#16a34a' }}><CheckCircle2 size={18} /></span>
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#16a34a', marginTop: '10px' }}>{activeCount}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Currently authorized to teach</div>
            </div>

            <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>Pending Review</span>
                <span style={{ padding: '8px', background: '#fef3c7', borderRadius: '10px', color: '#d97706' }}><Clock size={18} /></span>
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#d97706', marginTop: '10px' }}>{pendingCount}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Awaiting Super Admin activation</div>
            </div>

            <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>Students Enrolled</span>
                <span style={{ padding: '8px', background: '#e0f2fe', borderRadius: '10px', color: '#0284c7' }}><GraduationCap size={18} /></span>
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#0284c7', marginTop: '10px' }}>{totalStudents}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Across all teacher classrooms</div>
            </div>
          </div>

          {/* Search, Filter & Reload Bar */}
          <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 300px' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by teacher name, email, school, subject..."
                  style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: statusFilter === 'ALL' ? '#6366f1' : '#e2e8f0',
                    background: statusFilter === 'ALL' ? '#ede9fe' : '#ffffff',
                    color: statusFilter === 'ALL' ? '#6366f1' : '#64748b',
                    fontSize: '12.5px',
                    fontWeight: statusFilter === 'ALL' ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  All ({totalTeachers})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('ACTIVE')}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: statusFilter === 'ACTIVE' ? '#16a34a' : '#e2e8f0',
                    background: statusFilter === 'ACTIVE' ? '#dcfce7' : '#ffffff',
                    color: statusFilter === 'ACTIVE' ? '#16a34a' : '#64748b',
                    fontSize: '12.5px',
                    fontWeight: statusFilter === 'ACTIVE' ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  Active ({activeCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('PENDING')}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: statusFilter === 'PENDING' ? '#d97706' : '#e2e8f0',
                    background: statusFilter === 'PENDING' ? '#fef3c7' : '#ffffff',
                    color: statusFilter === 'PENDING' ? '#d97706' : '#64748b',
                    fontSize: '12.5px',
                    fontWeight: statusFilter === 'PENDING' ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  Pending ({pendingCount})
                </button>
              </div>
            </div>

            <button
              type="button"
              className="button button-secondary"
              onClick={loadTeachers}
              disabled={loadingTeachers}
              style={{ padding: '8px 14px', fontSize: '13px' }}
            >
              <RefreshCw size={14} className={loadingTeachers ? 'spin' : ''} /> Refresh List
            </button>
          </div>

          {/* Teachers Table */}
          <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {loadingTeachers ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px' }} />
                <p>Loading teachers directory...</p>
              </div>
            ) : filteredTeachers.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
                <Users size={36} color="#cbd5e1" style={{ margin: '0 auto 12px' }} />
                <h3 style={{ margin: '0 0 6px', color: '#1e293b' }}>No Teachers Found</h3>
                <p style={{ margin: 0, fontSize: '13.5px' }}>
                  {searchQuery ? `No teachers match "${searchQuery}".` : 'No registered teachers under this filter.'}
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '14px 18px' }}>Teacher Details</th>
                      <th style={{ padding: '14px 18px' }}>School & Subject</th>
                      <th style={{ padding: '14px 18px' }}>Status</th>
                      <th style={{ padding: '14px 18px' }}>Classroom Stats</th>
                      <th style={{ padding: '14px 18px' }}>Joined Date</th>
                      <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTeachers.map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}>
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{t.name}</div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>{t.email}</div>
                          {t.phone && <div style={{ fontSize: '11px', color: '#94a3b8' }}>📞 {t.phone}</div>}
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Building size={14} color="#64748b" />
                            <span>{t.school || 'EduAshram Partner'}</span>
                          </div>
                          <div style={{ fontSize: '12px', color: '#4f46e5', fontWeight: 600, marginTop: '2px' }}>
                            {t.subject || 'All Subjects'}
                          </div>
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          {t.active ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#dcfce7', color: '#15803d', fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '9999px', border: '1px solid #bbf7d0' }}>
                              <CheckCircle2 size={13} /> Active & Enabled
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fef3c7', color: '#b45309', fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '9999px', border: '1px solid #fde68a' }}>
                              <Clock size={13} /> Pending / Disabled
                            </span>
                          )}
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '12.5px', color: '#475569' }}>
                            <span><strong>{t._count?.students || 0}</strong> Kids</span>
                            <span><strong>{t._count?.quizzes || 0}</strong> Quizzes</span>
                            <span><strong>{t._count?.worksheetPapers || 0}</strong> Papers</span>
                          </div>
                        </td>

                        <td style={{ padding: '14px 18px', fontSize: '12.5px', color: '#64748b' }}>
                          {new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>

                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => toggleTeacherStatus(t.id, t.active)}
                              disabled={togglingId === t.id}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '8px',
                                border: '1px solid',
                                borderColor: t.active ? '#fca5a5' : '#86efac',
                                background: t.active ? '#fef2f2' : '#f0fdf4',
                                color: t.active ? '#dc2626' : '#16a34a',
                                fontSize: '12px',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {togglingId === t.id
                                ? 'Updating...'
                                : t.active
                                ? 'Disable Access'
                                : 'Approve & Enable'}
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteTeacher(t)}
                              title="Delete Teacher"
                              style={{
                                padding: '6px 8px',
                                borderRadius: '8px',
                                border: '1px solid #e2e8f0',
                                background: '#ffffff',
                                color: '#94a3b8',
                                cursor: 'pointer',
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: STUDY MATERIALS & PUBLIC WORKSHEETS CONTROL */}
      {activeTab === 'study_materials' && (
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px', color: '#1e40af', fontSize: '13.5px' }}>
            <ShieldCheck size={20} color="#2563eb" />
            <span>
              <strong>Master Portal Control:</strong> Only you (Super Admin) can publish, modify, or delete study materials and worksheets appearing on the public portal (<strong>eduashram.in</strong>). Regular teachers only manage their private student classrooms.
            </span>
          </div>

          {/* Embed the Study Materials Management console */}
          <TeacherStudyMaterials setNotice={setActionNotice} />
        </div>
      )}
    </div>
  );
}
