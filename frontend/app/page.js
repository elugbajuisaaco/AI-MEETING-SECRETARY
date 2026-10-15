'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, CircleHelp, Download, FileText, LayoutDashboard, LogIn, LogOut, Mic, Pause, Play, Plus, Save, Search, Sparkles, Square, Trash2, Upload, Volume2, X, ChevronDown } from 'lucide-react';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

const categories = ['General', 'Standup', 'Executive', 'Planning', 'Sales', '1-on-1'];
const blankMeeting = () => ({ id: `local_${Date.now()}`, title: 'Untitled Meeting', date: new Date().toISOString(), durationSeconds: 0, category: 'General', summary: '', topics: [], decisions: [], actionItems: [], transcriptSegments: [], rawTranscript: '', isGuest: true });

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const res = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || 'Request failed');
  return data;
}

function durationLabel(seconds) {
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (!minutes) return `${remainder} second${remainder === 1 ? '' : 's'}`;
  if (!remainder) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${remainder} seconds`;
}

function sizeLabel(bytes) {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function meetingMarkdown(m) {
  return `# ${m.title}\n\n${new Date(m.date).toLocaleString()} Â· ${m.category}\n\n## Summary\n${m.summary}\n\n## Topics\n${(m.topics || []).map(x => `- ${x}`).join('\n')}\n\n## Decisions\n${(m.decisions || []).map(x => `- ${x}`).join('\n')}\n\n## Actions\n${(m.actionItems || []).map(x => `- [${x.completed ? 'x' : ' '}] ${x.task} â€” ${x.assignee || 'Team'} â€” ${x.dueDate || 'No due date'}`).join('\n')}\n\n## Transcript\n${(m.transcriptSegments || []).map(x => `**[${x.timestamp}] ${x.speaker}:** ${x.text}`).join('\n\n') || m.rawTranscript}`;
}

