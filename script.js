const minutesEl = document.querySelector('#minutes');
const secondsEl = document.querySelector('#seconds');
const startButton = document.querySelector('#startButton');
const resetButton = document.querySelector('#resetButton');
const durationInput = document.querySelector('#durationMinutes');
const durationSecondsInput = document.querySelector('#durationSeconds');
const durationBlock = document.querySelector('#durationBlock');
const countUpNote = document.querySelector('#countUpNote');
const modeLabel = document.querySelector('#modeLabel');
const soundEnabled = document.querySelector('#soundEnabled');
const chimeInterval = document.querySelector('#chimeInterval');
const paceSound = document.querySelector('#paceSound');
const voicePicker = document.querySelector('#voicePicker');
const voiceRate = document.querySelector('#voiceRate');
const voiceCalls = document.querySelector('#voiceCalls');
const soundDetails = document.querySelector('#soundDetails');
const voiceEnabled = document.querySelector('#voiceEnabled');
const voiceDetails = document.querySelector('#voiceDetails');
const musicDetails = document.querySelector('#musicDetails');
const beatPanel = document.querySelector('#beatPanel');
const filePanel = document.querySelector('#filePanel');
const bpmInput = document.querySelector('#bpmInput');
const beatStyle = document.querySelector('#beatStyle');
const beatMood = document.querySelector('#beatMood');
const buildUp = document.querySelector('#buildUp');
const shuffleMusic = document.querySelector('#shuffleMusic');
const musicFile = document.querySelector('#musicFile');
const musicFileName = document.querySelector('#musicFileName');
const musicVolumeInput = document.querySelector('#musicVolume');
const previewButton = document.querySelector('#previewMusic');
const progressFill = document.querySelector('#progressFill');
const statusText = document.querySelector('#statusText');
const wakeStatus = document.querySelector('#wakeStatus');
const presetButtons = document.querySelectorAll('[data-duration]');
const modeRadios = document.querySelectorAll('input[name="mode"]');
const musicRadios = document.querySelectorAll('input[name="music"]');
const lockedWhileRunning = [...document.querySelectorAll('.duration-control button, .duration-control input'), ...modeRadios];

const MAX_SECONDS = 240 * 60 + 59;
const STORAGE_KEY = 'core-tempo-settings-v2';
const savedInputs = [durationInput, durationSecondsInput, soundEnabled, paceSound, chimeInterval, voiceEnabled, voiceRate, voiceCalls, bpmInput, beatStyle, beatMood, buildUp, shuffleMusic, musicVolumeInput];
let initialSeconds = 180;
let elapsedMs = 0;
let elapsedSeconds = 0;
let startAt = 0;
let running = false;
let finished = false;
let previewing = false;
let timerId = null;

const getMode = () => document.querySelector('input[name="mode"]:checked').value;
const getMusicSource = () => document.querySelector('input[name="music"]:checked').value;
// Counts the multiples of `step` passed when a value moves from `from` to `to` (either direction).
const crossed = (from, to, step) => Math.abs(Math.floor(Math.max(from, to) / step) - Math.floor(Math.min(from, to) / step));

/* ---------- Display ---------- */

function formatTime(total) {
  return [Math.floor(total / 60), total % 60].map(value => String(value).padStart(2, '0'));
}
function render() {
  const countDown = getMode() === 'down';
  const shown = countDown ? initialSeconds - elapsedSeconds : elapsedSeconds;
  const [minutes, seconds] = formatTime(shown);
  minutesEl.textContent = minutes;
  secondsEl.textContent = seconds;
  // Count up has no end, so the bar fills once per minute instead.
  const progress = countDown ? elapsedSeconds / initialSeconds : (elapsedSeconds % 60) / 60;
  progressFill.style.width = `${progress * 100}%`;
}

/* ---------- Audio: bell, beat, own music ---------- */

