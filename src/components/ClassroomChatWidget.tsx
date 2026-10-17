import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  MessageSquare,
  MessageCircle,
  Users,
  Send,
  X,
  Minus,
  Maximize2,
  Sparkles,
  Smile,
  GraduationCap,
  Star,
  CheckCheck,
  Trash2,
  ChevronDown
} from 'lucide-react';

export interface ChatMessageItem {
  id: string;
  teacherId: string;
  studentId: string | null;
  senderId: string;
  senderName: string;
  senderRole: 'teacher' | 'student' | 'admin' | 'superadmin';
  channel: 'everyone' | 'direct';
  content: string;
  createdAt: string;
}

export interface StudentPeer {
  id: string;
  name: string;
  grade?: string | null;
}

export interface TeacherPeer {
  id: string;
  name: string;
  school?: string | null;
  subject?: string | null;
}

interface ClassroomChatWidgetProps {
  user: {
    id?: string;
    name?: string;
    role: 'admin' | 'teacher' | 'superadmin' | 'student';
    teacherId?: string | null;
    teacherName?: string | null;
  };
}

const QUICK_REACTIONS = ['👍', '✋', '💡', '❓', '📐', '⭐', '👏', '😊'];

function formatGradeBracket(grade?: string | null): string {
  if (!grade) return '';
  const cleaned = grade.replace(/^grade\s*/i, '').replace(/^gr\.?\s*/i, '').trim();
  return cleaned ? ` (${cleaned})` : '';
}