function AuthDialog({ onClose, onAuth }) {
  const [mode, setMode] = useState('signin'); const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [canResend, setCanResend] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(`/api/auth/${mode === 'signin' ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) });
      if (mode === 'signup') setMessage(result.message || 'Check your email for a verification link.');
      else onAuth(result.user);
    } catch (err) { setError(err.message); setCanResend(mode === 'signin' && err.message.includes('Verify your email')); } finally { setBusy(false); }
  }
  async function resendVerification() {
    setBusy(true); setError('');
    try { const result = await request('/api/auth/verification/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); setMessage(result.message); setCanResend(false); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="shade"><section className="dialog"><button className="close" onClick={onClose}><X size={18}/></button><h2>{mode === 'signin' ? 'Sign in' : 'Create account'}</h2><p className="muted">Use a unique password with at least 12 characters.</p>{error && <p className="error" role="alert">{error}</p>}{message && <p className="successMessage" role="status">{message}</p>}{!message&&<form onSubmit={submit} className="stack">{mode === 'signup' && <input required placeholder="Full name" value={name} onChange={e => setName(e.target.value)}/>}<input required type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)}/><input required minLength={mode === 'signup' ? 12 : 1} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}/><button className="primary" disabled={busy}>{busy ? 'Please wait?' : mode === 'signin' ? 'Sign in' : 'Create account'}</button></form>}{canResend&&<button className="textButton" disabled={busy} onClick={resendVerification}>Resend verification email</button>}{mode==='signin'&&<Link className="textButton" href="/forgot-password">Forgot your password?</Link>}<button className="textButton" onClick={() => {setMode(mode === 'signin' ? 'signup' : 'signin');setError('');setMessage('');setCanResend(false)}}>{mode === 'signin' ? 'Need an account? Create one' : 'Already registered? Sign in'}</button><button className="textButton" onClick={onClose}>Continue as guest</button></section></div>;
}
export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null); const [authLoaded, setAuthLoaded] = useState(false); const [authOpen, setAuthOpen] = useState(false); const [view, setView] = useState('record'); const [meeting, setMeeting] = useState(null); const [meetings, setMeetings] = useState([]); const [notice, setNotice] = useState(''); const [err, setErr] = useState('');
  const [category, setCategory] = useState('General'); const [language, setLanguage] = useState('en'); const [context, setContext] = useState(''); const [busy, setBusy] = useState(false); const [processing, setProcessing] = useState(''); const [seconds, setSeconds] = useState(0); const [recording, setRecording] = useState(false); const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState(''); const [selectedCategory, setSelectedCategory] = useState('All'); const [tab, setTab] = useState('summary'); const [transcriptFilter, setTranscriptFilter] = useState(''); const [emailDraft, setEmailDraft] = useState(''); const pendingSave = useRef(false);
  const [pendingAudio, setPendingAudio] = useState(null); const [transcribing, setTranscribing] = useState({}); const [transcribeErrors, setTranscribeErrors] = useState({}); const pendingAudioAction = useRef(null);
  const [consentOpen, setConsentOpen] = useState(false); const [consentChecked, setConsentChecked] = useState(false);
  const [uploadLimits, setUploadLimits] = useState({ maxBytes: 20 * 1024 * 1024, maxDurationSeconds: 7200 });
  const recorder = useRef(null); const chunks = useRef([]); const streamRef = useRef(null); const timerRef = useRef(null); const secondsRef = useRef(0); const fileRef = useRef(null); const audioUrl = useRef(null);
  useEffect(() => { request('/api/auth/me').then(x => setUser(x.user)).catch(() => {}).finally(() => setAuthLoaded(true)); if (window.location.search.includes('view=dashboard')) setView('dashboard'); return () => { clearInterval(timerRef.current); streamRef.current?.getTracks().forEach(t => t.stop()); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); }; }, []);
  useEffect(() => { if (user) request('/api/meetings').then(setMeetings).catch(e => setErr(e.message)); else setMeetings([]); }, [user]);
  useEffect(() => { request('/api/upload-limits').then(setUploadLimits).catch(() => {}); }, []);
  useEffect(() => {
    if (!user || !meetings.some(m => m.status === 'processing')) return;
    const timer = setInterval(() => request('/api/meetings').then(next => {
      setMeetings(next);
      setMeeting(current => { const fresh = current && next.find(m => m.id === current.id); return fresh ? { ...fresh, audioUrl: current.audioUrl, audioDownloadUrl: current.audioDownloadUrl } : current; });
    }).catch(() => {}), 2500);
    return () => clearInterval(timer);
  }, [user, meetings]);
  const filteredMeetings = useMemo(() => meetings.filter(m => (selectedCategory==='All'||m.category===selectedCategory) && `${m.title} ${m.summary} ${(m.topics || []).join(' ')} ${(m.actionItems || []).map(a=>a.task).join(' ')}`.toLowerCase().includes(search.toLowerCase())), [meetings, search, selectedCategory]);
  function patchMeeting(patch) { setMeeting(m => ({ ...m, ...patch })); }
  function stopTracks() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  function setAudioForReview(blob, duration, mimeType) {
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = URL.createObjectURL(blob);
    setPendingAudio({ blob, duration, mimeType: mimeType || blob.type || 'audio/webm', url: audioUrl.current });
    setErr('');
  }
  async function startRecording() {
    if (!localStorage.getItem('meetingSecretaryRecordingConsentV1')) { setConsentChecked(false); setConsentOpen(true); return; }
    await beginRecording();
  }
  async function beginRecording() {
    setErr(''); try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true } }); streamRef.current = stream;
      const type = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x => MediaRecorder.isTypeSupported(x));
      const instance = new MediaRecorder(stream, type ? { mimeType:type } : undefined); recorder.current = instance; chunks.current = [];
      instance.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      instance.onstop = () => { stopTracks(); setRecording(false); setPaused(false); setAudioForReview(new Blob(chunks.current, { type: instance.mimeType || 'audio/webm' }), secondsRef.current, instance.mimeType || 'audio/webm'); };
      instance.start(1000); setRecording(true); setPaused(false); secondsRef.current=0; setSeconds(0); timerRef.current = setInterval(() => setSeconds(s => {secondsRef.current=s+1;return s+1}),1000);
    } catch (e) { setErr(e.message || 'Microphone permission is required.'); stopTracks(); }
  }
  function acceptRecordingConsent() {
    if (!consentChecked) return;
    localStorage.setItem('meetingSecretaryRecordingConsentV1', 'accepted');
    setConsentOpen(false);
    beginRecording();
  }
  function stopRecording() { if (!recorder.current || !recording) return; clearInterval(timerRef.current); recorder.current.stop(); }
  function togglePause() { if (!recorder.current) return; if (paused) { recorder.current.resume(); timerRef.current = setInterval(() => setSeconds(s=>{secondsRef.current=s+1;return s+1}),1000); } else { recorder.current.pause(); clearInterval(timerRef.current); } setPaused(!paused); }
  async function uploadFile(file) {
    if (!file) return;
    if (file.size > uploadLimits.maxBytes) { setErr(`This file exceeds the ${sizeLabel(uploadLimits.maxBytes)} upload limit.`); return; }
    const extension = file.name.split('.').pop().toLowerCase();
    const types = { mp4:'video/mp4', mov:'video/quicktime', mkv:'video/x-matroska', webm:'video/webm', mp3:'audio/mpeg', wav:'audio/wav', m4a:'audio/mp4', ogg:'audio/ogg', aac:'audio/aac' };
    const browserType = file.type || '';
    const mimeType = browserType.startsWith('audio/') || browserType.startsWith('video/') ? browserType : types[extension] || browserType;
    if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) { setErr('Choose an audio or video file.'); return; }
    let duration = 0;
    const url = URL.createObjectURL(file);
    const media = mimeType.startsWith('video/') ? document.createElement('video') : new Audio();
    media.src = url;
    await new Promise(resolve => { media.onloadedmetadata=()=>{if(Number.isFinite(media.duration)) duration=Math.round(media.duration);resolve();}; media.onerror=resolve; });
    URL.revokeObjectURL(url);
    if (duration > uploadLimits.maxDurationSeconds) {
      setErr(`This recording exceeds the ${durationLabel(uploadLimits.maxDurationSeconds)} duration limit.`);
      return;
    }
    setAudioForReview(file, duration, mimeType);
  }
  async function saveAudio(transcribeNow, authenticated = false) {
    if (!pendingAudio) return;
    if (!user && !authenticated) { pendingAudioAction.current = transcribeNow; setAuthOpen(true); return; }
    setBusy(true); setErr(''); setProcessing(transcribeNow ? 'Saving audio and starting transcriptionâ€¦' : 'Saving your audioâ€¦');
    try {
      const bytes = new Uint8Array(await pendingAudio.blob.arrayBuffer()); let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const body = { title: 'Untitled Meeting', date: new Date().toISOString(), durationSeconds: pendingAudio.duration, category, audioBase64: btoa(binary), mimeType: pendingAudio.mimeType, transcribe_now: transcribeNow, language, meetingContext: context };
      const saved = await request('/api/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setPendingAudio(null);
      const next = { ...saved, audioUrl: pendingAudio.url, isGuest: false };
      if (saved.audioAvailable) {
        try { const urls = await request(`/api/meetings/${saved.id}/audio-url`); next.audioDownloadUrl = urls.downloadUrl; }
        catch (e) { setErr(`Audio was saved, but its playback link could not be created: ${e.message}`); }
      }
      setMeeting(next); setMeetings(current => [next, ...current.filter(m => m.id !== next.id)]); setView('editor'); setTab('summary');
      setNotice(transcribeNow ? 'Audio saved. Transcription started.' : 'Audio saved. You can transcribe it later from Saved meetings.');
    } catch (e) { setErr(`Could not save audio: ${e.message}`); }
    finally { setBusy(false); setProcessing(''); }
  }
  async function startTranscription(id) {
    setTranscribing(current => ({ ...current, [id]: true })); setTranscribeErrors(current => ({ ...current, [id]: '' }));
    try {
      await request(`/api/meetings/${id}/transcribe`, { method: 'POST' });
      setMeetings(current => current.map(m => m.id === id ? { ...m, status: 'processing' } : m));
      setMeeting(current => current?.id === id ? { ...current, status: 'processing' } : current);
    } catch (e) { setTranscribeErrors(current => ({ ...current, [id]: e.message })); }
    finally { setTranscribing(current => ({ ...current, [id]: false })); }
  }
  async function openMeeting(item) {
    setMeeting({ ...item, isGuest: false, audioUrl: null, audioDownloadUrl: null });
    setView('editor'); setTab('summary'); setErr('');
    if (item.audioAvailable) {
      try {
        const urls = await request(`/api/meetings/${item.id}/audio-url`);
        setMeeting(current => current?.id === item.id ? { ...current, audioUrl: urls.playbackUrl, audioDownloadUrl: urls.downloadUrl } : current);
      } catch (e) { setErr(`Could not load the saved recording: ${e.message}`); }
    }
  }
  async function saveMeeting() {
    if (!user) { pendingSave.current = true; setAuthOpen(true); return; }
    setNotice(''); setErr(''); try { const body = { title:meeting.title, date:meeting.date, durationSeconds:meeting.durationSeconds, category:meeting.category, summary:meeting.summary, topics:meeting.topics, decisions:meeting.decisions, actionItems:meeting.actionItems, transcriptSegments:meeting.transcriptSegments, rawTranscript:meeting.rawTranscript }; const saved = meeting.id.startsWith('local_') ? await request('/api/meetings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}) : await request(`/api/meetings/${meeting.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); setMeeting({...saved,audioUrl:meeting.audioUrl,audioDownloadUrl:meeting.audioDownloadUrl}); setMeetings(ms=>[saved,...ms.filter(x=>x.id!==saved.id)]); setNotice('Meeting saved to your account.'); } catch(e) { setErr(`Could not save meeting: ${e.message}`); }
  }
  async function refine(instruction) { setBusy(true); setErr(''); try { const result=await request('/api/ai/refine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({meeting,instruction})}); if (instruction.toLowerCase().includes('email')) {setEmailDraft(result.summary || '');setTab('email');} else patchMeeting(result); } catch(e){setErr(e.message);} finally{setBusy(false);} }
  function exportMarkdown() { saveBlob(new Blob([meetingMarkdown(meeting)],{type:'text/markdown'}),`${meeting.title.replace(/[^a-z0-9_-]+/gi,'_')}.md`); }
  async function exportWord() {
    const children = [new Paragraph({ text: meeting.title, heading: HeadingLevel.TITLE }), new Paragraph({ text: `${new Date(meeting.date).toLocaleString()} Â· ${meeting.category} Â· ${fmt(meeting.durationSeconds)}` }), new Paragraph({ text: 'Executive Summary', heading: HeadingLevel.HEADING_1 }), new Paragraph(meeting.summary || 'No summary available.'), new Paragraph({ text: 'Topics', heading: HeadingLevel.HEADING_1 }), ...(meeting.topics || []).map(x=>new Paragraph({text:x,bullet:{indent:360}})), new Paragraph({text:'Decisions',heading:HeadingLevel.HEADING_1}), ...(meeting.decisions || []).map(x=>new Paragraph({text:x,bullet:{indent:360}})), new Paragraph({text:'Action Items',heading:HeadingLevel.HEADING_1}), ...(meeting.actionItems || []).map(x=>new Paragraph({children:[new TextRun({text:`[${x.completed?'DONE':'TODO'}] `,bold:true}),new TextRun(`${x.task} Â· ${x.assignee||'Team'} Â· ${x.dueDate||'No due date'}`)]})), new Paragraph({text:'Transcript',heading:HeadingLevel.HEADING_1}), ...(meeting.transcriptSegments || []).map(x=>new Paragraph({children:[new TextRun({text:`[${x.timestamp}] ${x.speaker}: `,bold:true}),new TextRun(x.text)]}))];
    const blob = await Packer.toBlob(new Document({sections:[{children}]}));
    saveBlob(blob,`${meeting.title.replace(/[^a-z0-9_-]+/gi,'_')}.docx`);
  }
  function exportPdf() { const w=window.open('','_blank'); if(!w){setErr('Allow pop-ups to print or save PDF.');return;} w.document.write(`<title>${escapeHtml(meeting.title)}</title><style>body{font:14px Arial;max-width:800px;margin:40px auto;line-height:1.5}h1,h2{color:#202b45}article{white-space:pre-wrap}</style><h1>${escapeHtml(meeting.title)}</h1><p>${escapeHtml(meeting.date)} Â· ${escapeHtml(meeting.category)}</p><h2>Summary</h2><article>${escapeHtml(meeting.summary)}</article><h2>Topics</h2><ul>${meeting.topics.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul><h2>Decisions</h2><ul>${meeting.decisions.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul><h2>Action items</h2><ul>${meeting.actionItems.map(x=>`<li>${escapeHtml(x.task)} â€” ${escapeHtml(x.assignee)} â€” ${escapeHtml(x.dueDate)}</li>`).join('')}</ul><h2>Transcript</h2>${meeting.transcriptSegments.map(x=>`<p><b>[${escapeHtml(x.timestamp)}] ${escapeHtml(x.speaker)}:</b> ${escapeHtml(x.text)}</p>`).join('')}`);w.document.close();w.focus();w.print(); }
  async function deleteMeeting(id) { if(!confirm('Delete this meeting permanently?'))return; try { await request(`/api/meetings/${id}`,{method:'DELETE'});setMeetings(ms=>ms.filter(m=>m.id!==id)); } catch(e){setErr(e.message);} }
  async function logout() { try { await request('/api/auth/logout',{method:'POST'}); } finally { setUser(null); setView('record'); router.replace('/'); } }
  async function deleteAccount() {
    if (!confirm('Delete your account and all saved meetings and recordings permanently?')) return;
    try {
      await request('/api/auth/account', { method: 'DELETE' });
      setUser(null); setMeetings([]); setMeeting(null); setView('record');
      router.replace('/'); setNotice('Your account and associated data were deleted.');
    } catch (e) { setErr(`Could not delete your account: ${e.message}`); }
  }
  function updateAction(id, values) { patchMeeting({actionItems:meeting.actionItems.map(x=>x.id===id?{...x,...values}:x)}); }
  function addAction() { patchMeeting({actionItems:[...meeting.actionItems,{id:`act_${Date.now()}`,task:'New follow-up task',assignee:'',dueDate:'',completed:false}]}); }
  const fmt = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  const visibleTranscriptSegments = meeting?.transcriptSegments
    .map((segment, index) => ({ ...segment, _index: index }))
    .filter(segment => `${segment.speaker} ${segment.text} ${segment.timestamp}`.toLowerCase().includes(transcriptFilter.toLowerCase())) || [];

  return <main className="shell">
    <header className="topbar"><button className="brand" onClick={()=>{setView('record');router.push('/');}}><span className="brandIcon"><Mic/></span><span><b>AI Meeting Secretary</b><small>Transcripts Â· decisions Â· action items</small></span></button><nav><button className={view==='record'?'selected':''} onClick={()=>{setView('record');router.push('/');}}><Mic size={16}/> Record</button>{meeting&&<button className={view==='editor'?'selected':''} onClick={()=>setView('editor')}><FileText size={16}/> Transcript</button>}{authLoaded&&user&&<button className={view==='dashboard'?'selected':''} onClick={()=>router.push('/dashboard')}><LayoutDashboard size={16}/> Dashboard</button>}</nav><div className="userBox">{!authLoaded?<span className="authPlaceholder" aria-label="Checking account"/>:user?<details className="accountMenu"><summary><span className="accountAvatar">{(user.name||user.email||'U').slice(0,1).toUpperCase()}</span><span className="accountName">{user.name||user.email}</span><ChevronDown size={15}/></summary><div className="accountDropdown"><button onClick={()=>router.push('/dashboard')}><LayoutDashboard size={15}/> Dashboard</button><button onClick={logout}><LogOut size={15}/> Sign out</button><button className="accountDelete" onClick={deleteAccount}><Trash2 size={15}/> Delete account</button></div></details>:<div className="authActions"><Link className="outline" href="/login">Log in</Link><Link className="primary" href="/signup">Sign up</Link></div>}</div></header>
    {authLoaded&&!user&&<div className="guestBanner"><CircleHelp size={16}/> Guest sessions are temporary. Sign in to save your meetings. <Link href="/login">Log in</Link></div>}
    {err&&<div className="alert"><span>{err}</span><button onClick={()=>setErr('')}><X size={16}/></button></div>}{notice&&<div className="success"><Check size={16}/>{notice}<button onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {view==='record'&&<section className="mainColumn"><div className="hero"><span className="eyebrow"><Sparkles size={14}/> Meeting intelligence</span><h1>Turn conversations into clear next steps.</h1><p>Record a meeting or upload audio to get a transcript, executive summary, decisions, and action items.</p>{authLoaded&&!user&&<Link className="primary heroCta" href="/signup">Get started free</Link>}</div>
      {busy?<div className="card process"><div className="spinner"/><h2>Analyzing your meeting</h2><p>{processing}</p></div>:<div className="card recorder"><div className="row between"><b>Meeting details</b><label>Category<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(x=><option key={x}>{x}</option>)}</select></label></div><div className="row fields"><label>Language<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="en">English</option><option value="auto">Auto-detect</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="zh">Chinese</option><option value="ja">Japanese</option></select></label><label className="grow">Context<input value={context} onChange={e=>setContext(e.target.value)} placeholder="Project, attendees, or other helpful context"/></label></div>
        <div className="recorderCenter"><div className={`status ${recording?'live':''}`}>{recording?(paused?'Paused':'Recording'): 'Microphone ready'}</div><div className="timer">{fmt(seconds)}</div><div className="wave"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div><div className="row">{!recording?<button className="primary big" onClick={startRecording}><Mic size={19}/> Start recording</button>:<><button className="outline" onClick={togglePause}>{paused?<Play size={17}/>:<Pause size={17}/>} {paused?'Resume':'Pause'}</button><button className="danger" onClick={stopRecording}><Square size={16}/> Stop recording</button></>}</div></div>
        {!recording&&<><div className="divider">or upload audio or video</div><input ref={fileRef} type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.webm,.ogg,.aac,.mp4,.mov,.mkv" hidden onChange={e=>{uploadFile(e.target.files?.[0]);e.target.value='';}}/><button className="upload" onClick={()=>fileRef.current?.click()}><Upload size={18}/> Choose audio or video <small>Maximum {sizeLabel(uploadLimits.maxBytes)} | up to {durationLabel(uploadLimits.maxDurationSeconds)}</small></button></>}
        {pendingAudio&&<div className="audioReview"><div><b>Media ready</b><p className="muted">{fmt(pendingAudio.duration)} · {pendingAudio.mimeType}</p></div>{pendingAudio.mimeType.startsWith('video/')?<video controls src={pendingAudio.url}/>:<audio controls src={pendingAudio.url}/>}<div className="row"><button className="outline" disabled={busy} onClick={()=>saveAudio(false)}><Save size={15}/> Save only</button><button className="primary" disabled={busy} onClick={()=>saveAudio(true)}>{busy?'Saving…':'Save & transcribe'}</button><button className="textButton" disabled={busy} onClick={()=>{URL.revokeObjectURL(pendingAudio.url);audioUrl.current=null;setPendingAudio(null);}}>Discard</button></div></div>}
      </div>}
      <p className="privacyNote"><Volume2 size={15}/> Saved audio is stored on the backend according to its retention setting.</p>
    </section>}
    {view==='editor'&&meeting&&<section className="mainColumn editor"><div className="row between"><button className="textButton" onClick={()=>setView('record')}>â†� Record another meeting</button><div className="row actions"><button className="outline" onClick={exportWord}><Download size={15}/> Word</button><button className="outline" onClick={exportMarkdown}><Download size={15}/> Markdown</button><button className="outline" onClick={exportPdf}><Download size={15}/> PDF / Print</button><button className="primary" onClick={saveMeeting}><Save size={15}/> {user?'Save meeting':'Sign in & save'}</button></div></div>
      <div className="card meetingHead"><input className="titleInput" value={meeting.title} onChange={e=>patchMeeting({title:e.target.value})}/><p className="muted">{new Date(meeting.date).toLocaleString()} Â· {fmt(meeting.durationSeconds)} Â· {meeting.category}{meeting.isGuest?' Â· Guest session':''}</p><span className={`statusBadge ${meeting.status || 'completed'}`}>{meeting.status || 'completed'}</span>{meeting.providerUsed==='groq'&&<small className="providerNote">Transcribed with Groq. Speaker labels may be unavailable.</small>}{meeting.audioUrl&&(meeting.mimeType?.startsWith('video/')?<video controls src={meeting.audioUrl}/>:<audio controls src={meeting.audioUrl}/>)}{meeting.audioDownloadUrl&&<a className="outline downloadAudio" href={meeting.audioDownloadUrl}>Download recording</a>}<div className="row"><button className="outline" disabled={busy || meeting.status==='saved' || meeting.status==='processing'} onClick={()=>refine('Write an executive follow-up email ready to send, with decisions and action items.')}>Draft follow-up email</button><button className="outline" disabled={busy || meeting.status==='saved' || meeting.status==='processing'} onClick={()=>refine('Make the executive summary concise and clear. Preserve facts.')}>{busy?'Workingâ€¦':'AI polish'}</button></div></div>
      {(meeting.status==='saved'||meeting.status==='failed')&&<div className="card empty"><h3>{meeting.status==='saved'?'Not transcribed yet':'Transcription needs another try'}</h3><p>{meeting.status==='saved'?'Your audio is saved. Start transcription when you’re ready.':meeting.error||'The last attempt did not finish. You can retry transcription.'}</p><button className="primary" disabled={transcribing[meeting.id]} onClick={()=>startTranscription(meeting.id)}>{transcribing[meeting.id]?'Starting…':meeting.status==='failed'?'Retry transcription':'Transcribe'}</button>{transcribeErrors[meeting.id]&&<p className="error">{transcribeErrors[meeting.id]}</p>}</div>}
      <div className="tabs">{[['summary','Summary'],['actions',`Action items (${meeting.actionItems.length})`],['transcript',`Transcript (${meeting.transcriptSegments.length})`],...(emailDraft?[['email','Email draft']]:[])].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
      {tab==='summary'&&<div className="grid2"><div className="card"><h3>Executive summary</h3><textarea rows="8" value={meeting.summary} onChange={e=>patchMeeting({summary:e.target.value})}/></div><div className="card"><h3>Topics</h3><ul>{meeting.topics.map((x,i)=><li key={i}>{x}</li>)}</ul><h3>Decisions</h3><ul>{meeting.decisions.map((x,i)=><li key={i}>{x}</li>)}</ul></div></div>}
      {tab==='actions'&&<div className="card"><div className="row between"><div><h3>Action items</h3><p className="muted">Edit or check off meeting follow-ups.</p></div><button className="outline" onClick={addAction}><Plus size={15}/> Add task</button></div>{meeting.actionItems.map(x=><div className="actionRow" key={x.id}><input type="checkbox" checked={!!x.completed} onChange={e=>updateAction(x.id,{completed:e.target.checked})}/><input value={x.task} onChange={e=>updateAction(x.id,{task:e.target.value})}/><input placeholder="Assignee" value={x.assignee||''} onChange={e=>updateAction(x.id,{assignee:e.target.value})}/><input placeholder="Due date" value={x.dueDate||''} onChange={e=>updateAction(x.id,{dueDate:e.target.value})}/><button className="iconButton" onClick={()=>patchMeeting({actionItems:meeting.actionItems.filter(a=>a.id!==x.id)})}><Trash2 size={16}/></button></div>)}</div>}
      {tab==='transcript'&&<div className="card"><div className="row between"><h3>Transcript</h3><label className="search"><Search size={15}/><input placeholder="Search transcript" value={transcriptFilter} onChange={e=>setTranscriptFilter(e.target.value)}/></label></div>{visibleTranscriptSegments.map(x=><article className="segment" key={`segment-${x._index}`}><div className="row"><input className="timestamp" value={x.timestamp} onChange={e=>patchMeeting({transcriptSegments:meeting.transcriptSegments.map((s,i)=>i===x._index?{...s,timestamp:e.target.value}:s)})}/><input className="speaker" value={x.speaker} onChange={e=>patchMeeting({transcriptSegments:meeting.transcriptSegments.map((s,i)=>i===x._index?{...s,speaker:e.target.value}:s)})}/></div><textarea rows="3" value={x.text} onChange={e=>patchMeeting({transcriptSegments:meeting.transcriptSegments.map((s,i)=>i===x._index?{...s,text:e.target.value}:s)})}/></article>)}</div>}
      {tab==='email'&&<div className="card"><h3>Follow-up email</h3><textarea rows="12" value={emailDraft} onChange={e=>setEmailDraft(e.target.value)}/><button className="outline" onClick={()=>navigator.clipboard.writeText(emailDraft)}>Copy email</button></div>}
    </section>}
    {view==='dashboard'&&user&&<section className="mainColumn"><div className="row between"><div><h1>Saved meetings</h1><p className="muted">Your meeting notes are stored in your database.</p></div><div className="row"><label className="search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search meetings"/></label><select aria-label="Filter by category" value={selectedCategory} onChange={e=>setSelectedCategory(e.target.value)}>{['All',...categories].map(x=><option key={x}>{x}</option>)}</select></div></div>{filteredMeetings.length===0?<div className="card empty">No saved meetings match these filters. Record a meeting and save it here.</div>:<div className="meetingList">{filteredMeetings.map(m=><article className="card meetingCard" key={m.id}><button className="meetingOpen" onClick={()=>openMeeting(m)}><h3>{m.title}</h3><span className={`statusBadge ${m.status || 'completed'}`}>{m.status || 'completed'}</span><p className="muted">{new Date(m.date).toLocaleString()} · {m.category} · {fmt(m.durationSeconds)}</p><p>{m.summary || (m.status==='saved'?'Audio saved. Not transcribed yet.':'No summary available.')}</p><small>{m.actionItems?.length||0} action items</small></button><div className="row">{(m.status==='saved'||m.status==='failed')&&<button className="primary" disabled={transcribing[m.id]} onClick={()=>startTranscription(m.id)}>{transcribing[m.id]?'Starting…':'Transcribe'}</button>}<button className="outline" onClick={()=>openMeeting(m)}><FileText size={15}/> Open</button><button className="iconButton" title="Delete meeting" onClick={()=>deleteMeeting(m.id)}><Trash2 size={16}/></button></div>{(transcribeErrors[m.id]||m.error)&&<p className="error">{transcribeErrors[m.id]||m.error}</p>}</article>)}</div>}</section>}
    <footer>AI Meeting Secretary Â· Audio is processed by your selected AI provider.</footer>
    {consentOpen&&<div className="shade"><section className="dialog consentDialog" role="dialog" aria-modal="true" aria-labelledby="record-consent-title"><h2 id="record-consent-title">Before you record</h2><p className="muted">Make sure everyone in the meeting agrees to be recorded. If you save and transcribe this recording, the audio is stored according to the retention setting and may be sent to the configured AI provider to create notes.</p><label className="consentCheck"><input type="checkbox" checked={consentChecked} onChange={e=>setConsentChecked(e.target.checked)}/> I have permission to record the people in this meeting.</label><div className="row"><button className="outline" onClick={()=>setConsentOpen(false)}>Cancel</button><button className="primary" disabled={!consentChecked} onClick={acceptRecordingConsent}>Continue to microphone</button></div></section></div>}
    {authOpen&&<AuthDialog onClose={()=>{pendingSave.current=false;setAuthOpen(false)}} onAuth={async next=>{setUser(next);setAuthOpen(false);setNotice('Signed in successfully.');if(pendingAudioAction.current!==null){const action=pendingAudioAction.current;pendingAudioAction.current=null;await saveAudio(action,true);}if(pendingSave.current&&meeting){pendingSave.current=false;try{const body={title:meeting.title,date:meeting.date,durationSeconds:meeting.durationSeconds,category:meeting.category,summary:meeting.summary,topics:meeting.topics,decisions:meeting.decisions,actionItems:meeting.actionItems,transcriptSegments:meeting.transcriptSegments,rawTranscript:meeting.rawTranscript};const saved=await request('/api/meetings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});setMeeting({...saved,audioUrl:meeting.audioUrl,isGuest:false});setMeetings(ms=>[saved,...ms.filter(x=>x.id!==saved.id)]);setNotice('Meeting saved to your account.')}catch(e){setErr(`Sign-in succeeded, but the meeting could not be saved: ${e.message}`)}}}}/>}
  </main>;
}

function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