let audioContext, musicVolume, duckGain, noiseBuffer, mediaSource;
const musicAudio = new Audio();
// Own music: one or more picked files, played in order (or shuffled) and repeated.
let playlist = [];
let trackIndex = 0;
function loadTrack(index) {
  trackIndex = index;
  musicAudio.src = playlist[index].url;
  musicAudio.loop = playlist.length === 1;
}
function randomTrack() {
  if (playlist.length < 2) return 0;
  const next = Math.floor(Math.random() * (playlist.length - 1));
  return next >= trackIndex ? next + 1 : next;
}
musicAudio.addEventListener('ended', () => {
  if (playlist.length < 2) return;
  loadTrack(shuffleMusic.checked ? randomTrack() : (trackIndex + 1) % playlist.length);
  musicAudio.play().catch(() => {});
});

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    musicVolume = audioContext.createGain();
    duckGain = audioContext.createGain();
    musicVolume.connect(duckGain).connect(audioContext.destination);
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}
function envelope(gain, when, peak, length, attack = .01) {
  gain.gain.setValueAtTime(.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + attack);
  gain.gain.exponentialRampToValueAtTime(.0001, when + length);
}
// Each pace sound is a sine fundamental plus quieter, faster-fading overtones ([ratio, level]).
// `pace` is the single note for the pace signal, `chord` is arpeggiated at the finish.
const PACE_SOUNDS = {
  bell: { partials: [[1, 1], [2, .28], [2.76, .12], [5.4, .04]], peak: .12, length: 1.8, attack: .012, pace: 659.25, chord: [523.25, 659.25, 783.99] },
  bowl: { partials: [[1, 1], [1.006, .7], [2.71, .3], [5.15, .08]], peak: .1, length: 4.5, attack: .09, pace: 293.66, chord: [220, 293.66, 369.99] },
  kalimba: { partials: [[1, 1], [3.02, .12], [6.1, .05]], peak: .14, length: 1.1, attack: .003, pace: 783.99, chord: [587.33, 783.99, 987.77] },
  marimba: { partials: [[1, 1], [4, .2], [9.9, .04]], peak: .2, length: .7, attack: .004, pace: 523.25, chord: [392, 523.25, 659.25] },
  chimes: { partials: [[1, 1], [2.32, .25], [4.25, .1], [6.63, .04]], peak: .07, length: 2.6, attack: .004, pace: 1174.66, chord: [1046.5, 1174.66, 1318.51, 1567.98] },
  woodblock: { partials: [[1, 1], [2.48, .35]], peak: .22, length: .14, attack: .002, pace: 880, chord: [659.25, 880, 1046.5] },
  tick: { partials: [[1, 1]], peak: .12, length: .06, attack: .002, pace: 1400, chord: [1050, 1400] },
};
function strike(sound, frequency, when, length = sound.length) {
  const ctx = ensureAudio();
  sound.partials.forEach(([ratio, level]) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequency * ratio;
    envelope(gain, when, sound.peak * level, Math.max(.05, length / Math.sqrt(ratio)), sound.attack);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(when); oscillator.stop(when + length + .05);
  });
}
function chime(final = false) {
  if (!soundEnabled.checked) return;
  const sound = PACE_SOUNDS[paceSound.value] || PACE_SOUNDS.bell;
  const now = ensureAudio().currentTime + .02;
  if (!final) { strike(sound, sound.pace, now); return; }
  // Short sounds get a longer ring at the finish so the chord still lands.
  sound.chord.forEach((frequency, index) => strike(sound, frequency, now + index * .18, Math.max(sound.length * 1.4, .5)));
}

