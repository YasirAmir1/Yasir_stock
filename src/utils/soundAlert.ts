/**
 * Sound Alert Utility for Delegate & Admin Notifications
 * Uses the Web Audio API to synthesize a crisp, pleasant, high-fidelity notification chime
 * completely offline with zero external network requests or dependencies.
 */

const STORAGE_KEY = 'delegate_notification_sound_enabled';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Automatically unlock AudioContext on first user interaction to satisfy browser autoplay policy
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // Ignore
    }
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true, once: true });
  window.addEventListener('keydown', unlockAudio, { passive: true, once: true });
}

/**
 * Check if notification sounds are enabled in user settings
 */
export function isNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

/**
 * Update notification sound preference
 */
export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

/**
 * Plays a pleasant, high-fidelity 3-tone notification chime
 * Notes: E5 (659.25Hz) -> A5 (880Hz) -> C#6 (1108.73Hz) [A Major Triad]
 */
export async function playNotificationSound(force = false): Promise<boolean> {
  if (!force && !isNotificationSoundEnabled()) {
    return false;
  }

  // Trigger gentle mobile haptic feedback if supported
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([100, 60, 160]);
    } catch {
      // Ignore vibration error
    }
  }

  try {
    const ctx = getAudioContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Chime notes: frequency (Hz), start offset (sec), duration (sec), gain volume
    const notes = [
      { freq: 659.25, time: 0.00, duration: 0.28, vol: 0.25 }, // E5
      { freq: 880.00, time: 0.11, duration: 0.32, vol: 0.28 }, // A5
      { freq: 1108.73, time: 0.23, duration: 0.55, vol: 0.32 } // C#6
    ];

    notes.forEach((note) => {
      const startTime = now + note.time;
      const stopTime = startTime + note.duration;

      // Primary tone (warm sine wave)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(note.vol, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(stopTime);

      // Subtle soft harmonic overtone for acoustic depth
      const harmonicOsc = ctx.createOscillator();
      const harmonicGain = ctx.createGain();

      harmonicOsc.type = 'triangle';
      harmonicOsc.frequency.setValueAtTime(note.freq * 2, startTime);

      harmonicGain.gain.setValueAtTime(0, startTime);
      harmonicGain.gain.linearRampToValueAtTime(note.vol * 0.15, startTime + 0.02);
      harmonicGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

      harmonicOsc.connect(harmonicGain);
      harmonicGain.connect(ctx.destination);

      harmonicOsc.start(startTime);
      harmonicOsc.stop(stopTime);
    });

    return true;
  } catch (err) {
    console.warn('Could not play notification sound:', err);
    return false;
  }
}

/**
 * Test function that plays the sound immediately (ignoring mute setting)
 * Useful for user testing and unlocking audio permissions
 */
export async function testNotificationSound(): Promise<boolean> {
  return playNotificationSound(true);
}
