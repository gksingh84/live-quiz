import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Bell,
  BookOpenCheck,
  FileText,
  Sparkles,
  CalendarDays,
  X,
  Trash2,
  Edit2,
  Filter,
  AlertCircle,
  AlignLeft,
  CalendarCheck
} from 'lucide-react';

export interface CalendarEventItem {
  id: string;
  teacherId: string;
  title: string;
  description: string | null;
  date: string; // YYYY-MM-DD
  time: string | null;
  type: 'event' | 'reminder' | 'quiz' | 'test' | 'assignment' | 'holiday';
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClassroomCalendarProps {
  user: {
    id?: string;
    role: 'admin' | 'teacher' | 'superadmin' | 'student';
    name?: string;
    teacherId?: string | null;
    teacherName?: string | null;
  };
  readOnly?: boolean;
}

export const EVENT_TYPES: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  event: { label: 'Event', color: '#0284c7', bg: '#e0f2fe', icon: CalendarDays },
  reminder: { label: 'Reminder', color: '#d97706', bg: '#fef3c7', icon: Bell },
  quiz: { label: 'Quiz / Test', color: '#7c3aed', bg: '#ede9fe', icon: BookOpenCheck },
  assignment: { label: 'Assignment / HW', color: '#059669', bg: '#dcfce7', icon: FileText },
  holiday: { label: 'Holiday / Break', color: '#e11d48', bg: '#ffe4e6', icon: Sparkles },
};

const COLOR_SWATCHES = ['#0284c7', '#d97706', '#7c3aed', '#059669', '#e11d48', '#4f46e5', '#0891b2', '#ea580c'];