function tone(output, when, { type = 'sine', from, to = from, peak, length, attack = .005 }) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, when);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, when + Math.min(length, .15));
  envelope(gain, when, peak, length, attack);
  oscillator.connect(gain).connect(output);
  oscillator.start(when); oscillator.stop(when + length + .05);
}
function noise(output, when, { filter, frequency, peak, length }) {
  const source = audioContext.createBufferSource();
  const biquad = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = noiseBuffer;
  biquad.type = filter; biquad.frequency.value = frequency;
  envelope(gain, when, peak, length, .002);
  source.connect(biquad).connect(gain).connect(output);
  source.start(when); source.stop(when + length + .05);
}
const midiToHz = note => 440 * 2 ** ((note - 69) / 12);
// Four-bar chord loops as MIDI notes: [bass, ...chord tones].
const MOODS = {
  calm: [[36, 60, 64, 67], [33, 57, 60, 64], [29, 57, 60, 65], [31, 55, 59, 62]], // C – Am – F – G
  uplifting: [[29, 57, 60, 65], [31, 55, 59, 62], [28, 55, 59, 64], [33, 57, 60, 64]], // F – G – Em – Am
  dreamy: [[36, 60, 64, 67, 71], [29, 57, 60, 64, 65], [33, 55, 57, 60, 64], [29, 57, 60, 64, 65]], // Cmaj7 – Fmaj7 – Am7 – Fmaj7
  melancholy: [[33, 57, 60, 64], [29, 57, 60, 65], [36, 55, 60, 64], [31, 55, 59, 62]], // Am – F – C – G
  intense: [[33, 57, 60, 64], [38, 57, 62, 65], [28, 55, 59, 64], [33, 57, 60, 64]], // Am – Dm – Em – Am
};

// Steps are eighth notes, 8 per bar. Each style gets the bar's bass and chord tones in Hz.
const bassBar = ({ output, when, barLength, bass }, peak = .16) => {
  tone(output, when, { type: 'triangle', from: bass, peak, length: barLength * .95, attack: .06 });
  tone(output, when, { from: bass * 2, peak: peak / 3, length: barLength * .8, attack: .1 });
};
const kick = (output, when, peak = .7) => tone(output, when, { from: 150, to: 45, peak, length: .4 });
const snare = (output, when, peak = .22) => {
  noise(output, when, { filter: 'bandpass', frequency: 1800, peak, length: .18 });
  tone(output, when, { type: 'triangle', from: 190, peak: peak / 2, length: .1 });
};
const hat = (output, when, peak) => noise(output, when, { filter: 'highpass', frequency: 7000, peak, length: .04 });
const shaker = (output, when, peak = .04) => noise(output, when, { filter: 'highpass', frequency: 5000, peak, length: .07 });
const BEAT_STYLES = {
  soft(beat) {
    const { output, when, step } = beat;
    if (step === 0) bassBar(beat);
    if (step % 2 === 0) tone(output, when, { from: 120, to: 50, peak: step === 0 ? .5 : .32, length: .35 });
    else shaker(output, when);
  },
  drums(beat) {
    const { output, when, step } = beat;
    if (step === 0) bassBar(beat);
    if (step === 0 || step === 4) kick(output, when);
    if (step === 2 || step === 6) snare(output, when);
    hat(output, when, step % 2 ? .03 : .05);
  },
  lofi(beat) {
    const { output, step, eighth, notes } = beat;
    const when = beat.when + (step % 2 ? eighth * .2 : 0); // lazy swing on the offbeats
    if (step === 0) {
      bassBar(beat, .13);
      notes.forEach(note => tone(output, when, { type: 'triangle', from: note, peak: .035, length: beat.barLength * .55, attack: .02 }));
    }
    if (step === 0 || step === 5) kick(output, when, .5);
    if (step === 2 || step === 6) snare(output, when, .13);
    hat(output, when, step % 2 ? .02 : .03);
  },
  ambient(beat) {
    const { output, when, step, notes, barLength } = beat;
    if (step !== 0 && step !== 4) return;
    if (step === 0) {
      bassBar(beat, .13);
      notes.forEach(note => tone(output, when, { from: note, peak: .065, length: barLength * 1.05, attack: .9 }));
    }
    tone(output, when, { from: 70, peak: .16, length: .6, attack: .03 });
  },
  heartbeat(beat) {
    const { output, when, step, eighth, notes, barLength } = beat;
    if (step === 0) notes.forEach(note => tone(output, when, { from: note / 2, peak: .03, length: barLength, attack: .6 }));
    if (step % 2) return;
    tone(output, when, { from: 65, to: 45, peak: .55, length: .18 });
    tone(output, when + eighth * .45, { from: 58, to: 40, peak: .35, length: .16 });
  },
  toms(beat) {
    const { output, when, step } = beat;
    if (step === 0) bassBar(beat, .12);
    if ([0, 3, 6].includes(step)) tone(output, when, { from: 110, to: 70, peak: .45, length: .35 });
    if (step === 4) tone(output, when, { from: 170, to: 120, peak: .3, length: .25 });
    if (step === 7) tone(output, when, { from: 240, to: 180, peak: .2, length: .18 });
    if (step % 2) shaker(output, when, .035);
  },
  arp(beat) {
    const { output, when, step, eighth, bass, notes } = beat;
    if (step % 2 === 0) {
      kick(output, when, .5);
      tone(output, when, { type: 'triangle', from: bass * 2, peak: .1, length: eighth * 1.6 });
    }
    tone(output, when, { type: 'triangle', from: notes[step % notes.length] * 2, peak: .05, length: eighth * .9 });
  },
  metronome(beat) {
    const { output, when, step } = beat;
    if (step % 2 === 0) tone(output, when, { from: step === 0 ? 1600 : 1200, peak: step === 0 ? .3 : .22, length: .05, attack: .002 });
  },
};
function playStep(output, step, when, eighth) {
  const mood = MOODS[beatMood.value] || MOODS.calm;
  const [bass, ...notes] = mood[Math.floor(step / 8) % mood.length].map(midiToHz);
  (BEAT_STYLES[beatStyle.value] || BEAT_STYLES.soft)({ output, step: step % 8, when, eighth, barLength: eighth * 8, bass, notes });
}
// Build up raises the tempo by up to 20% as a count down nears its end.
function currentBpm() {
  const base = Number(bpmInput.value);
  if (!buildUp.checked || !running || getMode() !== 'down') return base;
  return base * (1 + .2 * elapsedSeconds / initialSeconds);
}

