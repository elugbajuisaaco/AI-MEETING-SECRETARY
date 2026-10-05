import React, { useState, useEffect } from 'react';
import {
  Search,
  Calendar,
  Clock,
  Download,
  Trash2,
  ExternalLink,
  Plus,
  FileText,
  CheckCircle2,
  AlertCircle,
  Filter,
  BarChart3,
  Sparkles,
} from 'lucide-react';
import { Meeting, User } from '../types';
import { api } from '../services/api';
import { exportToWord, exportToPdf, formatDuration, formatFriendlyDate } from '../utils/exportDocs';

interface DashboardProps {
  user: User;
  onOpenMeeting: (meeting: Meeting) => void;
  onNewMeeting: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  user,
  onOpenMeeting,
  onNewMeeting,
}) => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchMeetings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMeetings();
      setMeetings(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load past meetings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteMeeting(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      setDeleteId(null);
    } catch (err: any) {
      alert('Failed to delete meeting: ' + err.message);
    }
  };

  // Filtered list
  const filteredMeetings = meetings.filter((meeting) => {
    const matchesCategory =
      selectedCategory === 'All' || meeting.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      meeting.title.toLowerCase().includes(q) ||
      (meeting.summary && meeting.summary.toLowerCase().includes(q)) ||
      (meeting.topics && meeting.topics.some((t) => t.toLowerCase().includes(q))) ||
      (meeting.actionItems && meeting.actionItems.some((a) => a.task.toLowerCase().includes(q)));
    return matchesCategory && matchesSearch;
  });

  // Calculate statistics
  const totalDurationSeconds = meetings.reduce((acc, m) => acc + (m.durationSeconds || 0), 0);
  const totalActionItems = meetings.reduce((acc, m) => acc + (m.actionItems?.length || 0), 0);
  const pendingActionItems = meetings.reduce(
    (acc, m) => acc + (m.actionItems?.filter((a) => !a.completed)?.length || 0),
    0
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Secretary Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Welcome back, <span className="font-semibold text-slate-800">{user.name || user.email}</span>.
            Review and export your transcribed meetings.
          </p>
        </div>

        <button
          onClick={onNewMeeting}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-md shadow-indigo-200 transition-all flex items-center justify-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Recording</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Meetings</p>
            <p className="text-2xl font-black text-slate-900 mt-0.5">{meetings.length}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Audio Logged</p>
            <p className="text-2xl font-black text-slate-900 mt-0.5">
              {Math.round(totalDurationSeconds / 60)} <span className="text-sm font-semibold text-slate-500">mins</span>
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Action Items Pending</p>
            <p className="text-2xl font-black text-slate-900 mt-0.5">
              {pendingActionItems} <span className="text-xs font-normal text-slate-400">/ {totalActionItems} total</span>
            </p>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search meetings, summaries, topics..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {['All', 'General', 'Standup', 'Executive', 'Planning', 'Sales', '1-on-1'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Meeting Cards List */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-500">Loading your meeting archive...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center">
          <AlertCircle className="w-6 h-6 text-red-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-red-800">{error}</p>
          <button
            onClick={fetchMeetings}
            className="mt-3 px-4 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      ) : filteredMeetings.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">No meetings found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-6">
            {searchQuery
              ? `No meetings match "${searchQuery}". Try clearing your search filter.`
              : 'You have not saved any meetings yet. Start your first recording now!'}
          </p>
          <button
            onClick={onNewMeeting}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-100 transition-all cursor-pointer"
          >
            Start First Recording
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredMeetings.map((meeting) => (
            <div
              key={meeting.id}
              className="bg-white rounded-3xl border border-slate-200 hover:border-indigo-300 shadow-xs hover:shadow-md transition-all p-6 flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3
                    onClick={() => onOpenMeeting(meeting)}
                    className="text-base font-bold text-slate-900 group-hover:text-indigo-600 transition-colors cursor-pointer line-clamp-1 flex-1"
                  >
                    {meeting.title}
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 shrink-0">
                    {meeting.category}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-400 mb-3">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatFriendlyDate(meeting.date)}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDuration(meeting.durationSeconds)}
                  </span>
                </div>

                {/* Summary snippet */}
                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mb-4">
                  {meeting.summary || 'No summary available.'}
                </p>

                {/* Topics tags */}
                {meeting.topics && meeting.topics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {meeting.topics.slice(0, 3).map((topic, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-medium truncate max-w-[150px]"
                      >
                        {topic}
                      </span>
                    ))}
                    {meeting.topics.length > 3 && (
                      <span className="px-1.5 py-0.5 text-slate-400 text-[10px]">
                        +{meeting.topics.length - 3} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Card Footer Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
                <div className="text-xs text-slate-500 font-medium">
                  {meeting.actionItems?.length || 0} action items
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => exportToWord(meeting)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                    title="Export Word (.docx)"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setDeleteId(meeting.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="Delete meeting"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => onOpenMeeting(meeting)}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-100">
            <h4 className="text-base font-bold text-slate-900 mb-2">Delete Meeting Transcript?</h4>
            <p className="text-xs text-slate-500 mb-5">
              This action cannot be undone. All summaries, action items, and verbatim notes for this
              meeting will be permanently removed.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteId(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="px-4 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