function pad2(num: number): string {
  return String(num).padStart(2, '0');
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function ClassroomCalendar({ user, readOnly = false }: ClassroomCalendarProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'month' | 'agenda'>('month');

  // Modal states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEventItem | null>(null);
  const [selectedDayEvents, setSelectedDayEvents] = useState<{ date: string; events: CalendarEventItem[] } | null>(null);
  const [selectedEventDetail, setSelectedEventDetail] = useState<CalendarEventItem | null>(null);

  // Form input states
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formType, setFormType] = useState<CalendarEventItem['type']>('reminder');
  const [formDesc, setFormDesc] = useState('');
  const [formColor, setFormColor] = useState('#0284c7');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed
  const todayKey = formatDateKey(new Date());

  // 1. Fetch Events
  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/calendar/events`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.events)) {
        setEvents(data.events);
      }
    } catch (err) {
      console.error('Failed to load calendar events:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // 2. Real-time updates via Socket.IO
  useEffect(() => {
    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });

    socket.on('calendar:event_created', (created: CalendarEventItem) => {
      setEvents((prev) => (prev.some((e) => e.id === created.id) ? prev : [...prev, created]));
    });

    socket.on('calendar:event_updated', (updated: CalendarEventItem) => {
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setSelectedEventDetail((curr) => (curr?.id === updated.id ? updated : curr));
    });

    socket.on('calendar:event_deleted', ({ eventId }: { eventId: string }) => {
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setSelectedEventDetail((curr) => (curr?.id === eventId ? null : curr));
      setSelectedDayEvents((curr) => curr ? { ...curr, events: curr.events.filter((e) => e.id !== eventId) } : null);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    if (activeFilter === 'all') return events;
    return events.filter((e) => e.type === activeFilter);
  }, [events, activeFilter]);

  // Events Map indexed by date key (YYYY-MM-DD)
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const ev of filteredEvents) {
      const list = map.get(ev.date) || [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return map;
  }, [filteredEvents]);

  // Upcoming Events (Next 30 days)
  const upcomingEvents = useMemo(() => {
    return filteredEvents
      .filter((e) => e.date >= todayKey)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
      .slice(0, 15);
  }, [filteredEvents, todayKey]);

  // Calendar Grid Cells Generation
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: { date: Date; dateStr: string; isCurrentMonth: boolean }[] = [];

    // Leading days from previous month
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, daysInPrevMonth - i);
      days.push({ date: d, dateStr: formatDateKey(d), isCurrentMonth: false });
    }

    // Days of current month
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      days.push({ date: d, dateStr: formatDateKey(d), isCurrentMonth: true });
    }

    // Trailing days of next month to complete rows of 7
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let day = 1; day <= remaining; day++) {
        const d = new Date(year, month + 1, day);
        days.push({ date: d, dateStr: formatDateKey(d), isCurrentMonth: false });
      }
    }

    return days;
  }, [year, month]);

  // Handlers
  function handlePrevMonth() {
    setCurrentDate(new Date(year, month - 1, 1));
  }

  function handleNextMonth() {
    setCurrentDate(new Date(year, month + 1, 1));
  }

  function handleGoToday() {
    setCurrentDate(new Date());
  }

  function openCreateModal(dateStr?: string) {
    if (readOnly) return;
    setEditingEvent(null);
    setFormTitle('');
    setFormDate(dateStr || todayKey);
    setFormTime('');
    setFormType('reminder');
    setFormDesc('');
    setFormColor('#0284c7');
    setIsFormOpen(true);
  }

  function openEditModal(event: CalendarEventItem) {
    if (readOnly) return;
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormDate(event.date);
    setFormTime(event.time || '');
    setFormType(event.type);
    setFormDesc(event.description || '');
    setFormColor(event.color || '#0284c7');
    setSelectedEventDetail(null);
    setIsFormOpen(true);
  }

  async function handleSaveEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() || !formDate) return;
    setSaving(true);

    const payload = {
      title: formTitle.trim(),
      description: formDesc.trim() || null,
      date: formDate,
      time: formTime.trim() || null,
      type: formType,
      color: formColor,
    };

    try {
      if (editingEvent) {
        const res = await fetch(`/api/calendar/events/${editingEvent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.event) {
          setEvents((prev) => prev.map((item) => (item.id === data.event.id ? data.event : item)));
          setIsFormOpen(false);
        } else {
          alert(data.error || 'Failed to update event.');
        }
      } else {
        const res = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.event) {
          setEvents((prev) => [...prev, data.event]);
          setIsFormOpen(false);
        } else {
          alert(data.error || 'Failed to create event.');
        }
      }
    } catch {
      alert('Network error while saving event.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEvent(id: string) {
    if (readOnly) return;
    if (!window.confirm('Are you sure you want to delete this event/reminder?')) return;
    setDeletingId(id);

    try {
      const res = await fetch(`/api/calendar/events/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) {
        setEvents((prev) => prev.filter((item) => item.id !== id));
        setSelectedEventDetail(null);
        setIsFormOpen(false);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete event.');
      }
    } catch {
      alert('Network error while deleting event.');
    } finally {
      setDeletingId(null);
    }
  }

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="classroom-calendar-wrapper">
      {/* Top Header & Controls */}
      <div className="cal-header-card">
        <div className="cal-header-left">
          <div className="cal-title-group">
            <span className="cal-icon-badge">
              <CalendarIcon size={20} color="#0284c7" />
            </span>
            <div>
              <h2 className="cal-heading">
                {readOnly ? 'Classroom Calendar & Reminders' : 'Calendar & Event Manager'}
              </h2>
              <p className="cal-subtitle">
                {readOnly
                  ? `Upcoming schedules, deadlines, quizzes & reminders posted by ${user.teacherName || 'your teacher'}`
                  : 'Schedule classroom events, test dates, homework deadlines and reminders for students'}
              </p>
            </div>
          </div>
        </div>

        <div className="cal-header-actions">
          {!readOnly && (
            <button
              type="button"
              className="button button-primary cal-btn-add"
              onClick={() => openCreateModal()}
            >
              <Plus size={16} /> Add Event / Reminder
            </button>
          )}

          <div className="cal-view-toggle">
            <button
              type="button"
              className={`cal-view-btn ${viewMode === 'month' ? 'cal-view-btn--active' : ''}`}
              onClick={() => setViewMode('month')}
            >
              <CalendarDays size={14} /> Month
            </button>
            <button
              type="button"
              className={`cal-view-btn ${viewMode === 'agenda' ? 'cal-view-btn--active' : ''}`}
              onClick={() => setViewMode('agenda')}
            >
              <CalendarCheck size={14} /> Agenda
            </button>
          </div>
        </div>
      </div>

      {/* Navigation & Filter Bar */}
      <div className="cal-nav-toolbar">
        <div className="cal-month-nav">
          <div className="cal-month-stepper">
            <button
              type="button"
              className="cal-step-btn"
              onClick={handlePrevMonth}
              title="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="cal-current-month-label">
              {monthName} {loading && <small style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>· Syncing...</small>}
            </span>
            <button
              type="button"
              className="cal-step-btn"
              onClick={handleNextMonth}
              title="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <button
            type="button"
            className="cal-today-btn"
            onClick={handleGoToday}
          >
            Today
          </button>
        </div>

        {/* Filter Pills */}
        <div className="cal-filters-row">
          <span className="cal-filter-label">
            <Filter size={12} /> Filter:
          </span>
          <button
            type="button"
            className={`cal-filter-pill ${activeFilter === 'all' ? 'cal-filter-pill--active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            All ({events.length})
          </button>
          {Object.entries(EVENT_TYPES).map(([typeKey, meta]) => {
            const count = events.filter((e) => e.type === typeKey).length;
            const Icon = meta.icon;
            return (
              <button
                key={typeKey}
                type="button"
                className={`cal-filter-pill ${activeFilter === typeKey ? 'cal-filter-pill--active' : ''}`}
                onClick={() => setActiveFilter(typeKey)}
              >
                <Icon size={12} style={{ color: meta.color }} />
                <span>{meta.label}</span>
                {count > 0 && <span className="cal-pill-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Body: Grid + Upcoming Sidebar */}
      <div className="cal-layout-grid">
        <div className="cal-main-area">
          {viewMode === 'month' ? (
            <div className="cal-month-table">
              {/* Day of Week Headers */}
              <div className="cal-week-header">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="cal-week-cell">
                    {d}
                  </div>
                ))}
              </div>

              {/* Month Grid Cells */}
              <div className="cal-grid-cells">
                {calendarDays.map(({ date, dateStr, isCurrentMonth }) => {
                  const dayEvents = eventsByDate.get(dateStr) || [];
                  const isToday = dateStr === todayKey;
                  const dayNum = date.getDate();

                  return (
                    <div
                      key={dateStr}
                      className={`cal-day-cell ${!isCurrentMonth ? 'cal-day-cell--muted' : ''} ${
                        isToday ? 'cal-day-cell--today' : ''
                      }`}
                      onClick={() => {
                        if (dayEvents.length > 0) {
                          setSelectedDayEvents({ date: dateStr, events: dayEvents });
                        } else if (!readOnly) {
                          openCreateModal(dateStr);
                        }
                      }}
                    >
                      <div className="cal-day-header">
                        <span className={`cal-day-number ${isToday ? 'cal-day-number--today' : ''}`}>
                          {dayNum}
                        </span>

                        {!readOnly && isCurrentMonth && (
                          <button
                            type="button"
                            className="cal-day-add-btn"
                            title={`Add event for ${dateStr}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openCreateModal(dateStr);
                            }}
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>

                      {/* Day Event Chips */}
                      <div className="cal-day-events-list">
                        {dayEvents.slice(0, 3).map((ev) => {
                          const meta = EVENT_TYPES[ev.type] || EVENT_TYPES.event;
                          return (
                            <div
                              key={ev.id}
                              className="cal-event-chip"
                              style={{
                                borderLeftColor: ev.color || meta.color,
                                background: meta.bg,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedEventDetail(ev);
                              }}
                              title={`${ev.title}${ev.time ? ` (${ev.time})` : ''}`}
                            >
                              <span
                                className="cal-chip-dot"
                                style={{ background: ev.color || meta.color }}
                              />
                              {ev.time && <span className="cal-chip-time">{ev.time}</span>}
                              <span className="cal-chip-title">{ev.title}</span>
                            </div>
                          );
                        })}

                        {dayEvents.length > 3 && (
                          <button
                            type="button"
                            className="cal-more-chip"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDayEvents({ date: dateStr, events: dayEvents });
                            }}
                          >
                            +{dayEvents.length - 3} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Agenda View */
            <div className="cal-agenda-view">
              {filteredEvents.length === 0 ? (
                <div className="cal-empty-state">
                  <CalendarDays size={36} color="#94a3b8" />
                  <h3>No events or reminders found</h3>
                  <p>
                    {readOnly
                      ? 'Your teacher has not scheduled any events or reminders for this period.'
                      : 'Click "+ Add Event / Reminder" to schedule test dates, homework or reminders.'}
                  </p>
                  {!readOnly && (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => openCreateModal()}
                    >
                      <Plus size={15} /> Add First Event
                    </button>
                  )}
                </div>
              ) : (
                <div className="cal-agenda-list">
                  {filteredEvents.map((ev) => {
                    const meta = EVENT_TYPES[ev.type] || EVENT_TYPES.event;
                    const Icon = meta.icon;
                    const dateObj = new Date(ev.date + 'T00:00:00');
                    const formattedDate = dateObj.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    });

                    return (
                      <div
                        key={ev.id}
                        className="cal-agenda-item"
                        onClick={() => setSelectedEventDetail(ev)}
                      >
                        <div
                          className="cal-agenda-date-badge"
                          style={{ borderColor: ev.color || meta.color }}
                        >
                          <span className="cal-badge-month">
                            {dateObj.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
                          </span>
                          <span className="cal-badge-day">{dateObj.getDate()}</span>
                        </div>

                        <div className="cal-agenda-info">
                          <div className="cal-agenda-title-row">
                            <span
                              className="cal-type-tag"
                              style={{ background: meta.bg, color: meta.color }}
                            >
                              <Icon size={12} /> {meta.label}
                            </span>
                            <h4 className="cal-agenda-title">{ev.title}</h4>
                          </div>

                          <div className="cal-agenda-meta">
                            <span>{formattedDate}</span>
                            {ev.time && (
                              <span className="cal-agenda-time">
                                <Clock size={12} /> {ev.time}
                              </span>
                            )}
                          </div>

                          {ev.description && (
                            <p className="cal-agenda-desc">{ev.description}</p>
                          )}
                        </div>

                        {!readOnly && (
                          <div className="cal-agenda-actions">
                            <button
                              type="button"
                              className="cal-icon-btn"
                              title="Edit event"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(ev);
                              }}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              type="button"
                              className="cal-icon-btn cal-icon-btn--delete"
                              title="Delete event"
                              disabled={deletingId === ev.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteEvent(ev.id);
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar: Upcoming List & Quick Facts */}
        <div className="cal-sidebar">
          <div className="cal-upcoming-card">
            <div className="cal-sidebar-heading">
              <span className="cal-sidebar-badge">
                <Bell size={14} color="#d97706" />
              </span>
              <h3>Upcoming Reminders</h3>
            </div>

            {upcomingEvents.length === 0 ? (
              <div className="cal-no-upcoming">
                <p>No upcoming events or reminders in the next 30 days.</p>
              </div>
            ) : (
              <div className="cal-upcoming-list">
                {upcomingEvents.map((ev) => {
                  const meta = EVENT_TYPES[ev.type] || EVENT_TYPES.event;
                  const isToday = ev.date === todayKey;
                  const dateObj = new Date(ev.date + 'T00:00:00');
                  const dateLabel = isToday
                    ? 'Today'
                    : dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                  return (
                    <div
                      key={ev.id}
                      className="cal-upcoming-item"
                      onClick={() => setSelectedEventDetail(ev)}
                    >
                      <div
                        className="cal-upcoming-bar"
                        style={{ background: ev.color || meta.color }}
                      />
                      <div className="cal-upcoming-content">
                        <div className="cal-upcoming-top">
                          <span
                            className={`cal-upcoming-date ${isToday ? 'cal-upcoming-date--today' : ''}`}
                          >
                            {dateLabel}
                          </span>
                          {ev.time && <span className="cal-upcoming-time">{ev.time}</span>}
                        </div>
                        <span className="cal-upcoming-title">{ev.title}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Notice Card */}
          <div className="cal-info-notice-card">
            <div className="cal-notice-header">
              <AlertCircle size={15} color="#0284c7" />
              <strong>{readOnly ? 'Student Notice' : 'Teacher Notice'}</strong>
            </div>
            <p>
              {readOnly
                ? 'Check this calendar regularly for homework deadlines, upcoming quizzes, exam dates, and announcements posted by your teacher.'
                : 'All dates, tests, and reminders you add here remain permanently until you delete them, and sync instantly to all your enrolled students.'}
            </p>
          </div>
        </div>
      </div>

      {/* Modal 1: Create / Edit Event Modal (Teacher Only) */}
      {isFormOpen && !readOnly && (
        <div className="cal-modal-overlay" onClick={() => setIsFormOpen(false)}>
          <div className="cal-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-header">
              <div className="cal-modal-title">
                <CalendarIcon size={18} color="#0284c7" />
                <h3>{editingEvent ? 'Edit Event / Reminder' : 'Add New Event or Reminder'}</h3>
              </div>
              <button
                type="button"
                className="cal-modal-close-btn"
                onClick={() => setIsFormOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="cal-form-body">
              {/* Event Title */}
              <div className="cal-form-group">
                <label htmlFor="calTitleInput">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="calTitleInput"
                  type="text"
                  required
                  placeholder="e.g. Chapter 4 Quiz on Fractions, Bring Geometry Box"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  maxLength={180}
                  autoFocus
                />
              </div>

              {/* Type and Date */}
              <div className="cal-form-row">
                <div className="cal-form-group flex-1">
                  <label htmlFor="calTypeSelect">Type / Category</label>
                  <select
                    id="calTypeSelect"
                    value={formType}
                    onChange={(e) => {
                      const newType = e.target.value as CalendarEventItem['type'];
                      setFormType(newType);
                      setFormColor(EVENT_TYPES[newType]?.color || '#0284c7');
                    }}
                  >
                    {Object.entries(EVENT_TYPES).map(([k, meta]) => (
                      <option key={k} value={k}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="cal-form-group flex-1">
                  <label htmlFor="calDateInput">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="calDateInput"
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Time & Color */}
              <div className="cal-form-row">
                <div className="cal-form-group flex-1">
                  <label htmlFor="calTimeInput">Time (Optional)</label>
                  <input
                    id="calTimeInput"
                    type="text"
                    placeholder="e.g. 10:30 AM, 2:00 PM, All Day"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                  />
                </div>

                <div className="cal-form-group flex-1">
                  <label>Highlight Color</label>
                  <div className="cal-color-picker">
                    {COLOR_SWATCHES.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        className={`cal-color-circle ${formColor === swatch ? 'cal-color-circle--selected' : ''}`}
                        style={{ background: swatch }}
                        onClick={() => setFormColor(swatch)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Description / Instructions */}
              <div className="cal-form-group">
                <label htmlFor="calDescInput">Details / Instructions (Optional)</label>
                <textarea
                  id="calDescInput"
                  rows={3}
                  placeholder="Provide instructions, topics to cover, or items students should bring..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  maxLength={1500}
                />
              </div>

              {/* Form Actions */}
              <div className="cal-modal-footer">
                {editingEvent && (
                  <button
                    type="button"
                    className="button button-danger cal-btn-delete"
                    onClick={() => void handleDeleteEvent(editingEvent.id)}
                    disabled={saving || Boolean(deletingId)}
                  >
                    <Trash2 size={14} /> {deletingId === editingEvent.id ? 'Deleting...' : 'Delete'}
                  </button>
                )}

                <div className="cal-footer-right">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setIsFormOpen(false)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={saving || !formTitle.trim() || !formDate}
                  >
                    {saving ? 'Saving...' : editingEvent ? 'Save Changes' : 'Create Event'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Event Details Modal (Accessible to Both Teacher & Student) */}
      {selectedEventDetail && (
        <div className="cal-modal-overlay" onClick={() => setSelectedEventDetail(null)}>
          <div className="cal-modal-box cal-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-header">
              <div className="cal-modal-title">
                {(() => {
                  const meta = EVENT_TYPES[selectedEventDetail.type] || EVENT_TYPES.event;
                  const Icon = meta.icon;
                  return (
                    <span
                      className="cal-type-tag"
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      <Icon size={13} /> {meta.label}
                    </span>
                  );
                })()}
              </div>
              <button
                type="button"
                className="cal-modal-close-btn"
                onClick={() => setSelectedEventDetail(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="cal-detail-body">
              <h2 className="cal-detail-title">{selectedEventDetail.title}</h2>

              <div className="cal-detail-meta-list">
                <div className="cal-detail-meta-item">
                  <CalendarDays size={15} color="#0284c7" />
                  <span>
                    {new Date(selectedEventDetail.date + 'T00:00:00').toLocaleDateString(undefined, {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>

                {selectedEventDetail.time && (
                  <div className="cal-detail-meta-item">
                    <Clock size={15} color="#d97706" />
                    <span>{selectedEventDetail.time}</span>
                  </div>
                )}
              </div>

              {selectedEventDetail.description ? (
                <div className="cal-detail-desc-card">
                  <div className="cal-desc-header">
                    <AlignLeft size={13} />
                    <span>Instructions / Notes:</span>
                  </div>
                  <p className="cal-desc-text">{selectedEventDetail.description}</p>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic" style={{ marginTop: '12px' }}>
                  No additional notes provided.
                </p>
              )}
            </div>

            <div className="cal-modal-footer">
              {!readOnly ? (
                <>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => void handleDeleteEvent(selectedEventDetail.id)}
                    disabled={Boolean(deletingId)}
                  >
                    <Trash2 size={14} /> {deletingId === selectedEventDetail.id ? 'Deleting...' : 'Delete'}
                  </button>
                  <div className="cal-footer-right">
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => openEditModal(selectedEventDetail)}
                    >
                      <Edit2 size={14} /> Edit Event
                    </button>
                  </div>
                </>
              ) : (
                <div className="cal-footer-right">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setSelectedEventDetail(null)}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Day Events List Modal */}
      {selectedDayEvents && (
        <div className="cal-modal-overlay" onClick={() => setSelectedDayEvents(null)}>
          <div className="cal-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-header">
              <div className="cal-modal-title">
                <CalendarIcon size={18} color="#0284c7" />
                <h3>
                  Events on{' '}
                  {new Date(selectedDayEvents.date + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </h3>
              </div>
              <button
                type="button"
                className="cal-modal-close-btn"
                onClick={() => setSelectedDayEvents(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="cal-day-modal-body">
              {selectedDayEvents.events.map((ev) => {
                const meta = EVENT_TYPES[ev.type] || EVENT_TYPES.event;
                const Icon = meta.icon;
                return (
                  <div
                    key={ev.id}
                    className="cal-day-modal-item"
                    onClick={() => {
                      setSelectedDayEvents(null);
                      setSelectedEventDetail(ev);
                    }}
                  >
                    <div
                      className="cal-day-modal-dot"
                      style={{ background: ev.color || meta.color }}
                    />
                    <div className="cal-day-modal-info">
                      <div className="cal-day-modal-title">{ev.title}</div>
                      <div className="cal-day-modal-time">
                        <span style={{ color: meta.color }}>
                          <Icon size={11} style={{ display: 'inline', marginRight: '3px' }} />
                          {meta.label}
                        </span>
                        {ev.time && <span> • {ev.time}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="cal-modal-footer">
              {!readOnly && (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    const dt = selectedDayEvents.date;
                    setSelectedDayEvents(null);
                    openCreateModal(dt);
                  }}
                >
                  <Plus size={14} /> Add Another Event
                </button>
              )}
              <div className="cal-footer-right">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setSelectedDayEvents(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