// Notes are scheduled ~1.2 s ahead so a throttled timer can't make the beat stutter.
let beat = null;
function startBeat() {
  const ctx = ensureAudio();
  const output = ctx.createGain();
  output.connect(musicVolume);
  beat = { output, step: 0, nextTime: ctx.currentTime + .08 };
  const schedule = () => {
    const eighth = 60 / currentBpm() / 2;
    while (beat.nextTime < ctx.currentTime + 1.2) {
      playStep(beat.output, beat.step, beat.nextTime, eighth);
      beat.nextTime += eighth; beat.step += 1;
    }
  };
  schedule();
  beat.timer = setInterval(schedule, 100);
}
function stopBeat() {
  if (!beat) return;
  const { output, timer } = beat;
  clearInterval(timer);
  output.gain.setTargetAtTime(0, audioContext.currentTime, .03);
  setTimeout(() => output.disconnect(), 300);
  beat = null;
}

let fadeTimer = null;
function startMusic() {
  clearTimeout(fadeTimer);
  const source = getMusicSource();
  if (source === 'off') return;
  const ctx = ensureAudio();
  musicVolume.gain.cancelScheduledValues(ctx.currentTime);
  musicVolume.gain.setValueAtTime(Number(musicVolumeInput.value) / 100, ctx.currentTime);
  if (source === 'beat') startBeat();
  if (source === 'file' && playlist.length) {
    mediaSource ||= ctx.createMediaElementSource(musicAudio);
    mediaSource.connect(musicVolume);
    musicAudio.play().catch(() => {});
  }
}
function pauseMusic() { stopBeat(); musicAudio.pause(); }
function stopMusic() {
  clearTimeout(fadeTimer);
  pauseMusic();
  if (playlist.length) loadTrack(shuffleMusic.checked ? randomTrack() : 0);
}
function fadeOutMusic() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  musicVolume.gain.cancelScheduledValues(now);
  musicVolume.gain.setValueAtTime(musicVolume.gain.value, now);
  musicVolume.gain.linearRampToValueAtTime(0, now + 2.5);
  fadeTimer = setTimeout(stopMusic, 2600);
}
function restartMusicIfPlaying() {
  if (!running && !previewing) return;
  pauseMusic(); startMusic();
}
function setPreviewing(on) {
  previewing = on;
  previewButton.textContent = on ? 'STOP PREVIEW ■' : 'PREVIEW ↗';
}