export function ClassroomChatWidget({ user }: ClassroomChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<'everyone' | 'direct'>('everyone');
  const [height, setHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = Number(localStorage.getItem('classroom_chat_height'));
      if (saved >= 340 && saved <= 800) return saved;
    }
    return 490;
  });

  const [classroomTeacher, setClassroomTeacher] = useState<TeacherPeer | null>(null);
  const [students, setStudents] = useState<StudentPeer[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // Independent in-memory caches: instant tab switching with 0ms delay
  const [everyoneMessages, setEveryoneMessages] = useState<ChatMessageItem[]>([]);
  const [directMessagesMap, setDirectMessagesMap] = useState<Record<string, ChatMessageItem[]>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);

  // Unread badge counters
  const [unreadEveryone, setUnreadEveryone] = useState(0);
  const [unreadDirect, setUnreadDirect] = useState(0);
  const [studentUnreadMap, setStudentUnreadMap] = useState<Record<string, number>>({});

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef<number>(0);
  const dragStartHRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const loadedTabsRef = useRef<Set<string>>(new Set());

  // Refs for persistent socket listeners
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const isMinimizedRef = useRef(isMinimized);
  isMinimizedRef.current = isMinimized;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const selectedStudentIdRef = useRef(selectedStudentId);
  selectedStudentIdRef.current = selectedStudentId;

  // Active direct message key (studentId for teacher, 'teacher' for student)
  const activeDirectKey = user.role === 'student' ? 'teacher' : (selectedStudentId || '');
  const currentMessages = activeTab === 'everyone'
    ? everyoneMessages
    : (activeDirectKey ? (directMessagesMap[activeDirectKey] || []) : []);

  // 1. Fetch Classroom Peers (Teacher & Students)
  const loadPeers = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/peers', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data) {
        if (data.teacher) setClassroomTeacher(data.teacher);
        if (data.students && Array.isArray(data.students)) {
          setStudents(data.students);
          if (data.students.length > 0 && !selectedStudentIdRef.current) {
            setSelectedStudentId(data.students[0].id);
          }
        }
      }
    } catch {
      // offline or silent fallback
    }
  }, []);

  useEffect(() => {
    void loadPeers();
  }, [loadPeers]);

  // 2. Fetch Messages for a specific channel
  const fetchChannelMessages = useCallback(async (channel: 'everyone' | 'direct', studentId?: string | null) => {
    const key = channel === 'everyone' ? 'everyone' : `direct:${user.role === 'student' ? 'teacher' : (studentId || '')}`;
    const isFirstLoad = !loadedTabsRef.current.has(key);

    if (isFirstLoad) {
      setLoadingMessages(true);
    }

    try {
      let url = `/api/chat/messages?channel=${channel}&limit=80`;
      if (channel === 'direct' && user.role !== 'student' && studentId) {
        url += `&studentId=${encodeURIComponent(studentId)}`;
      }
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.messages)) {
        if (channel === 'everyone') {
          setEveryoneMessages(data.messages);
          setUnreadEveryone(0);
        } else {
          const mapKey = user.role === 'student' ? 'teacher' : (studentId || '');
          if (mapKey) {
            setDirectMessagesMap((prev) => ({ ...prev, [mapKey]: data.messages }));
            setUnreadDirect(0);
            if (studentId) {
              setStudentUnreadMap((prev) => ({ ...prev, [studentId]: 0 }));
            }
          }
        }
        loadedTabsRef.current.add(key);
      }
    } catch {
      // silent
    } finally {
      setLoadingMessages(false);
    }
  }, [user.role]);

  // Trigger background load whenever tab or selected student changes
  useEffect(() => {
    if (isOpen && !isMinimized) {
      if (activeTab === 'everyone') {
        void fetchChannelMessages('everyone');
      } else if (activeTab === 'direct') {
        if (user.role === 'student' || selectedStudentId) {
          void fetchChannelMessages('direct', selectedStudentId);
        }
      }
    }
  }, [isOpen, isMinimized, activeTab, selectedStudentId, fetchChannelMessages, user.role]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (isOpen && !isMinimized && currentMessages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentMessages.length, isOpen, isMinimized]);

  // 3. Socket.io Real-time connection (Persistent across tab switches)
  useEffect(() => {
    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('chat:message', (newMsg: ChatMessageItem) => {
      if (newMsg.channel === 'everyone') {
        setEveryoneMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));
        if (!isOpenRef.current || isMinimizedRef.current || activeTabRef.current !== 'everyone') {
          setUnreadEveryone((c) => c + 1);
        }
      } else if (newMsg.channel === 'direct') {
        const key = user.role === 'student' ? 'teacher' : (newMsg.studentId || 'unknown');
        setDirectMessagesMap((prev) => {
          const list = prev[key] || [];
          if (list.some((m) => m.id === newMsg.id)) return prev;
          return { ...prev, [key]: [...list, newMsg] };
        });

        const isViewing =
          isOpenRef.current &&
          !isMinimizedRef.current &&
          activeTabRef.current === 'direct' &&
          (user.role === 'student' || selectedStudentIdRef.current === newMsg.studentId);

        if (!isViewing) {
          setUnreadDirect((c) => c + 1);
          if (newMsg.studentId) {
            setStudentUnreadMap((prev) => ({
              ...prev,
              [newMsg.studentId!]: (prev[newMsg.studentId!] || 0) + 1,
            }));
          }
        }
      }
    });

    socket.on('chat:cleared', () => {
      setEveryoneMessages([]);
      setDirectMessagesMap({});
      setUnreadEveryone(0);
      setUnreadDirect(0);
      setStudentUnreadMap({});
      loadedTabsRef.current.clear();
    });

    socket.on('chat:message_deleted', ({ messageId, channel, studentId }: { messageId: string; channel: string; studentId?: string | null }) => {
      if (channel === 'everyone') {
        setEveryoneMessages((prev) => prev.filter((m) => m.id !== messageId));
      } else {
        const key = user.role === 'student' ? 'teacher' : (studentId || '');
        if (key) {
          setDirectMessagesMap((prev) => ({
            ...prev,
            [key]: (prev[key] || []).filter((m) => m.id !== messageId),
          }));
        } else {
          setDirectMessagesMap((prev) => {
            const next = { ...prev };
            for (const k of Object.keys(next)) {
              next[k] = (next[k] || []).filter((m) => m.id !== messageId);
            }
            return next;
          });
        }
      }
    });

    socket.on('chat:direct_notification', ({ studentId }: { studentId: string }) => {
      if (user.role !== 'student') {
        if (!isOpenRef.current || isMinimizedRef.current || activeTabRef.current !== 'direct' || selectedStudentIdRef.current !== studentId) {
          setUnreadDirect((c) => c + 1);
          setStudentUnreadMap((prev) => ({
            ...prev,
            [studentId]: (prev[studentId] || 0) + 1,
          }));
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [user.role]);

  // Join direct room for teacher when student is selected
  useEffect(() => {
    if (user.role !== 'student' && selectedStudentId && socketRef.current) {
      socketRef.current.emit('chat:join_direct', selectedStudentId);
    }
  }, [user.role, selectedStudentId]);

  // 4. Send Message Handler with Instant Optimistic UI
  async function handleSendMessage(textToSend?: string) {
    const msg = (textToSend ?? inputText).trim();
    if (!msg || sending) return;

    if (activeTab === 'direct' && user.role !== 'student' && !selectedStudentId) {
      alert('Please select a student from the list to send a direct message.');
      return;
    }

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const optimisticMsg: ChatMessageItem = {
      id: tempId,
      teacherId: classroomTeacher?.id || user.teacherId || '',
      studentId: activeTab === 'direct' ? (user.role === 'student' ? user.id || null : selectedStudentId) : null,
      senderId: user.id || 'me',
      senderName: user.name || (user.role === 'student' ? 'Kid' : 'Teacher'),
      senderRole: user.role === 'student' ? 'student' : 'teacher',
      channel: activeTab,
      content: msg,
      createdAt: new Date().toISOString(),
    };

    // Optimistically update memory state immediately (0ms delay)
    if (activeTab === 'everyone') {
      setEveryoneMessages((prev) => [...prev, optimisticMsg]);
    } else if (activeDirectKey) {
      setDirectMessagesMap((prev) => ({
        ...prev,
        [activeDirectKey]: [...(prev[activeDirectKey] || []), optimisticMsg],
      }));
    }

    if (!textToSend) setInputText('');
    setShowEmojis(false);
    setSending(true);

    try {
      const payload: any = {
        channel: activeTab,
        content: msg,
      };
      if (activeTab === 'direct' && user.role !== 'student') {
        payload.studentId = selectedStudentId;
      }

      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message) {
        // Reconcile optimistic message with server id
        if (activeTab === 'everyone') {
          setEveryoneMessages((prev) => prev.map((m) => (m.id === tempId ? data.message : m)));
        } else if (activeDirectKey) {
          setDirectMessagesMap((prev) => ({
            ...prev,
            [activeDirectKey]: (prev[activeDirectKey] || []).map((m) => (m.id === tempId ? data.message : m)),
          }));
        }
      } else {
        // Revert optimistic message on error
        if (activeTab === 'everyone') {
          setEveryoneMessages((prev) => prev.filter((m) => m.id !== tempId));
        } else if (activeDirectKey) {
          setDirectMessagesMap((prev) => ({
            ...prev,
            [activeDirectKey]: (prev[activeDirectKey] || []).filter((m) => m.id !== tempId),
          }));
        }
        alert(data.error || 'Failed to send message.');
      }
    } catch {
      // Revert optimistic message on network error
      if (activeTab === 'everyone') {
        setEveryoneMessages((prev) => prev.filter((m) => m.id !== tempId));
      } else if (activeDirectKey) {
        setDirectMessagesMap((prev) => ({
          ...prev,
          [activeDirectKey]: (prev[activeDirectKey] || []).filter((m) => m.id !== tempId),
        }));
      }
      alert('Network error: unable to send message.');
    } finally {
      setSending(false);
    }
  }

  // 5. Clear All Chats Handler (Teacher / Admin)
  async function handleClearAllChats() {
    if (!window.confirm('Delete all messages in this chatroom? All chats will be deleted for everyone.')) return;
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) {
        setEveryoneMessages([]);
        setDirectMessagesMap({});
        setUnreadEveryone(0);
        setUnreadDirect(0);
        setStudentUnreadMap({});
        loadedTabsRef.current.clear();
      }
    } catch {
      alert('Failed to clear chat messages.');
    }
  }

  // Delete individual message (Teachers/admins can delete any/own message, kids can delete own messages sent by mistake)
  async function handleDeleteMessage(msg: ChatMessageItem) {
    if (!msg.id) return;
    const isTemp = msg.id.startsWith('temp_');
    if (!window.confirm('Delete this message?')) return;

    // Optimistically remove from state immediately
    if (msg.channel === 'everyone') {
      setEveryoneMessages((prev) => prev.filter((m) => m.id !== msg.id));
    } else {
      const key = user.role === 'student' ? 'teacher' : (msg.studentId || selectedStudentId || '');
      if (key) {
        setDirectMessagesMap((prev) => ({
          ...prev,
          [key]: (prev[key] || []).filter((m) => m.id !== msg.id),
        }));
      }
    }

    if (isTemp) return;

    try {
      const res = await fetch(`/api/chat/messages/${encodeURIComponent(msg.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete message.');
        // Re-fetch to sync state if deletion failed
        void fetchChannelMessages(activeTab, selectedStudentId);
      }
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  }

  // 6. Drag Handle for Height Adjustment
  function handleDragStart(e: React.PointerEvent) {
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartHRef.current = height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    function onPointerMove(ev: PointerEvent) {
      if (!isDraggingRef.current) return;
      const deltaY = ev.clientY - dragStartYRef.current;
      const newH = Math.max(340, Math.min(window.innerHeight - 40, dragStartHRef.current - deltaY));
      setHeight(newH);
      localStorage.setItem('classroom_chat_height', String(Math.round(newH)));
    }

    function onPointerUp(ev: PointerEvent) {
      isDraggingRef.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  // Quick height preset toggling
  function cycleHeightPreset() {
    let nextH = 490;
    if (height < 420) nextH = 490;
    else if (height < 600) nextH = 680;
    else nextH = 360;
    setHeight(nextH);
    localStorage.setItem('classroom_chat_height', String(nextH));
  }

  const totalUnread = unreadEveryone + unreadDirect;
  const teacherDisplayName = classroomTeacher?.name || user.teacherName || 'Teacher';

  return (
    <>
      {/* Floating Chat Launcher Button (Bottom Right) */}
      {!isOpen && (
        <button
          className="chat-fab-trigger"
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          title="Open Chatroom"
          aria-label="Open Chatroom"
        >
          <div className="chat-fab-icon-wrap">
            <MessageSquare size={22} className="chat-fab-icon" />
            {totalUnread > 0 && (
              <span className="chat-fab-badge" aria-label={`${totalUnread} unread messages`}>
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </div>
          <span className="chat-fab-label">Chat</span>
        </button>
      )}

      {/* Floating Chat Popup Card */}
      {isOpen && (
        <div
          className={`chat-popup-card ${isMinimized ? 'chat-popup-card--minimized' : ''}`}
          style={{ height: isMinimized ? 'auto' : `${height}px` }}
        >
          {/* Top Resizable Grab Handle */}
          {!isMinimized && (
            <div
              className="chat-card-drag-handle"
              onPointerDown={handleDragStart}
              title="Drag up or down to adjust chat height"
            >
              <div className="chat-drag-pill" />
            </div>
          )}

          {/* Card Header: Simple "Chatroom" */}
          <div className="chat-card-header">
            <div className="chat-header-title-wrap">
              <div className="chat-online-dot" title="Live Classroom Connection Active" />
              <div>
                <h3 className="chat-header-title">Chatroom</h3>
              </div>
            </div>

            <div className="chat-header-actions">
              {(user.role === 'teacher' || user.role === 'admin' || user.role === 'superadmin') && !isMinimized && (
                <button
                  type="button"
                  className="chat-header-btn"
                  onClick={handleClearAllChats}
                  title="Clear all chat messages"
                >
                  <Trash2 size={13} />
                </button>
              )}
              {!isMinimized && (
                <button
                  type="button"
                  className="chat-header-btn"
                  onClick={cycleHeightPreset}
                  title="Cycle card size (Compact / Normal / Tall)"
                >
                  <Maximize2 size={14} />
                </button>
              )}
              <button
                type="button"
                className="chat-header-btn"
                onClick={() => setIsMinimized((v) => !v)}
                title={isMinimized ? 'Expand Chat' : 'Minimize Chat'}
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="chat-header-btn chat-header-btn--close"
                onClick={() => setIsOpen(false)}
                title="Close Chat"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Channel Tabs: Everyone vs One to One */}
              <div className="chat-tabs-bar">
                <button
                  type="button"
                  className={`chat-tab-btn ${activeTab === 'everyone' ? 'chat-tab-btn--active' : ''}`}
                  onClick={() => setActiveTab('everyone')}
                >
                  <Users size={15} />
                  <span>Everyone</span>
                  {unreadEveryone > 0 && (
                    <span className="chat-tab-badge">{unreadEveryone}</span>
                  )}
                </button>

                <button
                  type="button"
                  className={`chat-tab-btn ${activeTab === 'direct' ? 'chat-tab-btn--active' : ''}`}
                  onClick={() => setActiveTab('direct')}
                >
                  <MessageCircle size={15} />
                  <span>One to One</span>
                  {unreadDirect > 0 && (
                    <span className="chat-tab-badge">{unreadDirect}</span>
                  )}
                </button>
              </div>

              {/* Sub-Header for One to One Tab */}
              {activeTab === 'direct' && (
                <div className="chat-sub-channel-bar">
                  {user.role === 'student' ? (
                    <div className="chat-direct-student-info">
                      <Star size={13} className="text-amber-500" />
                      <span>
                        Private conversation with <strong>{teacherDisplayName}</strong>
                      </span>
                    </div>
                  ) : (
                    <div className="chat-direct-teacher-selector">
                      <div className="chat-selector-row">
                        <label htmlFor="chatStudentSelect" className="chat-selector-label">
                          Student:
                        </label>
                        {students.length === 0 ? (
                          <span className="chat-no-students-label">No students enrolled yet</span>
                        ) : (
                          <div className="chat-student-select-wrap">
                            <select
                              id="chatStudentSelect"
                              className="chat-student-dropdown"
                              value={selectedStudentId || ''}
                              onChange={(e) => setSelectedStudentId(e.target.value)}
                            >
                              {students.map((st) => {
                                const unread = studentUnreadMap[st.id] || 0;
                                const unreadLabel = unread > 0 ? ` [${unread} new]` : '';
                                const gradeLabel = formatGradeBracket(st.grade);
                                return (
                                  <option key={st.id} value={st.id}>
                                    {st.name}{gradeLabel}{unreadLabel}
                                  </option>
                                );
                              })}
                            </select>
                            <ChevronDown size={13} className="chat-select-chevron" />
                          </div>
                        )}
                        {selectedStudentId && (studentUnreadMap[selectedStudentId] || 0) > 0 ? (
                          <span className="chat-selected-unread-badge" title="Unread messages from this student">
                            {studentUnreadMap[selectedStudentId]} new
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Message List Area */}
              <div className="chat-messages-container">
                {loadingMessages && currentMessages.length === 0 ? (
                  <div className="chat-loading-state">
                    <div className="chat-spinner" />
                    <span>Loading conversation...</span>
                  </div>
                ) : currentMessages.length === 0 ? (
                  <div className="chat-empty-state">
                    <div className="chat-empty-icon-wrap">
                      <Sparkles size={24} color="#0284c7" />
                    </div>
                    <h4>
                      {activeTab === 'everyone'
                        ? 'Welcome to the Chatroom!'
                        : user.role === 'student'
                        ? `Direct Chat with ${teacherDisplayName}`
                        : 'Direct Student Chat'}
                    </h4>
                    <p>
                      {activeTab === 'everyone'
                        ? 'Kids and teacher can ask questions, share answers, and collaborate here.'
                        : user.role === 'student'
                        ? 'Ask your teacher any question privately. Only you and your teacher can view this.'
                        : 'Have a private 1-on-1 discussion or offer individual math guidance.'}
                    </p>
                    <div className="chat-starter-pills">
                      <button
                        type="button"
                        onClick={() => handleSendMessage('Hello everyone! 👋')}
                      >
                        Hello everyone! 👋
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendMessage('I have a question about maths ❓')}
                      >
                        I have a question ❓
                      </button>
                    </div>
                  </div>
                ) : (
                  currentMessages.map((m, idx) => {
                    const isMine = m.senderId === user.id;
                    const isTeacherMsg = m.senderRole === 'teacher';
                    const canDelete = isMine || user.role === 'teacher' || user.role === 'admin' || user.role === 'superadmin';
                    const timeStr = new Date(m.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div
                        key={m.id || idx}
                        className={`chat-message-row ${isMine ? 'chat-message-row--mine' : 'chat-message-row--theirs'}`}
                      >
                        {!isMine && (
                          <div
                            className={`chat-avatar ${isTeacherMsg ? 'chat-avatar--teacher' : 'chat-avatar--student'}`}
                            title={m.senderName}
                          >
                            {m.senderName.slice(0, 1).toUpperCase()}
                          </div>
                        )}

                        <div className="chat-bubble-wrap">
                          {!isMine && (
                            <div className="chat-sender-header">
                              <span className="chat-sender-name">{m.senderName}</span>
                              {isTeacherMsg ? (
                                <span className="chat-badge chat-badge--teacher">
                                  Teacher <Star size={10} />
                                </span>
                              ) : (
                                <span className="chat-badge chat-badge--student">
                                  Kid <GraduationCap size={10} />
                                </span>
                              )}
                            </div>
                          )}

                          <div className="chat-bubble-and-actions">
                            {isMine && canDelete && (
                              <button
                                type="button"
                                className="chat-msg-delete-btn"
                                onClick={() => handleDeleteMessage(m)}
                                title="Delete message sent by mistake"
                                aria-label="Delete message sent by mistake"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}

                            <div className={`chat-bubble ${isMine ? 'chat-bubble--mine' : 'chat-bubble--theirs'}`}>
                              <p className="chat-text">{m.content}</p>
                              <span className="chat-time">
                                {timeStr}
                                {isMine && <CheckCheck size={11} className="chat-check" />}
                              </span>
                            </div>

                            {!isMine && canDelete && (
                              <button
                                type="button"
                                className="chat-msg-delete-btn"
                                onClick={() => handleDeleteMessage(m)}
                                title="Delete message"
                                aria-label="Delete message"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Reactions Bar */}
              {showEmojis && (
                <div className="chat-quick-emojis">
                  {QUICK_REACTIONS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className="chat-emoji-btn"
                      onClick={() => handleSendMessage(em)}
                      title={`Send ${em}`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}

              {/* Bottom Input Area */}
              <div className="chat-input-bar">
                <button
                  type="button"
                  className={`chat-icon-action-btn ${showEmojis ? 'chat-icon-action-btn--active' : ''}`}
                  onClick={() => setShowEmojis((v) => !v)}
                  title="Quick reactions"
                >
                  <Smile size={18} />
                </button>

                <input
                  type="text"
                  className="chat-text-input"
                  placeholder={
                    activeTab === 'everyone'
                      ? 'Message everyone in class...'
                      : user.role === 'student'
                      ? `Message ${teacherDisplayName}...`
                      : 'Type a private reply...'
                  }
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sending}
                  maxLength={1500}
                />

                <button
                  type="button"
                  className="chat-send-btn"
                  onClick={() => handleSendMessage()}
                  disabled={sending || !inputText.trim()}
                  title="Send message (Enter)"
                >
                  <Send size={15} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
