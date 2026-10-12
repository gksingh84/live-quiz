import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  BookOpen,
  Video,
  FileText,
  Presentation,
  Image as ImageIcon,
  Search,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Eye,
  Clock,
  Printer,
  X,
  LogIn,
  GraduationCap,
  Layers,
  ChevronRight,
  ExternalLink,
  Share2,
} from 'lucide-react';
import {
  type StudyMaterial,
  STANDARD_GRADES,
  STANDARD_SUBJECTS,
  GRADE_DETAILS,
} from '../types/studyMaterial';

interface PublicPortalProps {
  user: { role: 'admin' | 'student'; name?: string; email?: string } | null;
  onOpenLogin: (mode: 'student' | 'admin') => void;
  onGoToDashboard: () => void;
  onSignOut: () => void;
}

export function PublicPortal({
  user,
  onOpenLogin,
  onGoToDashboard,
  onSignOut,
}: PublicPortalProps) {
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGrade, setActiveGrade] = useState<string>('ALL'); // 'ALL' or 'Grade 4'..'Grade 10'
  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');
  const [selectedMediaType, setSelectedMediaType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState<StudyMaterial | null>(null);
  const [gradeSummary, setGradeSummary] = useState<Record<string, number>>({});
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Scroll progress for top indicator
  useEffect(() => {
    const handleScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        setScrollProgress(Math.min(100, Math.max(0, (window.scrollY / docHeight) * 100)));
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // IntersectionObserver for vertical scroll-triggered reveal animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -25px 0px' }
    );

    const elements = document.querySelectorAll('.reveal-on-scroll');
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [materials, activeGrade, selectedSubject, selectedMediaType, searchQuery, loading]);

  // Fetch materials and grade counts
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [matRes, sumRes] = await Promise.all([
          fetch('/api/public/study-materials').then((r) => r.json()),
          fetch('/api/public/grades-summary').then((r) => r.json()),
        ]);
        if (matRes.materials) setMaterials(matRes.materials);
        if (sumRes.grades) setGradeSummary(sumRes.grades);
      } catch (err) {
        console.error('Failed to load study materials:', err);
      } finally {
        setLoading(false);
      }
    }
    void fetchData();
  }, []);

  // Close suggestions dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered materials
  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      if (activeGrade !== 'ALL' && m.grade !== activeGrade) return false;
      if (selectedSubject !== 'ALL' && m.subject !== selectedSubject) return false;
      if (selectedMediaType !== 'ALL' && m.mediaType !== selectedMediaType) return false;
      if (searchQuery.trim()) {
        const terms = searchQuery.toLowerCase().trim().split(/\s+/);
        const searchable = `${m.title} ${m.description || ''} ${m.subject} ${m.grade}`.toLowerCase();
        if (!terms.every((t) => searchable.includes(t))) return false;
      }
      return true;
    });
  }, [materials, activeGrade, selectedSubject, selectedMediaType, searchQuery]);

  // Instant live search suggestions (top 5 matches)
  const searchSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const terms = searchQuery.toLowerCase().trim().split(/\s+/);
    return materials
      .filter((m) => {
        const searchable = `${m.title} ${m.description || ''} ${m.subject} ${m.grade}`.toLowerCase();
        return terms.every((t) => searchable.includes(t));
      })
      .slice(0, 5);
  }, [materials, searchQuery]);

  // Handle Search Submission (Enter or click Search button)
  function handleSearchSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setDropdownOpen(false);
    if (!searchQuery.trim()) return;

    // If activeGrade is filtering out all matches, reset to ALL
    const terms = searchQuery.toLowerCase().trim().split(/\s+/);
    const hasInCurrent = materials.some(
      (m) =>
        (activeGrade === 'ALL' || m.grade === activeGrade) &&
        terms.every((t) => `${m.title} ${m.description || ''} ${m.subject} ${m.grade}`.toLowerCase().includes(t))
    );
    if (!hasInCurrent && activeGrade !== 'ALL') {
      setActiveGrade('ALL');
    }

    setTimeout(() => {
      const feed = document.getElementById('materials-feed');
      if (feed) {
        feed.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  }

  // Relevant subjects (standard curriculum + dynamic from materials)
  const availableSubjects = useMemo(() => {
    const set = new Set<string>(STANDARD_SUBJECTS);
    materials.forEach((m) => {
      if (m.subject) set.add(m.subject);
    });
    return Array.from(set);
  }, [materials]);

  // Fetch single material on modal click to increment views and get full content
  async function openMaterial(item: StudyMaterial) {
    try {
      const res = await fetch(`/api/public/study-materials/${item.id}`).then((r) => r.json());
      if (res.material) {
        setSelectedMaterial(res.material);
        // update views in local state
        setMaterials((prev) =>
          prev.map((m) => (m.id === item.id ? { ...m, views: m.views + 1 } : m))
        );
      } else {
        setSelectedMaterial(item);
      }
    } catch {
      setSelectedMaterial(item);
    }
  }

  function handleShare(item: StudyMaterial) {
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(`${item.title} - Read on Maths Mentor: ${url}`);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  }

  return (
    <div className="public-portal-root">
      {/* 1. TOP NAVIGATION BAR */}
      <header className="public-navbar">
        {/* Dynamic Top Scroll Progress Indicator */}
        <div className="navbar-scroll-track" aria-hidden="true">
          <div className="navbar-scroll-progress" style={{ width: `${scrollProgress}%` }} />
        </div>

        <div className="navbar-container">
          <div className="navbar-left" onClick={() => setActiveGrade('ALL')} style={{ cursor: 'pointer' }}>
            <span className="brand-mark">
              <img src="/logo.png" alt="Maths Mentor" className="brand-logo" />
            </span>
            <span className="brand-name">Maths Mentor</span>
          </div>

          <nav className="navbar-links">
            <button
              className={`nav-link-btn ${activeGrade === 'ALL' ? 'active' : ''}`}
              onClick={() => { setActiveGrade('ALL'); setSelectedSubject('ALL'); }}
            >
              All Materials
            </button>
            <div className="grade-dropdown-wrapper">
              <span className="nav-dropdown-label">Explore Grade ▾</span>
              <div className="grade-dropdown-menu">
                {STANDARD_GRADES.map((g) => (
                  <button
                    key={g}
                    className={`grade-dropdown-item ${activeGrade === g ? 'active' : ''}`}
                    onClick={() => { setActiveGrade(g); setSelectedSubject('ALL'); }}
                  >
                    <span>{GRADE_DETAILS[g]?.iconEmoji} {g}</span>
                    <span className="grade-count-tag">{gradeSummary[g] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
            <a href="#grade-hubs" className="nav-link-btn" onClick={(e) => {
              if (activeGrade !== 'ALL') {
                e.preventDefault();
                setActiveGrade('ALL');
                setTimeout(() => document.getElementById('grade-hubs')?.scrollIntoView({ behavior: 'smooth' }), 50);
              }
            }}>
              Grade Hubs
            </a>
          </nav>

          <div className="navbar-actions">
            {user ? (
              <div className="user-nav-box">
                <span className="user-role-badge">
                  {user.role === 'admin' ? 'Teacher' : 'Student'}: {user.name || user.email?.split('@')[0]}
                </span>
                <button className="button button-primary nav-action-btn" onClick={onGoToDashboard}>
                  Go to Dashboard <ArrowRight size={14} />
                </button>
                <button className="button button-secondary nav-action-btn" onClick={onSignOut} title="Sign Out">
                  Logout
                </button>
              </div>
            ) : (
              <div className="auth-buttons-group">
                <button
                  id="btn-student-login-nav"
                  className="button button-secondary auth-btn student-auth-btn"
                  onClick={() => onOpenLogin('student')}
                >
                  <GraduationCap size={16} /> Student Passkey
                </button>
                <button
                  id="btn-teacher-login-nav"
                  className="button button-primary auth-btn teacher-auth-btn"
                  onClick={() => onOpenLogin('admin')}
                >
                  <LogIn size={15} /> Teacher Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. ACTIVE VIEW: DEDICATED GRADE HUB or MAIN PORTAL HERO */}
      {activeGrade !== 'ALL' ? (
        <section className="dedicated-grade-banner reveal-on-scroll is-revealed">
          <div className="portal-container">
            <button className="back-to-all-btn" onClick={() => setActiveGrade('ALL')}>
              <ArrowLeft size={16} /> Back to All Grades
            </button>
            <div className="grade-banner-header">
              <span className="grade-banner-icon">{GRADE_DETAILS[activeGrade]?.iconEmoji}</span>
              <div>
                <span className="banner-eyebrow">DEDICATED REVISION HUB</span>
                <h1>{activeGrade} Learning & Study Hub</h1>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="portal-hero">

          <div className="portal-container hero-inner">
            <div className="hero-eyebrow reveal-on-scroll">
              <Sparkles size={16} className="sparkle-icon" />
              <span>FREE COMPREHENSIVE LEARNING PORTAL · GRADES 4 TO 10</span>
            </div>
            <h1 className="hero-title reveal-on-scroll">
              Understand Concepts.<br />
              Master Every <span className="hero-gradient-text">Concept.</span>
            </h1>
            <p className="hero-subtitle reveal-on-scroll">
              High-quality study material for students from Grade 4 to Grade 10. Free access for everyone.
            </p>

            {/* Kids-friendly Sticker Highlights */}
            <div className="hero-stickers-row reveal-on-scroll">
              <span className="hero-sticker sticker-mint">✨ Fun & Clear Notes</span>
              <span className="hero-sticker sticker-amber">📐 Step-by-Step Formulas</span>
              <span className="hero-sticker sticker-purple">🎯 Practice Quizzes</span>
              <span className="hero-sticker sticker-sky">🚀 100% Free for Kids</span>
            </div>

            {/* Interactive Search Bar */}
            <div className="hero-search-wrapper reveal-on-scroll" ref={searchContainerRef}>
              <form className="search-bar-box" onSubmit={handleSearchSubmit}>
                <Search size={20} className="search-icon" />
                <input
                  id="hero-study-search-input"
                  type="text"
                  placeholder="Search any chapter, topic, or formula (e.g., Fractions, Integers, Trigonometry)..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setDropdownOpen(true);
                  }}
                  onFocus={() => {
                    if (searchQuery.trim()) setDropdownOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSearchSubmit();
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="clear-search-btn"
                    onClick={() => {
                      setSearchQuery('');
                      setDropdownOpen(false);
                    }}
                    title="Clear search"
                  >
                    <X size={16} />
                  </button>
                )}
              </form>

              {/* Instant Live Dropdown */}
              {dropdownOpen && searchQuery.trim() && (
                <div className="search-suggestions-dropdown">
                  <div className="suggestions-header">
                    <span>Quick Results ({searchSuggestions.length})</span>
                    <span>Press Enter to view all</span>
                  </div>
                  {searchSuggestions.length > 0 ? (
                    <div className="suggestions-list">
                      {searchSuggestions.map((item) => (
                        <div
                          key={item.id}
                          className="suggestion-item"
                          onClick={() => {
                            setDropdownOpen(false);
                            void openMaterial(item);
                          }}
                        >
                          <div className="suggestion-left">
                            <span className="suggestion-icon">
                              {item.mediaType === 'VIDEO' ? (
                                <Video size={15} />
                              ) : item.mediaType === 'PRESENTATION' ? (
                                <Presentation size={15} />
                              ) : item.mediaType === 'IMAGE' ? (
                                <ImageIcon size={15} />
                              ) : (
                                <FileText size={15} />
                              )}
                            </span>
                            <span className="suggestion-title">{item.title}</span>
                          </div>
                          <div className="suggestion-meta">
                            <span className="suggestion-grade-badge">{item.grade}</span>
                            <span className="suggestion-subject-badge">{item.subject}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="no-suggestions-box">
                      No matching materials found for "<strong>{searchQuery}</strong>".
                    </div>
                  )}
                  <div className="suggestions-footer">
                    <button
                      type="button"
                      className="view-all-results-btn"
                      onClick={() => handleSearchSubmit()}
                    >
                      View all {filteredMaterials.length} matching resources in feed <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Grade Filter Badges */}
            <div className="hero-grade-chips reveal-on-scroll">
              <span className="chips-title">Jump to Class:</span>
              {STANDARD_GRADES.map((g) => (
                <button
                  key={g}
                  className={`hero-grade-chip ${(activeGrade as string) === g ? 'active' : ''} grade-chip-${g.replace(/\s+/g, '').toLowerCase()}`}
                  onClick={() => setActiveGrade(g)}
                >
                  <span>{GRADE_DETAILS[g]?.iconEmoji}</span> {g}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 3. GRADE EXPLORER SECTION (Visible when activeGrade === 'ALL') */}
      {activeGrade === 'ALL' && (
        <section id="grade-hubs" className="portal-section grade-hubs-section">
          <div className="portal-container">
            <div className="section-header-block reveal-on-scroll">
              <div>
                <span className="section-kicker">CHOOSE YOUR CLASS</span>
                <h2>Explore Grade Hubs (Grade 4 to 10)</h2>
              </div>
            </div>

            <div className="grade-cards-grid">
              {STANDARD_GRADES.map((grade, idx) => {
                const info = GRADE_DETAILS[grade];
                const count = gradeSummary[grade] ?? 0;
                const recentItems = materials.filter((m) => m.grade === grade).slice(0, 3);
                return (
                  <div
                    key={grade}
                    className={`grade-hub-card reveal-on-scroll grade-card-${grade.replace(/\s+/g, '').toLowerCase()}`}
                    onClick={() => setActiveGrade(grade)}
                    style={{
                      '--accent-color': info?.color || '#0284c7',
                      '--stagger-index': idx,
                    } as React.CSSProperties}
                  >
                    <div className="grade-hub-top">
                      <span className="grade-emoji">{info?.iconEmoji}</span>
                      <span className="material-count-pill">{count} Resource{count === 1 ? '' : 's'}</span>
                    </div>
                    <h3 className="grade-card-title">{grade}</h3>
                    <div className="grade-card-topics">
                      {recentItems.length > 0 ? (
                        recentItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="topic-pill grade-content-pill"
                            title={`${item.title} (${item.subject})`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openMaterial(item);
                            }}
                          >
                            <span className="pill-media-icon">
                              {item.mediaType === 'VIDEO' ? (
                                <Video size={13} />
                              ) : item.mediaType === 'PRESENTATION' ? (
                                <Presentation size={13} />
                              ) : item.mediaType === 'IMAGE' ? (
                                <ImageIcon size={13} />
                              ) : (
                                <FileText size={13} />
                              )}
                            </span>
                            <span className="pill-text">{item.title}</span>
                          </button>
                        ))
                      ) : (
                        <div className="no-recent-content">
                          <span>No articles uploaded yet</span>
                        </div>
                      )}
                    </div>
                    <div className="grade-card-footer">
                      <span className="enter-hub-text">
                        Open Hub <ChevronRight size={15} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 4. MAIN STUDY MATERIAL BLOG & RESOURCE FEED */}
      <section className="portal-section materials-feed-section" id="materials-feed">
        <div className="portal-container">
          {/* Controls Bar: Grade, Subject, Media Type filters */}
          <div className="feed-controls-bar reveal-on-scroll">
            <div className="filter-group">
              <span className="filter-label">Grade:</span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${activeGrade === 'ALL' ? 'active' : ''}`}
                  onClick={() => setActiveGrade('ALL')}
                >
                  All Grades
                </button>
                {STANDARD_GRADES.map((g) => (
                  <button
                    key={g}
                    className={`filter-pill ${activeGrade === g ? 'active' : ''} grade-chip-${g.replace(/\s+/g, '').toLowerCase()}`}
                    onClick={() => setActiveGrade(g)}
                  >
                    <span>{GRADE_DETAILS[g]?.iconEmoji}</span> {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Subject filters */}
            <div className="filter-group">
              <span className="filter-label">Subject:</span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${selectedSubject === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSelectedSubject('ALL')}
                >
                  All Subjects
                </button>
                {availableSubjects.map((s) => (
                  <button
                    key={s}
                    className={`filter-pill ${selectedSubject === s ? 'active' : ''}`}
                    onClick={() => setSelectedSubject(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Media type format filter */}
            <div className="filter-group">
              <span className="filter-label">Format:</span>
              <div className="filter-pills">
                <button
                  className={`filter-pill ${selectedMediaType === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSelectedMediaType('ALL')}
                >
                  All Types
                </button>
                <button
                  className={`filter-pill ${selectedMediaType === 'ARTICLE' ? 'active' : ''}`}
                  onClick={() => setSelectedMediaType('ARTICLE')}
                >
                  📖 Articles & Notes
                </button>
                <button
                  className={`filter-pill ${selectedMediaType === 'PDF' ? 'active' : ''}`}
                  onClick={() => setSelectedMediaType('PDF')}
                >
                  📄 PDFs
                </button>
                <button
                  className={`filter-pill ${selectedMediaType === 'VIDEO' ? 'active' : ''}`}
                  onClick={() => setSelectedMediaType('VIDEO')}
                >
                  🎥 Video Lessons
                </button>
                <button
                  className={`filter-pill ${selectedMediaType === 'PRESENTATION' ? 'active' : ''}`}
                  onClick={() => setSelectedMediaType('PRESENTATION')}
                >
                  📊 Slides
                </button>
              </div>
            </div>
          </div>

          {/* Results count label */}
          <div className="feed-status-line">
            <span>
              Showing <strong>{filteredMaterials.length}</strong> study resource{filteredMaterials.length === 1 ? '' : 's'}
              {activeGrade !== 'ALL' ? ` for ${activeGrade}` : ''}
              {selectedSubject !== 'ALL' ? ` in ${selectedSubject}` : ''}
              {searchQuery ? ` matching "${searchQuery}"` : ''}
            </span>
            {(activeGrade !== 'ALL' || selectedSubject !== 'ALL' || selectedMediaType !== 'ALL' || searchQuery) && (
              <button
                className="reset-filters-btn"
                onClick={() => {
                  setActiveGrade('ALL');
                  setSelectedSubject('ALL');
                  setSelectedMediaType('ALL');
                  setSearchQuery('');
                }}
              >
                Reset All Filters
              </button>
            )}
          </div>

          {/* Card Grid */}
          {loading ? (
            <div className="portal-loading-box">
              <Sparkles size={24} className="spin" color="#0284c7" />
              <span>Loading curriculum resources...</span>
            </div>
          ) : filteredMaterials.length === 0 ? (
            <div className="portal-empty-box">
              <Layers size={40} color="#94a3b8" />
              <h3>No study materials found</h3>
              <p>Try adjusting your search query or selecting a different Grade or Subject filter.</p>
              <button
                className="button button-secondary"
                onClick={() => {
                  setActiveGrade('ALL');
                  setSelectedSubject('ALL');
                  setSelectedMediaType('ALL');
                  setSearchQuery('');
                }}
              >
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="materials-blog-grid">
              {filteredMaterials.map((item, idx) => (
                <ArticleBlogCard
                  key={item.id}
                  material={item}
                  index={idx}
                  onClick={() => void openMaterial(item)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 5. INTERACTIVE FOOTER */}
      <footer className="portal-footer reveal-on-scroll">
        <div className="portal-container footer-inner">
          <div className="footer-brand">
            <div className="footer-logo">
              <span className="brand-mark"><img src="/logo.png" alt="Maths Mentor" className="brand-logo" /></span>
              <span className="footer-title">Maths Mentor</span>
            </div>
            <p>Empowering students across Grades 4 to 10 with clear concept explanations, guided practice, and continuous learning.</p>
          </div>

          <div className="footer-links-col">
            <h4>Quick Grades</h4>
            <div className="footer-grade-links">
              {STANDARD_GRADES.map((g) => (
                <button key={g} onClick={() => { setActiveGrade(g); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  {g} Hub
                </button>
              ))}
            </div>
          </div>

          <div className="footer-links-col">
            <h4>Classroom Access</h4>
            <div className="footer-action-links">
              <button onClick={() => onOpenLogin('student')}>
                <GraduationCap size={14} /> Student Passkey Login
              </button>
              <button onClick={() => onOpenLogin('admin')}>
                <LogIn size={14} /> Teacher Admin Portal
              </button>
            </div>
          </div>
        </div>
        <div className="footer-bottom-line">
          <span>© {new Date().getFullYear()} Maths Mentor · Learn · Practise · Excel.</span>
        </div>
      </footer>

      {/* 6. IMMERSIVE MATERIAL VIEWER MODAL */}
      {selectedMaterial && (
        <MaterialViewerModal
          material={selectedMaterial}
          onClose={() => setSelectedMaterial(null)}
          onShare={() => handleShare(selectedMaterial)}
          copyFeedback={copyFeedback}
          onOpenQuizLogin={() => {
            setSelectedMaterial(null);
            onOpenLogin('student');
          }}
        />
      )}
    </div>
  );
}

// BLOG ARTICLE CARD COMPONENT
function ArticleBlogCard({
  material,
  onClick,
  index = 0,
}: {
  material: StudyMaterial;
  onClick: () => void;
  index?: number;
}) {
  const [imgError, setImgError] = useState(false);

  const mediaIcon = {
    ARTICLE: <BookOpen size={14} />,
    PDF: <FileText size={14} />,
    VIDEO: <Video size={14} />,
    PRESENTATION: <Presentation size={14} />,
    IMAGE: <ImageIcon size={14} />,
  }[material.mediaType] || <BookOpen size={14} />;

  const mediaLabel = {
    ARTICLE: 'Article / Notes',
    PDF: 'PDF Document',
    VIDEO: 'Video Lesson',
    PRESENTATION: 'Slide Deck',
    IMAGE: 'Infographic',
  }[material.mediaType] || 'Study Material';

  const coverUrl = useMemo(() => {
    if (material.coverImage && !material.coverImage.includes('an_webp')) {
      return material.coverImage;
    }
    if (material.videoUrl) {
      if (material.videoUrl.includes('youtube.com/watch?v=')) {
        const vidId = material.videoUrl.split('v=')[1]?.split('&')[0];
        if (vidId) return `https://img.youtube.com/vi/${vidId}/hqdefault.jpg`;
      } else if (material.videoUrl.includes('youtu.be/')) {
        const vidId = material.videoUrl.split('youtu.be/')[1]?.split('?')[0];
        if (vidId) return `https://img.youtube.com/vi/${vidId}/hqdefault.jpg`;
      }
    }
    return material.coverImage || null;
  }, [material.coverImage, material.videoUrl]);

  return (
    <article
      className="blog-card reveal-on-scroll"
      style={{ '--stagger-index': index % 6 } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="blog-card-cover-wrapper">
        {coverUrl && !imgError ? (
          <img
            src={coverUrl}
            alt={material.title}
            className="blog-card-cover-img"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="blog-card-cover-placeholder">
            <span className="placeholder-icon">{mediaIcon}</span>
          </div>
        )}
        <div className="blog-card-badges-overlay">
          <span className={`media-type-badge media-type-${material.mediaType.toLowerCase()}`}>
            {mediaIcon} {mediaLabel}
          </span>
          <span className="grade-badge-overlay">{material.grade}</span>
        </div>
      </div>

      <div className="blog-card-body">
        <div className="blog-card-meta">
          <span className="meta-subject">{material.subject}</span>
          {material.readTime && (
            <span className="meta-time">
              <Clock size={12} /> {material.readTime}
            </span>
          )}
        </div>

        <h3 className="blog-card-title">{material.title}</h3>
        <p className="blog-card-excerpt">
          {material.description || 'Explore this comprehensive chapter guide and practice problems crafted for your syllabus.'}
        </p>

        <div className="blog-card-footer">
          <div className="blog-author-info">
            <span className="author-avatar">{material.authorName.slice(0, 1)}</span>
            <span className="author-name">{material.authorName}</span>
          </div>
          <div className="card-action-view">
            <span className="views-count"><Eye size={13} /> {material.views}</span>
            <span className="read-more-link">
              Open <ArrowRight size={13} />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

// FULL IMMERSIVE MATERIAL VIEWER MODAL
function MaterialViewerModal({
  material,
  onClose,
  onShare,
  copyFeedback,
  onOpenQuizLogin,
}: {
  material: StudyMaterial;
  onClose: () => void;
  onShare: () => void;
  copyFeedback: boolean;
  onOpenQuizLogin: () => void;
}) {
  // Convert youtube watch url to embed if needed
  const embedVideoUrl = useMemo(() => {
    if (!material.videoUrl) return null;
    let url = material.videoUrl;
    if (url.includes('youtube.com/watch?v=')) {
      const vidId = url.split('v=')[1]?.split('&')[0];
      return `https://www.youtube.com/embed/${vidId}`;
    }
    if (url.includes('youtu.be/')) {
      const vidId = url.split('youtu.be/')[1]?.split('?')[0];
      return `https://www.youtube.com/embed/${vidId}`;
    }
    return url;
  }, [material.videoUrl]);

  function printArticle() {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>${material.title} - Maths Mentor</title><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1e293b; padding: 25mm 20mm; max-width: 800px; margin: 0 auto; }
      h1 { font-size: 24px; color: #0f172a; margin-bottom: 6px; }
      .meta { font-size: 13px; color: #64748b; margin-bottom: 24px; border-bottom: 1px solid #cbd5e1; padding-bottom: 12px; }
      p { margin-bottom: 12px; }
      h2, h3, h4 { color: #0f172a; margin-top: 20px; }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
      blockquote { border-left: 3px solid #0284c7; padding-left: 14px; margin: 14px 0; color: #334155; }
    </style></head><body>
      <h1>${material.title}</h1>
      <div class="meta">${material.grade} · ${material.subject} · Maths Mentor</div>
      <div>${material.content || `<p>${material.description || ''}</p>`}</div>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  return (
    <div className="word-doc-modal-overlay viewer-overlay" onClick={onClose}>
      <div className="material-viewer-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Top Bar */}
        <div className="material-viewer-header">
          <div className="header-meta-tags">
            <span className="viewer-grade-pill">{material.grade}</span>
            <span className="viewer-subject-pill">{material.subject}</span>
            <span className="viewer-type-pill">{material.mediaType}</span>
          </div>

          <div className="header-action-buttons">
            <button className="button button-secondary icon-btn-text" onClick={onShare} title="Share Material">
              <Share2 size={15} /> {copyFeedback ? 'Link Copied!' : 'Share'}
            </button>
            <button className="button button-secondary icon-btn-text" onClick={printArticle} title="Print Notes">
              <Printer size={15} /> Print
            </button>
            <button className="icon-button quiet close-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Content Scroll Area */}
        <div className="material-viewer-body">
          <h1 className="viewer-title">{material.title}</h1>
          <div className="viewer-byline">
            <span>By <strong>{material.authorName}</strong></span>
            <span>•</span>
            <span>Published on {new Date(material.createdAt).toLocaleDateString()}</span>
            {material.readTime && (
              <>
                <span>•</span>
                <span><Clock size={13} /> {material.readTime}</span>
              </>
            )}
            <span>•</span>
            <span><Eye size={13} /> {material.views} views</span>
          </div>

          {/* Media Section: Video / File / Presentation / Image */}
          {material.mediaType === 'VIDEO' && embedVideoUrl && (
            <div className="viewer-video-wrapper">
              <iframe
                src={embedVideoUrl}
                title={material.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="viewer-video-frame"
              />
            </div>
          )}

          {material.fileUrl && (material.mediaType === 'PDF' || material.mediaType === 'PRESENTATION') && (
            <div className="viewer-file-download-box">
              <div className="file-info-col">
                <FileText size={28} color="#0284c7" />
                <div>
                  <strong>{material.fileName || 'Attached Document'}</strong>
                  <span>{material.mediaType === 'PDF' ? 'PDF Document' : 'Presentation Slides'}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={material.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="button button-secondary"
                >
                  <ExternalLink size={14} /> Open in New Tab
                </a>
                <a
                  href={material.fileUrl}
                  download={material.fileName || `${material.title}.pdf`}
                  className="button button-primary"
                >
                  Download File
                </a>
              </div>
            </div>
          )}

          {material.coverImage && material.mediaType === 'IMAGE' && (
            <div className="viewer-image-wrapper">
              <img src={material.coverImage} alt={material.title} className="viewer-main-img" />
            </div>
          )}

          {/* Rich Content Article */}
          {material.content ? (
            <div
              className="viewer-rich-content"
              dangerouslySetInnerHTML={{ __html: material.content }}
            />
          ) : material.description ? (
            <div className="viewer-rich-content">
              <p>{material.description}</p>
            </div>
          ) : null}

          {/* Call to action: Test yourself with a quiz on this grade */}
          <div className="viewer-quiz-cta-box">
            <div className="cta-icon-box">
              <GraduationCap size={24} color="#0284c7" />
            </div>
            <div className="cta-text-col">
              <h4>Ready to test your understanding?</h4>
              <p>Practice with interactive live classroom rounds and timed quizzes for {material.grade}.</p>
            </div>
            <button className="button button-primary cta-btn" onClick={onOpenQuizLogin}>
              Join Quiz with Passkey <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
