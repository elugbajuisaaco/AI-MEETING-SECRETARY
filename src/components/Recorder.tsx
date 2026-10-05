import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  Square,
  Pause,
  Play,
  Upload,
  Sparkles,
  AlertCircle,
  FileAudio,
  Radio,
  CheckCircle2,
  Clock,
  Settings2,
  Volume2,
} from 'lucide-react';
import { api } from '../services/api';
import { Meeting } from '../types';

interface RecorderProps {
  isGuest: boolean;
  onTranscriptionSuccess: (meeting: Meeting, audioBlobUrl?: string) => void;
  onOpenAuth: () => void;
}

export const Recorder: React.FC<RecorderProps> = ({
  isGuest,
  onTranscriptionSuccess,
  onOpenAuth,
}) => {
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [category, setCategory] = useState<Meeting['category']>('General');
  const [meetingContext, setMeetingContext] = useState('');
  const [language, setLanguage] = useState('en');

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Audio waveform visualization
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(24).fill(10));
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);

  // File upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  const cleanupAudio = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  // Timer formatted
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start Live Recording
  const startRecording = async () => {
    setError(null);
    audioChunksRef.current = [];
    setUploadedFileName(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support microphone audio recording.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      // Setup Web Audio API Analyser for live wave animation
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Update Waveform bars
      const updateWaveform = () => {
        if (!analyserRef.current) return;
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Sample 24 bars
        const bars: number[] = [];
        const step = Math.floor(dataArray.length / 24) || 1;
        for (let i = 0; i < 24; i++) {
          const val = dataArray[i * step] || 0;
          // Scale between 8% and 95%
          const percent = Math.max(8, Math.min(95, (val / 255) * 100));
          bars.push(percent);
        }
        setAudioLevels(bars);
        animationFrameRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();

      // Setup MediaRecorder
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else {
          mimeType = '';
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.start(1000); // 1-second chunks
      setIsRecording(true);
      setIsPaused(false);
      setTimerSeconds(0);

      // Start timer
      timerIntervalRef.current = window.setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      cleanupAudio();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError(
          'Microphone permission was denied. Please allow microphone access in your browser settings to record meetings.'
        );
      } else {
        setError(err.message || 'Could not start recording. Please check your microphone.');
      }
    }
  };

  // Pause / Resume
  const togglePause = () => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      timerIntervalRef.current = window.setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  // Stop Recording and Process
  const stopRecordingAndTranscribe = () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

    const recorder = mediaRecorderRef.current;
    const finalSeconds = timerSeconds;

    recorder.onstop = async () => {
      cleanupAudio();
      setIsRecording(false);
      setIsPaused(false);

      const mimeType = recorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

      if (audioBlob.size < 1000 && finalSeconds < 2) {
        setError('Recording was too short. Please speak for at least 3 seconds.');
        return;
      }

      await processAudioBlob(audioBlob, finalSeconds, mimeType);
    };

    recorder.stop();
  };

  // Handle uploaded audio file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploadedFileName(file.name);

    // Approximate duration or load audio element to get duration
    let duration = 60;
    try {
      const audio = new Audio();
      audio.src = URL.createObjectURL(file);
      await new Promise((resolve) => {
        audio.onloadedmetadata = () => {
          if (audio.duration && !isNaN(audio.duration)) {
            duration = Math.round(audio.duration);
          }
          resolve(true);
        };
        audio.onerror = () => resolve(true);
      });
    } catch {
      duration = 60;
    }

    await processAudioBlob(file, duration, file.type || 'audio/mp3');
  };

  // Process and send audio to Gemini API
  const processAudioBlob = async (blob: Blob, duration: number, mimeType: string) => {
    setIsProcessing(true);
    setError(null);
    setProcessingStage('Encoding audio and preparing AI pipeline...');

    try {
      // Create local object URL for preview playback
      const audioBlobUrl = URL.createObjectURL(blob);

      // Convert Blob to Base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const res = reader.result as string;
          // Extract pure base64 without prefix
          const base64 = res.split(',')[1] || res;
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(blob);

      const base64Audio = await base64Promise;

      setProcessingStage('Gemini AI is transcribing speech and distinguishing speakers...');

      const response = await api.transcribeAudio({
        audioBase64: base64Audio,
        mimeType: mimeType || 'audio/webm',
        durationSeconds: duration,
        meetingContext: meetingContext.trim() || undefined,
        language,
        category,
      });

      setProcessingStage('Finalizing executive summary & action items...');

      const newMeeting: Meeting = {
        id: 'meeting-' + Date.now(),
        userId: isGuest ? null : 'user-current',
        title: response.title || 'Untitled Meeting',
        date: new Date().toISOString(),
        durationSeconds: duration || 60,
        category,
        summary: response.summary,
        topics: response.topics || [],
        decisions: response.decisions || [],
        actionItems: (response.actionItems || []).map((item, idx) => ({
          id: `act-${Date.now()}-${idx}`,
          task: item.task,
          assignee: item.assignee,
          dueDate: item.dueDate,
          completed: false,
        })),
        transcriptSegments: (response.segments || []).map((seg, idx) => ({
          id: `seg-${Date.now()}-${idx}`,
          speaker: seg.speaker || 'Speaker',
          timestamp: seg.timestamp || '00:00',
          text: seg.text,
        })),
        rawTranscript: response.rawTranscript,
        audioUrl: audioBlobUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isGuest,
      };

      onTranscriptionSuccess(newMeeting, audioBlobUrl);
    } catch (err: any) {
      console.error('Transcription error:', err);
      setError(err.message || 'Failed to process audio. Please try again.');
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Intro Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-200/80 rounded-full text-indigo-700 text-xs font-semibold mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Multimodal Gemini Intelligence</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          AI Meeting Secretary
        </h1>
        <p className="text-slate-600 text-sm sm:text-base mt-2 max-w-xl mx-auto">
          Record or upload your meeting audio. Get instant verbatim transcripts with speaker diarization,
          executive summaries, and actionable task lists.
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-sm text-red-700 animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Recording Error</p>
            <p className="mt-0.5 text-xs text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* Processing Overlay State */}
      {isProcessing ? (
        <div className="bg-white rounded-3xl p-10 sm:p-12 border border-indigo-100 shadow-xl text-center flex flex-col items-center justify-center animate-in fade-in">
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 animate-pulse">
              <Sparkles className="w-10 h-10 animate-spin" style={{ animationDuration: '4s' }} />
            </div>
            <div className="absolute -inset-2 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
          </div>

          <h3 className="text-xl font-bold text-slate-900 mb-2">Analyzing Meeting Audio</h3>
          <p className="text-sm text-indigo-700 font-medium mb-4">{processingStage}</p>

          <div className="w-full max-w-md bg-slate-100 rounded-full h-2 overflow-hidden mb-6">
            <div className="bg-gradient-to-r from-indigo-500 to-violet-600 h-full rounded-full animate-pulse w-3/4" />
          </div>

          <p className="text-xs text-slate-500 max-w-sm">
            Gemini is converting speech into clean speaker-labeled segments, synthesizing key decisions,
            and formatting action items.
          </p>
        </div>
      ) : (
        /* Main Recorder Card */
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          {/* Top Options Bar */}
          <div className="bg-slate-50/80 border-b border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Meeting Parameters
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Category Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Type:</span>
                <select
                  disabled={isRecording}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Meeting['category'])}
                  className="text-xs font-medium bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="General">General Sync</option>
                  <option value="Standup">Daily Standup</option>
                  <option value="Executive">Executive Brief</option>
                  <option value="Planning">Sprint Planning</option>
                  <option value="Sales">Sales & Client</option>
                  <option value="1-on-1">1-on-1 Review</option>
                </select>
              </div>

              {/* Language Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Language:</span>
                <select
                  disabled={isRecording}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="text-xs font-medium bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="en">English (US/UK)</option>
                  <option value="auto">Auto-Detect</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="zh">Chinese</option>
                  <option value="ja">Japanese</option>
                </select>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-10 flex flex-col items-center text-center">
            {/* Live Timer & Recording Status */}
            <div className="mb-6 flex flex-col items-center">
              {isRecording ? (
                <div className="flex items-center gap-2 px-3 py-1 bg-red-50 border border-red-200 rounded-full text-red-600 text-xs font-bold animate-pulse mb-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
                  {isPaused ? 'RECORDING PAUSED' : 'LIVE RECORDING IN PROGRESS'}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 border border-slate-200 rounded-full text-slate-600 text-xs font-medium mb-3">
                  <Radio className="w-3.5 h-3.5 text-slate-400" />
                  <span>Microphone Ready</span>
                </div>
              )}

              <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-slate-900">
                {formatTimer(timerSeconds)}
              </div>
            </div>

            {/* Audio Waveform Visualizer */}
            <div className="w-full max-w-lg h-24 bg-slate-900 rounded-2xl p-4 flex items-center justify-center gap-1.5 sm:gap-2 mb-8 shadow-inner overflow-hidden">
              {isRecording ? (
                audioLevels.map((lvl, index) => (
                  <div
                    key={index}
                    className="w-2 sm:w-2.5 rounded-full transition-all duration-75"
                    style={{
                      height: `${isPaused ? 8 : lvl}%`,
                      backgroundColor: isPaused
                        ? '#64748b'
                        : `hsl(${245 + index * 3}, 85%, ${55 + (lvl / 100) * 20}%)`,
                    }}
                  />
                ))
              ) : (
                <div className="flex items-center gap-2 text-slate-400 text-xs">
                  <Volume2 className="w-4 h-4 text-slate-500 animate-pulse" />
                  <span>Click Start Recording to initialize audio stream</span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-center gap-4 mb-6">
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold text-base sm:text-lg rounded-2xl shadow-xl shadow-indigo-200 hover:scale-105 active:scale-95 transition-all flex items-center gap-3 cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                    <Mic className="w-4 h-4 text-white" />
                  </div>
                  <span>Start Recording</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={togglePause}
                    className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-2xl transition-all flex items-center gap-2 cursor-pointer shadow-xs"
                  >
                    {isPaused ? (
                      <>
                        <Play className="w-4 h-4 text-emerald-600" />
                        <span>Resume</span>
                      </>
                    ) : (
                      <>
                        <Pause className="w-4 h-4 text-amber-600" />
                        <span>Pause</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={stopRecordingAndTranscribe}
                    className="px-8 py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl shadow-lg shadow-red-200 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-white" />
                    <span>Stop & Transcribe</span>
                  </button>
                </>
              )}
            </div>

            {/* Optional Meeting Context */}
            <div className="w-full max-w-lg mb-8">
              <input
                type="text"
                disabled={isRecording}
                value={meetingContext}
                onChange={(e) => setMeetingContext(e.target.value)}
                placeholder="Optional context (e.g. Project Apollo sprint review, key attendees: Sarah, Dan)"
                className="w-full text-xs text-slate-700 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all text-center"
              />
            </div>

            {/* Alternative: Audio File Upload */}
            {!isRecording && (
              <div className="pt-6 border-t border-slate-100 w-full max-w-lg">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.aac"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3 px-4 border border-dashed border-slate-300 hover:border-indigo-400 rounded-2xl text-xs font-semibold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all flex items-center justify-center gap-2 group cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  <span>Already have an audio file? Click to upload (.mp3, .wav, .m4a, .webm)</span>
                </button>
                {uploadedFileName && (
                  <p className="mt-2 text-xs text-slate-500 flex items-center justify-center gap-1">
                    <FileAudio className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Selected: {uploadedFileName}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Guest Mode Explanatory Card */}
      {isGuest && (
        <div className="mt-8 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-950">Guest Mode is Active</h4>
              <p className="text-xs text-amber-800 mt-0.5">
                Feel free to test full transcription and exports! Transcripts are kept in your browser tab
                temporarily. Sign in to unlock permanent cloud storage and past meetings search.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenAuth}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-xl shadow-xs shrink-0 cursor-pointer"
          >
            Create Free Account
          </button>
        </div>
      )}
    </div>
  );
};
