import { useState, useEffect, useRef, useCallback } from 'react';

interface CallModalProps {
  type: 'voice' | 'video';
  contactName: string;
  contactInitials: string;
  contactColor: string;
  isOpen: boolean;
  onClose: () => void;
  onCallEnd?: (callType: 'voice' | 'video', duration: number) => void;
}

interface CallChatMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  time: string;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatDurationShort(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} sec`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} sec`;
}

export default function CallModal({ type, contactName, contactInitials, contactColor, isOpen, onClose, onCallEnd }: CallModalProps) {
  const [callState, setCallState] = useState<'connecting' | 'connected' | 'rating'>('connecting');
  const [callDuration, setCallDuration] = useState(0);
  const [timerInterval, setTimerInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  // Media
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);

  // In-call chat
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<CallChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  // Rating
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start call — request media
  const startMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
      });
      setLocalStream(stream);
      // Simulate connection delay then connect
      connectTimerRef.current = setTimeout(() => {
        setCallState('connected');
        const interval = setInterval(() => {
          setCallDuration(prev => prev + 1);
        }, 1000);
        setTimerInterval(interval);
      }, 1800);
      return stream;
    } catch {
      // Permission denied — still connect with simulated call
      connectTimerRef.current = setTimeout(() => {
        setCallState('connected');
        const interval = setInterval(() => {
          setCallDuration(prev => prev + 1);
        }, 1000);
        setTimerInterval(interval);
      }, 1800);
      return null;
    }
  }, [type]);

  // Attach local stream to self video — critical fix: depends on cameraOff so re-attachment happens when element becomes visible
  useEffect(() => {
    const videoEl = selfVideoRef.current;
    if (videoEl && localStream) {
      videoEl.srcObject = localStream;
      videoEl.play().catch(() => {});
    }
  }, [localStream, cameraOff]);

  // Attach screen stream to screen video
  useEffect(() => {
    const videoEl = screenVideoRef.current;
    if (videoEl && screenStream) {
      videoEl.srcObject = screenStream;
      videoEl.play().catch(() => {});
    }
  }, [screenStream]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setCallState('connecting');
      setCallDuration(0);
      setMuted(false);
      setCameraOff(false);
      setSpeakerOn(true);
      setIsScreenSharing(false);
      setShowChat(false);
      setChatMessages([]);
      setChatInput('');
      setRating(0);
      setHoverRating(0);
      setRatingSubmitted(false);
      setLocalStream(null);
      setScreenStream(null);
      const streamPromise = startMedia();
      return () => {
        if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
        streamPromise.then(stream => {
          if (stream) stream.getTracks().forEach(t => t.stop());
        });
      };
    }
    return undefined;
  }, [isOpen, startMedia]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerInterval) clearInterval(timerInterval);
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    };
  }, [timerInterval]);

  const handleEndCall = useCallback(() => {
    if (timerInterval) clearInterval(timerInterval);
    setTimerInterval(null);
    // Stop all media
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      setLocalStream(null);
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
    }
    // Notify parent of call duration for chat log
    if (onCallEnd && callDuration > 0) {
      onCallEnd(type, callDuration);
    }
    setCallState('rating');
  }, [timerInterval, localStream, screenStream, onCallEnd, type, callDuration]);

  const handleSubmitRating = useCallback(() => {
    setRatingSubmitted(true);
    setTimeout(() => {
      onClose();
    }, 1500);
  }, [onClose]);

  const handleSkipRating = useCallback(() => {
    onClose();
  }, [onClose]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const newVal = !prev;
      if (localStream) {
        localStream.getAudioTracks().forEach(t => { t.enabled = !newVal; });
      }
      return newVal;
    });
  }, [localStream]);

  // Toggle camera
  const toggleCamera = useCallback(() => {
    setCameraOff(prev => {
      const newVal = !prev;
      if (localStream) {
        localStream.getVideoTracks().forEach(t => { t.enabled = !newVal; });
      }
      return newVal;
    });
  }, [localStream]);

  // Toggle screen sharing
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        setScreenStream(null);
      }
      setIsScreenSharing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setScreenStream(stream);
        setIsScreenSharing(true);
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          setScreenStream(null);
          setIsScreenSharing(false);
        });
      } catch {
        // User cancelled screen share picker
      }
    }
  }, [isScreenSharing, screenStream]);

  // In-call chat send
  const sendChatMessage = useCallback(() => {
    if (!chatInput.trim()) return;
    const now = new Date();
    const msg: CallChatMessage = {
      id: `cc-${Date.now()}`,
      from: 'me',
      text: chatInput.trim(),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages(prev => [...prev, msg]);
    setChatInput('');
    // Simulate reply after a short delay
    setTimeout(() => {
      const replyMsgs = [
        'Got it, thanks!',
        'Sure, one moment',
        'Let me check that',
        'Agreed!',
        'Can you share your screen?',
        'That sounds good',
      ];
      const reply: CallChatMessage = {
        id: `cc-${Date.now()}-r`,
        from: 'them',
        text: replyMsgs[Math.floor(Math.random() * replyMsgs.length)],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages(prev => [...prev, reply]);
    }, 2000 + Math.random() * 2000);
  }, [chatInput]);

  if (!isOpen) return null;

  const hasCamera = localStream && localStream.getVideoTracks().length > 0 && !cameraOff;
  const hasScreen = isScreenSharing && screenStream;

  return (
    <div className="fixed inset-0 z-[110] flex bg-foreground-950">
      {/* Main call area */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${showChat ? 'mr-[340px]' : ''}`}>
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 bg-foreground-900/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={handleEndCall}
              className="w-8 h-8 rounded-lg bg-foreground-800 flex items-center justify-center text-foreground-300 hover:text-foreground-100 hover:bg-foreground-700 transition-smooth cursor-pointer"
              title="End call"
            >
              <i className="ri-arrow-left-line text-sm"></i>
            </button>
            <div>
              <p className="text-sm font-semibold text-foreground-100">{contactName}</p>
              <p className="text-xs text-foreground-400">
                {callState === 'connecting' ? 'Connecting...' : callState === 'connected' ? formatDuration(callDuration) : 'Call ended'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {callState === 'connected' && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span className="text-xs text-emerald-400 font-medium">Connected</span>
              </span>
            )}
            <button
              onClick={() => setShowChat(prev => !prev)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${
                showChat ? 'bg-primary-500 text-white' : 'bg-foreground-800 text-foreground-300 hover:text-foreground-100 hover:bg-foreground-700'
              }`}
              title="Toggle chat"
            >
              <i className="ri-chat-3-line text-sm"></i>
            </button>
          </div>
        </div>

        {/* Call content */}
        <div className="flex-1 relative flex items-center justify-center bg-foreground-950 overflow-hidden">
          {callState === 'connecting' && (
            <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in-95 duration-500">
              <div className={`w-28 h-28 rounded-full flex items-center justify-center text-3xl font-bold ${contactColor} ring-4 ring-foreground-800 shadow-2xl`}>
                {contactInitials}
              </div>
              <div className="text-center">
                <h2 className="text-xl font-heading font-semibold text-foreground-100 mb-2">{contactName}</h2>
                <p className="text-sm text-foreground-400">Calling{type === 'video' ? ' with video' : ''}...</p>
              </div>
              <div className="flex items-center gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: `${i * 0.2}s` }}></div>
                ))}
              </div>
              <button
                onClick={handleEndCall}
                className="mt-4 w-14 h-14 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition-smooth cursor-pointer shadow-lg shadow-red-500/25"
                title="Cancel call"
              >
                <i className="ri-phone-fill text-xl rotate-[135deg]"></i>
              </button>
            </div>
          )}

          {callState === 'rating' && (
            <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-300 max-w-sm w-full px-6">
              {ratingSubmitted ? (
                <div className="flex flex-col items-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                    <i className="ri-check-line text-4xl text-emerald-400"></i>
                  </div>
                  <h3 className="text-xl font-heading font-semibold text-foreground-100">Thank you!</h3>
                  <p className="text-sm text-foreground-400 mt-2">Your feedback helps us improve</p>
                </div>
              ) : (
                <>
                  <div className="w-20 h-20 rounded-full bg-foreground-800 flex items-center justify-center">
                    <i className="ri-phone-fill text-3xl text-foreground-400 rotate-[135deg]"></i>
                  </div>
                  <h3 className="text-lg font-heading font-semibold text-foreground-100">Call ended</h3>
                  <p className="text-sm text-foreground-400">{formatDuration(callDuration)} · {contactName}</p>

                  <div className="mt-4 w-full">
                    <p className="text-sm text-foreground-300 font-medium text-center mb-3">How was the call quality?</p>
                    <div className="flex items-center justify-center gap-3">
                      {[1, 2, 3, 4, 5].map(star => (
                        <button
                          key={star}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          onClick={() => setRating(star)}
                          className="w-12 h-12 flex items-center justify-center transition-smooth cursor-pointer"
                        >
                          <i className={`${star <= (hoverRating || rating) ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-500'} text-2xl`}></i>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-foreground-500 text-center mt-2">
                      {rating === 1 && 'Poor'}
                      {rating === 2 && 'Fair'}
                      {rating === 3 && 'Good'}
                      {rating === 4 && 'Very good'}
                      {rating === 5 && 'Excellent'}
                      {rating === 0 && 'Tap a star to rate'}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 w-full mt-4">
                    <button
                      onClick={handleSkipRating}
                      className="flex-1 py-3 rounded-xl border border-foreground-700 text-sm text-foreground-300 hover:bg-foreground-800 transition-smooth cursor-pointer"
                    >
                      Skip
                    </button>
                    <button
                      onClick={handleSubmitRating}
                      disabled={rating === 0}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium transition-smooth cursor-pointer ${
                        rating > 0
                          ? 'bg-primary-500 text-white hover:bg-primary-600'
                          : 'bg-foreground-800 text-foreground-500 cursor-not-allowed'
                      }`}
                    >
                      Submit
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {callState === 'connected' && (
            <>
              {/* Screen share takes over when active */}
              {hasScreen ? (
                <div className="absolute inset-0 bg-foreground-950 flex items-center justify-center">
                  <video ref={screenVideoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
                  {/* Self-view PIP over screen share */}
                  {hasCamera && (
                    <div className="absolute bottom-24 right-6 w-48 h-36 rounded-xl overflow-hidden border-2 border-foreground-700 shadow-2xl bg-foreground-900">
                      <video ref={selfVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="absolute top-4 left-4 bg-foreground-900/80 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-foreground-700/50">
                    <p className="text-xs text-foreground-200 font-medium flex items-center gap-1.5">
                      <i className="ri-computer-line text-emerald-400"></i>
                      Sharing your screen
                    </p>
                  </div>
                </div>
              ) : type === 'video' ? (
                /* Video call — main area + self-view PIP */
                <div className="absolute inset-0 flex items-center justify-center">
                  {/* Remote participant simulated */}
                  <div className="absolute inset-0 bg-gradient-to-br from-foreground-900 to-foreground-950 flex items-center justify-center">
                    {cameraOff && !hasCamera ? (
                      /* Both cameras off — show both avatars */
                      <div className="flex items-center gap-12">
                        <div className="flex flex-col items-center gap-3">
                          <div className={`w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold ${contactColor} ring-4 ring-foreground-800`}>
                            {contactInitials}
                          </div>
                          <p className="text-sm text-foreground-300">{contactName}</p>
                        </div>
                        <div className="text-foreground-600">
                          <i className="ri-link text-2xl"></i>
                        </div>
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-24 h-24 rounded-full bg-foreground-800 flex items-center justify-center ring-4 ring-foreground-700">
                            <i className="ri-user-line text-3xl text-foreground-500"></i>
                          </div>
                          <p className="text-sm text-foreground-400">You</p>
                        </div>
                      </div>
                    ) : (
                      /* Remote area with participant avatar + self-view PIP */
                      <>
                        <div className="flex flex-col items-center gap-4">
                          <div className={`w-32 h-32 rounded-full flex items-center justify-center text-4xl font-bold ${contactColor} ring-4 ring-foreground-700/50 shadow-2xl`}>
                            {contactInitials}
                          </div>
                          <div>
                            <p className="text-lg font-heading font-semibold text-foreground-200 text-center">{contactName}</p>
                            <p className="text-xs text-foreground-500 text-center mt-1">Camera is off</p>
                          </div>
                        </div>
                        {/* Self-view PIP — always visible, fallback avatar when camera denied */}
                        <div className="absolute bottom-24 right-6 w-56 h-40 rounded-2xl overflow-hidden border-2 border-foreground-600/50 shadow-2xl bg-foreground-900 group">
                          {hasCamera && localStream ? (
                            <>
                              <video ref={selfVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-gradient-to-t from-foreground-950/60 to-transparent opacity-0 group-hover:opacity-100 transition-smooth"></div>
                              <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-smooth">
                                <p className="text-[10px] text-white/80 font-medium">You</p>
                              </div>
                            </>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-foreground-800">
                              <div className="flex flex-col items-center gap-1.5">
                                <div className="w-12 h-12 rounded-full bg-foreground-700 flex items-center justify-center">
                                  <i className="ri-user-line text-xl text-foreground-400"></i>
                                </div>
                                <p className="text-[10px] text-foreground-400 font-medium">Camera off</p>
                              </div>
                            </div>
                          )}
                          <div className="absolute bottom-2 left-2">
                            <p className="text-[10px] text-white/60 font-medium bg-foreground-950/50 px-1.5 py-0.5 rounded">You</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                /* Voice call — centered avatar */
                <div className="flex flex-col items-center justify-center gap-8">
                  <div className="relative">
                    <div className={`w-36 h-36 rounded-full flex items-center justify-center text-5xl font-bold ${contactColor} ring-4 ring-foreground-800/50 shadow-2xl`}>
                      {contactInitials}
                    </div>
                    <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center ring-4 ring-foreground-950">
                      <i className="ri-mic-line text-white text-sm"></i>
                    </div>
                  </div>
                  <div className="text-center">
                    <h2 className="text-2xl font-heading font-semibold text-foreground-100">{contactName}</h2>
                    <p className="text-sm text-foreground-400 mt-1">{formatDuration(callDuration)}</p>
                  </div>
                  {/* Waveform animation */}
                  <div className="flex items-center gap-1.5">
                    {[...Array(7)].map((_, i) => (
                      <div
                        key={i}
                        className="w-2 bg-primary-500/60 rounded-full"
                        style={{
                          height: `${12 + Math.sin(Date.now() / 300 + i) * 20}px`,
                          animation: `waveform 0.8s ease-in-out infinite`,
                          animationDelay: `${i * 0.12}s`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom controls bar */}
        {callState === 'connected' && (
          <div className="flex items-center justify-center gap-4 px-6 py-4 bg-foreground-900/80 backdrop-blur-sm shrink-0">
            {/* Mute */}
            <button
              onClick={toggleMute}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-smooth cursor-pointer ${
                muted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-foreground-800 text-foreground-200 hover:bg-foreground-700'
              }`}
              title={muted ? 'Unmute' : 'Mute'}
            >
              <i className={`${muted ? 'ri-mic-off-line' : 'ri-mic-line'} text-lg`}></i>
            </button>

            {/* Camera (video only) */}
            {type === 'video' && (
              <button
                onClick={toggleCamera}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-smooth cursor-pointer ${
                  cameraOff ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-foreground-800 text-foreground-200 hover:bg-foreground-700'
                }`}
                title={cameraOff ? 'Turn camera on' : 'Turn camera off'}
              >
                <i className={`${cameraOff ? 'ri-video-off-line' : 'ri-video-line'} text-lg`}></i>
              </button>
            )}

            {/* Screen share */}
            <button
              onClick={toggleScreenShare}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-smooth cursor-pointer ${
                isScreenSharing ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-foreground-800 text-foreground-200 hover:bg-foreground-700'
              }`}
              title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
            >
              <i className={`${isScreenSharing ? 'ri-stop-circle-line' : 'ri-computer-line'} text-lg`}></i>
            </button>

            {/* Chat toggle */}
            <button
              onClick={() => setShowChat(prev => !prev)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-smooth cursor-pointer ${
                showChat ? 'bg-primary-500/20 text-primary-400' : 'bg-foreground-800 text-foreground-200 hover:bg-foreground-700'
              }`}
              title="Chat"
            >
              <i className="ri-chat-3-line text-lg"></i>
            </button>

            {/* Speaker toggle */}
            <button
              onClick={() => setSpeakerOn(prev => !prev)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-smooth cursor-pointer ${
                !speakerOn ? 'bg-red-500/20 text-red-400' : 'bg-foreground-800 text-foreground-200 hover:bg-foreground-700'
              }`}
              title={speakerOn ? 'Speaker on' : 'Speaker off'}
            >
              <i className={`${speakerOn ? 'ri-volume-up-line' : 'ri-volume-mute-line'} text-lg`}></i>
            </button>

            {/* End call */}
            <button
              onClick={handleEndCall}
              className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition-smooth cursor-pointer shadow-lg shadow-red-500/20 ml-2"
              title="End call"
            >
              <i className="ri-phone-fill text-xl rotate-[135deg]"></i>
            </button>
          </div>
        )}
      </div>

      {/* In-call chat sidebar */}
      {showChat && callState === 'connected' && (
        <div className="fixed right-0 top-0 bottom-0 w-[340px] bg-foreground-900 border-l border-foreground-800 flex flex-col z-[115] animate-in slide-in-from-right duration-300">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-foreground-800 shrink-0">
            <div className="flex items-center gap-2">
              <i className="ri-chat-3-line text-foreground-300 text-sm"></i>
              <h3 className="text-sm font-semibold text-foreground-100">In-call chat</h3>
              <span className="text-[10px] text-foreground-500 bg-foreground-800 px-1.5 py-0.5 rounded-full">{chatMessages.length}</span>
            </div>
            <button
              onClick={() => setShowChat(false)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-200 hover:bg-foreground-800 transition-smooth cursor-pointer"
            >
              <i className="ri-close-line text-sm"></i>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {chatMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <i className="ri-chat-3-line text-2xl text-foreground-700 mb-2"></i>
                <p className="text-xs text-foreground-500">Messages sent during this call will appear here</p>
              </div>
            )}
            {chatMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                  msg.from === 'me'
                    ? 'bg-primary-500 text-white rounded-br-md'
                    : 'bg-foreground-800 text-foreground-200 rounded-bl-md'
                }`}>
                  <p className="text-[10px] font-semibold mb-0.5 opacity-70">
                    {msg.from === 'me' ? 'You' : contactName.split(' ')[0]}
                  </p>
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                  <p className="text-[9px] mt-1 opacity-50 text-right">{msg.time}</p>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div className="px-4 py-3 border-t border-foreground-800 shrink-0">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Type a message..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendChatMessage(); }}
                className="flex-1 bg-foreground-800 border border-foreground-700 rounded-xl px-4 py-2.5 text-sm text-foreground-100 outline-none focus:border-primary-500/50 transition-smooth placeholder:text-foreground-600"
              />
              <button
                onClick={sendChatMessage}
                disabled={!chatInput.trim()}
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-smooth ${
                  chatInput.trim()
                    ? 'bg-primary-500 text-white hover:bg-primary-600 cursor-pointer'
                    : 'bg-foreground-800 text-foreground-600 cursor-not-allowed'
                }`}
              >
                <i className="ri-send-plane-fill text-sm"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waveform animation keyframes */}
      <style>{`
        @keyframes waveform {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes zoom-in-95 {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes slide-in-from-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .animate-in { animation: fade-in 0.3s ease-out, zoom-in-95 0.3s ease-out; }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-slide-in-from-right { animation: slide-in-from-right 0.3s ease-out; }
        .animate-bounce { animation: bounce 1s infinite; }
      `}</style>
    </div>
  );
}