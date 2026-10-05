import React, { useState } from 'react';
import {
  FileText,
  Download,
  Copy,
  Check,
  Share2,
  Sparkles,
  Save,
  Trash2,
  Plus,
  Play,
  Pause,
  Clock,
  User as UserIcon,
  Tag,
  CheckSquare,
  Calendar,
  Search,
  MessageSquare,
  Mail,
  RefreshCw,
  ArrowLeft,
  Volume2,
} from 'lucide-react';
import { Meeting, ActionItem, SpeakerSegment } from '../types';
import { exportToWord, exportToPdf, exportToMarkdown, formatDuration, formatFriendlyDate } from '../utils/exportDocs';
import { api } from '../services/api';

interface TranscriptEditorProps {
  meeting: Meeting;
  isGuest: boolean;
  onUpdateMeeting: (updated: Meeting) => void;
  onSaveToAccount: () => void;
  onBackToRecorder: () => void;
  onOpenAuth: () => void;
}

export const TranscriptEditor: React.FC<TranscriptEditorProps> = ({
  meeting,
  isGuest,
  onUpdateMeeting,
  onSaveToAccount,
  onBackToRecorder,
  onOpenAuth,
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'actions' | 'transcript' | 'email'>('summary');
  const [copied, setCopied] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Search inside transcript
  const [transcriptSearch, setTranscriptSearch] = useState('');

  // AI Assistant refinement
  const [aiPromptInstruction, setAiPromptInstruction] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [emailDraft, setEmailDraft] = useState<string | null>(null);

  // Editable fields
  const handleTitleChange = (newTitle: string) => {
    onUpdateMeeting({ ...meeting, title: newTitle });
  };

  const handleSummaryChange = (newSummary: string) => {
    onUpdateMeeting({ ...meeting, summary: newSummary });
  };

  // Toggle Action Item completion
  const toggleActionItem = (id: string) => {
    const updated = meeting.actionItems.map((item) =>
      item.id === id ? { ...item, completed: !item.completed } : item
    );
    onUpdateMeeting({ ...meeting, actionItems: updated });
  };

  // Add new action item
  const addActionItem = () => {
    const newItem: ActionItem = {
      id: `act-${Date.now()}`,
      task: 'New follow-up task',
      assignee: 'Team',
      dueDate: 'By next sync',
      completed: false,
    };
    onUpdateMeeting({ ...meeting, actionItems: [...meeting.actionItems, newItem] });
  };

  // Update action item
  const updateActionItem = (id: string, updates: Partial<ActionItem>) => {
    const updated = meeting.actionItems.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    );
    onUpdateMeeting({ ...meeting, actionItems: updated });
  };

  // Delete action item
  const deleteActionItem = (id: string) => {
    const updated = meeting.actionItems.filter((item) => item.id !== id);
    onUpdateMeeting({ ...meeting, actionItems: updated });
  };

  // Update transcript segment
  const updateSegment = (id: string, updates: Partial<SpeakerSegment>) => {
    const updated = meeting.transcriptSegments.map((seg) =>
      seg.id === id ? { ...seg, ...updates } : seg
    );
    onUpdateMeeting({ ...meeting, transcriptSegments: updated });
  };

  // Copy to clipboard
  const handleCopy = () => {
    const md = exportToMarkdown(meeting);
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Export to Word
  const handleExportWord = async () => {
    setIsExportingWord(true);
    try {
      await exportToWord(meeting);
    } catch (err) {
      console.error('Word export error:', err);
      alert('Failed to generate Word document.');
    } finally {
      setIsExportingWord(false);
    }
  };

  // Export to PDF
  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      await exportToPdf(meeting);
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Failed to generate PDF document.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Save to account
  const handleSave = async () => {
    if (isGuest) {
      onSaveToAccount();
      return;
    }

    setIsSaving(true);
    try {
      if (meeting.id.startsWith('meeting-') && !meeting.id.startsWith('persisted-')) {
        const saved = await api.createMeeting(meeting);
        onUpdateMeeting(saved);
      } else {
        const updated = await api.updateMeeting(meeting.id, meeting);
        onUpdateMeeting(updated);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Save error:', err);
      alert(err.message || 'Failed to save meeting');
    } finally {
      setIsSaving(false);
    }
  };

  // AI Refine actions
  const runAiRefinement = async (instruction: string) => {
    setIsAiLoading(true);
    try {
      const result = await api.refineMeeting(meeting, instruction);
      if (instruction.includes('email')) {
        setEmailDraft(result.summary || 'Could not generate email draft.');
        setActiveTab('email');
      } else {
        onUpdateMeeting({
          ...meeting,
          ...result,
        });
      }
    } catch (err: any) {
      alert(err.message || 'AI refinement failed');
    } finally {
      setIsAiLoading(false);
    }
  };

  // Filter segments for search
  const filteredSegments = meeting.transcriptSegments.filter((seg) => {
    if (!transcriptSearch.trim()) return true;
    const term = transcriptSearch.toLowerCase();
    return (
      seg.text.toLowerCase().includes(term) ||
      seg.speaker.toLowerCase().includes(term) ||
      seg.timestamp.includes(term)
    );
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <button
          onClick={onBackToRecorder}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Record Another Meeting</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {/* Copy Markdown */}
          <button
            onClick={handleCopy}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Copy Text</span>
              </>
            )}
          </button>

          {/* Export to Word */}
          <button
            onClick={handleExportWord}
            disabled={isExportingWord}
            className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span>{isExportingWord ? 'Exporting...' : 'Word (.docx)'}</span>
          </button>

          {/* Export to PDF */}
          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-rose-600" />
            <span>{isExportingPdf ? 'Exporting...' : 'PDF'}</span>
          </button>

          {/* Save to Account / Dashboard */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-4 py-2 font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer ${
              saveSuccess
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100'
            }`}
          >
            {saveSuccess ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Saved!</span>
              </>
            ) : isSaving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>{isGuest ? 'Sign in & Save' : 'Save Meeting'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Meeting Title & Metadata Header Card */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-md p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex-1">
            <input
              type="text"
              value={meeting.title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Meeting Title"
              className="text-2xl sm:text-3xl font-extrabold text-slate-900 w-full bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-lg px-1 -mx-1"
            />
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {formatFriendlyDate(meeting.date)}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {formatDuration(meeting.durationSeconds)} duration
              </span>
              <span>•</span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                {meeting.category}
              </span>
              {isGuest && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">
                  Ephemeral Guest Session
                </span>
              )}
            </div>
          </div>

          {/* Quick AI Refine Dropdown / Tools */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => runAiRefinement('Generate an executive follow-up email ready to send to team members with clear highlights')}
              disabled={isAiLoading}
              className="px-3 py-1.5 bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Draft Email</span>
            </button>
            <button
              onClick={() => runAiRefinement('Make the executive summary more concise and punchy with bullet points')}
              disabled={isAiLoading}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Polish</span>
            </button>
          </div>
        </div>

        {/* Audio Player (if recorded/uploaded audio is available) */}
        {meeting.audioUrl && (
          <div className="mt-4 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <Volume2 className="w-4 h-4 text-indigo-600" />
              <span>Meeting Audio Recording</span>
            </div>
            <audio controls src={meeting.audioUrl} className="h-9 w-full sm:w-80" />
          </div>
        )}
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 mb-6 overflow-x-auto">
        <button
          onClick={() => setActiveTab('summary')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'summary'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Executive Summary & Topics</span>
        </button>

        <button
          onClick={() => setActiveTab('actions')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'actions'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>Action Items ({meeting.actionItems.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('transcript')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'transcript'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Full Transcript ({meeting.transcriptSegments.length} turns)</span>
        </button>

        {emailDraft && (
          <button
            onClick={() => setActiveTab('email')}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              activeTab === 'email'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Mail className="w-4 h-4" />
            <span>Email Follow-up Draft</span>
          </button>
        )}
      </div>

      {/* TAB 1: EXECUTIVE SUMMARY & TOPICS */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Executive Summary Card */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>Executive Summary</span>
              </h3>
              <span className="text-xs text-slate-400">Editable</span>
            </div>

            <textarea
              rows={6}
              value={meeting.summary}
              onChange={(e) => handleSummaryChange(e.target.value)}
              placeholder="Enter meeting summary..."
              className="w-full text-slate-700 text-sm leading-relaxed p-4 bg-slate-50/50 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all resize-y"
            />
          </div>

          {/* Agenda & Decisions Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Key Topics */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
              <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <Tag className="w-4 h-4 text-violet-600" />
                <span>Key Agenda & Discussion Topics</span>
              </h4>
              {meeting.topics && meeting.topics.length > 0 ? (
                <ul className="space-y-2">
                  {meeting.topics.map((topic, i) => (
                    <li key={i} className="text-xs sm:text-sm text-slate-700 flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-2 shrink-0" />
                      <span>{topic}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400 italic">No specific agenda items detected.</p>
              )}
            </div>

            {/* Key Decisions */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
              <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Agreed Decisions & Outcomes</span>
              </h4>
              {meeting.decisions && meeting.decisions.length > 0 ? (
                <ul className="space-y-2">
                  {meeting.decisions.map((dec, i) => (
                    <li key={i} className="text-xs sm:text-sm text-slate-700 flex items-start gap-2">
                      <span className="text-emerald-600 font-bold shrink-0">✔</span>
                      <span>{dec}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400 italic">No key decisions recorded.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ACTION ITEMS CHECKLIST */}
      {activeTab === 'actions' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Action Items & Deliverables</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Check off tasks as completed, edit assignees, or add new action points.
              </p>
            </div>
            <button
              onClick={addActionItem}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Task</span>
            </button>
          </div>

          {meeting.actionItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              No action items detected in this meeting. Click "Add Task" to create one.
            </div>
          ) : (
            <div className="space-y-3">
              {meeting.actionItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    item.completed
                      ? 'bg-slate-50/60 border-slate-200 opacity-60'
                      : 'bg-white border-slate-200 shadow-xs'
                  }`}
                >
                  <div className="flex items-start gap-3 flex-1">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => toggleActionItem(item.id)}
                      className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div className="flex-1">
                      <input
                        type="text"
                        value={item.task}
                        onChange={(e) => updateActionItem(item.id, { task: e.target.value })}
                        className={`w-full text-sm font-medium bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 -mx-1 ${
                          item.completed ? 'line-through text-slate-400' : 'text-slate-800'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pl-7 sm:pl-0">
                    <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg text-xs text-slate-600">
                      <UserIcon className="w-3 h-3 text-slate-400" />
                      <input
                        type="text"
                        value={item.assignee || ''}
                        onChange={(e) => updateActionItem(item.id, { assignee: e.target.value })}
                        placeholder="Assignee"
                        className="w-20 bg-transparent text-xs text-slate-700 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg text-xs text-slate-600">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <input
                        type="text"
                        value={item.dueDate || ''}
                        onChange={(e) => updateActionItem(item.id, { dueDate: e.target.value })}
                        placeholder="Due date"
                        className="w-20 bg-transparent text-xs text-slate-700 focus:outline-none"
                      />
                    </div>

                    <button
                      onClick={() => deleteActionItem(item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                      title="Delete action item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: FULL TRANSCRIPT EDITOR */}
      {activeTab === 'transcript' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Verbatim Meeting Dialogue</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Speaker labels and timestamps are editable. Click any text to edit inline.
              </p>
            </div>

            {/* In-transcript search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                placeholder="Search dialogue..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {filteredSegments.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              {transcriptSearch ? 'No segments match your search.' : 'No transcript recorded.'}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSegments.map((seg) => (
                <div
                  key={seg.id}
                  className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                      {seg.timestamp}
                    </span>
                    <input
                      type="text"
                      value={seg.speaker}
                      onChange={(e) => updateSegment(seg.id, { speaker: e.target.value })}
                      className="font-bold text-xs text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none px-1"
                    />
                  </div>
                  <textarea
                    rows={2}
                    value={seg.text}
                    onChange={(e) => updateSegment(seg.id, { text: e.target.value })}
                    className="w-full text-xs sm:text-sm text-slate-700 bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded p-1 transition-all resize-y"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: EMAIL FOLLOW-UP DRAFT */}
      {activeTab === 'email' && emailDraft && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 animate-in fade-in">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Mail className="w-4 h-4 text-violet-600" />
                <span>Executive Email Follow-Up</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Ready to copy and paste into Gmail, Outlook, or Slack.
              </p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(emailDraft);
                alert('Email draft copied to clipboard!');
              }}
              className="px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Email</span>
            </button>
          </div>

          <textarea
            rows={10}
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            className="w-full text-xs sm:text-sm font-mono text-slate-800 p-4 bg-slate-50 rounded-2xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}
    </div>
  );
};