/* ---------- Voice ---------- */

const speechSupported = 'speechSynthesis' in window;
let preferredVoice = '';
// Voices load asynchronously, so the picker is rebuilt whenever the list changes.
function populateVoices() {
  const wanted = voicePicker.value || preferredVoice;
  const english = item => /^en/i.test(item.lang) ? 0 : 1;
  const voices = speechSynthesis.getVoices().sort((a, b) => english(a) - english(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  voicePicker.replaceChildren(new Option('Automatic', ''), ...voices.map(item => new Option(`${item.name} (${item.lang})`, item.voiceURI)));
  if (voices.some(item => item.voiceURI === wanted)) voicePicker.value = wanted;
}
function currentVoice() {
  const voices = speechSynthesis.getVoices();
  const chosen = voices.find(item => item.voiceURI === voicePicker.value);
  if (chosen) return chosen;
  const english = voices.filter(item => /^en/i.test(item.lang));
  return english.find(item => item.localService) || english[0] || null;
}
// The music ducks while the coach speaks so the words stay clear.
function duck(on) {
  if (audioContext) duckGain.gain.setTargetAtTime(on ? .35 : 1, audioContext.currentTime, .08);
}
function speak(text, interrupt = false) {
  if (!speechSupported || !voiceEnabled.checked) return false;
  if (interrupt) speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = currentVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || 'en-US';
  utterance.rate = Number(voiceRate.value);
  utterance.onstart = () => duck(true);
  utterance.onend = utterance.onerror = () => duck(false);
  speechSynthesis.speak(utterance);
  return true;
}

/* ---------- Keep the screen on ---------- */

let wakeLock = null;
const wakeTip = wakeStatus.textContent;
async function keepScreenOn() {
  if (!('wakeLock' in navigator)) {
    wakeStatus.textContent = "This browser can't keep the screen on. Open the app over HTTPS in an up-to-date browser, or turn off auto-lock.";
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    wakeStatus.textContent = wakeTip;
    // The timer may have stopped while the request was pending.
    if (!running) releaseScreen();
  } catch {
    wakeStatus.textContent = "The browser didn't allow keeping the screen on (battery saver can block it). Turn off auto-lock if it dims.";
  }
}
function releaseScreen() { wakeLock?.release().catch(() => {}); wakeLock = null; }
// Browsers drop the lock when the tab is hidden, so ask again when it's back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running && !wakeLock) keepScreenOn();
});

/* ---------- Timer ---------- */

// Duration inputs are the source of truth; an empty (0:00) duration falls back to 1:00.
function readDuration() {
  const minutes = Math.max(0, Math.min(240, Number(durationInput.value) || 0));
  const seconds = Math.max(0, Math.min(59, Number(durationSecondsInput.value) || 0));
  return minutes * 60 + seconds || 60;
}
function writeDuration(total) {
  durationInput.value = Math.floor(total / 60);
  durationSecondsInput.value = String(total % 60).padStart(2, '0');
  presetButtons.forEach(item => item.classList.toggle('selected', total === Number(item.dataset.duration) * 60));
}
function setControlsLocked(locked) { lockedWhileRunning.forEach(control => { control.disabled = locked; }); }
function stopTimer() {
  clearInterval(timerId); timerId = null; running = false; setControlsLocked(false); releaseScreen();
  startButton.innerHTML = '<span class="play-icon">▶</span> START PLANK';
}
function finish() {
  stopTimer(); finished = true;
  statusText.textContent = 'COMPLETE';
  chime(true); fadeOutMusic();
  speak('Done. Great hold!', true);
}
const ENCOURAGEMENT = ['Keep breathing.', 'Stay strong.', 'Squeeze your core.', 'Hips level.', 'Shoulders over elbows.', 'You got this.'];
function spokenTime(total) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return [minutes && `${minutes} minute${minutes === 1 ? '' : 's'}`, seconds && `${seconds} seconds`].filter(Boolean).join(' ');
}
// Returns [text, interrupt] for what the coach should say at this second, or null.
function voiceCall(previous, current) {
  const calls = voiceCalls.value;
  const countDown = getMode() === 'down';
  const remaining = initialSeconds - current;
  if (countDown && calls !== 'minutes' && remaining <= 10) return [String(remaining), true];
  const half = Math.floor(initialSeconds / 2);
  if (countDown && calls === 'halfway' && previous < half && current >= half) return ['Halfway'];
  if (calls === 'thirty') return crossed(previous, current, 30) ? [spokenTime(current - current % 30)] : null;
  if (!crossed(previous, current, 60)) return null;
  const text = spokenTime(current - current % 60);
  return calls === 'coach' ? [`${text}. ${ENCOURAGEMENT[(Math.floor(current / 60) - 1) % ENCOURAGEMENT.length]}`] : [text];
}
// Voice first; the pace sound only plays when the coach isn't talking.
function cue(previous, current) {
  const countDown = getMode() === 'down';
  const remaining = initialSeconds - current;
  const call = voiceEnabled.checked && voiceCall(previous, current);
  if (call && speak(...call)) return;
  const step = Number(chimeInterval.value);
  // Count down rings on the remaining time (e.g. 0:45, 0:30) so the bells line up with the finish.
  const ring = countDown ? crossed(initialSeconds - previous - 1, remaining - 1, step) : crossed(previous, current, step);
  if (ring) chime();
}
// Time comes from a wall-clock start, so throttled background tabs don't drift.
function tick() {
  elapsedMs = Date.now() - startAt;
  const limit = getMode() === 'down' ? initialSeconds : MAX_SECONDS;
  const current = Math.min(limit, Math.floor(elapsedMs / 1000));
  if (current === elapsedSeconds) return;
  const previous = elapsedSeconds;
  elapsedSeconds = current;
  render();
  if (current >= limit) finish();
  else cue(previous, current);
}
function startTimer() {
  if (running) {
    tick(); if (finished) return;
    stopTimer(); pauseMusic();
    statusText.textContent = 'PAUSED';
    return;
  }
  if (finished) resetTimer();
  if (previewing) { setPreviewing(false); stopMusic(); }
  ensureAudio();
  if (elapsedMs === 0) speak('Go!', true);
  running = true; statusText.textContent = 'IN PROGRESS';
  startButton.innerHTML = 'Ⅱ PAUSE PLANK';
  setControlsLocked(true);
  startAt = Date.now() - elapsedMs;
  timerId = setInterval(tick, 200);
  startMusic();
  keepScreenOn();
}
function resetTimer() {
  stopTimer(); stopMusic(); setPreviewing(false);
  if (speechSupported) speechSynthesis.cancel();
  const total = readDuration();
  writeDuration(total);
  initialSeconds = total; elapsedMs = 0; elapsedSeconds = 0; finished = false;
  statusText.textContent = 'READY'; render(); saveSettings();
}

/* ---------- Settings UI ---------- */

function updateModeUI() {
  const countDown = getMode() === 'down';
  modeLabel.textContent = countDown ? 'COUNT DOWN' : 'COUNT UP';
  durationBlock.hidden = !countDown;
  countUpNote.hidden = countDown;
  if (!speechSupported) document.querySelector('#voiceCopy').textContent = "This browser doesn't support a voice coach.";
}
function updateSoundUI() {
  soundDetails.classList.toggle('disabled', !soundEnabled.checked);
  voiceDetails.classList.toggle('disabled', !voiceEnabled.checked || !speechSupported);
  const source = getMusicSource();
  musicDetails.hidden = source === 'off';
  beatPanel.hidden = source !== 'beat';
  filePanel.hidden = source !== 'file';
  document.querySelector('#bpmValue').textContent = bpmInput.value;
  document.querySelector('#volumeValue').textContent = musicVolumeInput.value;
}
function saveSettings() {
  const settings = { mode: getMode(), music: getMusicSource(), voice: voicePicker.value || preferredVoice };
  savedInputs.forEach(input => { settings[input.id] = input.type === 'checkbox' ? input.checked : input.value; });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}
function loadSettings() {
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch {}
  savedInputs.forEach(input => {
    if (!(input.id in settings)) return;
    if (input.type === 'checkbox') input.checked = settings[input.id]; else input.value = settings[input.id];
  });
  modeRadios.forEach(radio => { if (radio.value === settings.mode) radio.checked = true; });
  musicRadios.forEach(radio => { if (radio.value === settings.music) radio.checked = true; });
  preferredVoice = settings.voice || '';
}

document.querySelectorAll('[data-adjust]').forEach(button => button.addEventListener('click', () => {
  durationInput.value = Math.max(0, Math.min(240, Number(durationInput.value || 0) + Number(button.dataset.adjust))); resetTimer();
}));
document.querySelectorAll('[data-second-adjust]').forEach(button => button.addEventListener('click', () => {
  const total = Number(durationInput.value || 0) * 60 + Number(durationSecondsInput.value || 0) + Number(button.dataset.secondAdjust);
  writeDuration(Math.max(0, Math.min(MAX_SECONDS, total))); resetTimer();
}));
presetButtons.forEach(button => button.addEventListener('click', () => {
  durationInput.value = button.dataset.duration; durationSecondsInput.value = 0; resetTimer();
}));
durationInput.addEventListener('change', resetTimer); durationSecondsInput.addEventListener('change', resetTimer);
modeRadios.forEach(radio => radio.addEventListener('change', () => { updateModeUI(); resetTimer(); }));
musicRadios.forEach(radio => radio.addEventListener('change', () => { updateSoundUI(); restartMusicIfPlaying(); }));
[soundEnabled, voiceEnabled].forEach(input => input.addEventListener('change', updateSoundUI));
bpmInput.addEventListener('input', updateSoundUI);
musicVolumeInput.addEventListener('input', () => {
  updateSoundUI();
  if (audioContext) musicVolume.gain.setTargetAtTime(Number(musicVolumeInput.value) / 100, audioContext.currentTime, .05);
});
musicFile.addEventListener('change', () => {
  const files = [...musicFile.files];
  if (!files.length) return;
  const wasPlaying = running || previewing;
  pauseMusic();
  playlist.forEach(track => URL.revokeObjectURL(track.url));
  playlist = files.map(file => ({ name: file.name, url: URL.createObjectURL(file) }));
  loadTrack(shuffleMusic.checked ? randomTrack() : 0);
  musicFileName.textContent = files.length === 1 ? files[0].name : `${files.length} songs: ${files.map(file => file.name).join(', ')}`;
  if (wasPlaying) startMusic();
});
previewButton.addEventListener('click', () => {
  if (previewing) { setPreviewing(false); stopMusic(); return; }
  if (running) return;
  setPreviewing(true); startMusic();
});
document.addEventListener('change', saveSettings);
startButton.addEventListener('click', startTimer); resetButton.addEventListener('click', resetTimer);
document.querySelector('#testSound').addEventListener('click', () => chime());
const sampleVoice = () => speak('One minute. Keep holding.', true);
document.querySelector('#testVoice').addEventListener('click', sampleVoice);
paceSound.addEventListener('change', () => chime());
voicePicker.addEventListener('change', () => { preferredVoice = voicePicker.value; sampleVoice(); });
voiceRate.addEventListener('change', sampleVoice);

loadSettings();
if (speechSupported) { populateVoices(); speechSynthesis.addEventListener('voiceschanged', populateVoices); }
updateModeUI();
updateSoundUI();
resetTimer();
