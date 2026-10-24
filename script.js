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
const soundDetails = document.querySelector('#soundDetails');
const voiceEnabled = document.querySelector('#voiceEnabled');
const voiceDetails = document.querySelector('#voiceDetails');
const musicDetails = document.querySelector('#musicDetails');
const beatPanel = document.querySelector('#beatPanel');
const filePanel = document.querySelector('#filePanel');
const bpmInput = document.querySelector('#bpmInput');
const beatStyle = document.querySelector('#beatStyle');
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
const STORAGE_KEY = 'core-tempo-settings';
const savedInputs = [durationInput, durationSecondsInput, soundEnabled, chimeInterval, voiceEnabled, bpmInput, beatStyle, musicVolumeInput];
let initialSeconds = 120;
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
musicAudio.loop = true;

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
// A bell is a sine fundamental plus a few quieter, faster-fading overtones.
function bell(frequency, when, peak = .14, length = 2.4) {
  const ctx = ensureAudio();
  [[1, 1], [2, .28], [2.76, .12], [5.4, .04]].forEach(([ratio, level]) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequency * ratio;
    envelope(gain, when, peak * level, length / Math.sqrt(ratio));
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(when); oscillator.stop(when + length);
  });
}
function chime(final = false) {
  if (!soundEnabled.checked) return;
  const now = ensureAudio().currentTime + .02;
  if (!final) { bell(659.25, now, .12, 1.8); return; }
  bell(523.25, now); bell(659.25, now + .18); bell(783.99, now + .36, .14, 3.2);
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
// C – Am – F – G, one chord root per bar.
const BASS_LINE = [65.41, 55, 43.65, 49];
function playStep(output, step, when, barLength) {
  const beatInBar = step % 8;
  if (beatInBar === 0) {
    const root = BASS_LINE[Math.floor(step / 8) % BASS_LINE.length];
    tone(output, when, { type: 'triangle', from: root, peak: .16, length: barLength * .95, attack: .06 });
    tone(output, when, { from: root * 2, peak: .05, length: barLength * .8, attack: .1 });
  }
  if (beatStyle.value === 'drums') {
    if (beatInBar === 0 || beatInBar === 4) tone(output, when, { from: 150, to: 45, peak: .7, length: .4 });
    if (beatInBar === 2 || beatInBar === 6) {
      noise(output, when, { filter: 'bandpass', frequency: 1800, peak: .22, length: .18 });
      tone(output, when, { type: 'triangle', from: 190, peak: .1, length: .1 });
    }
    noise(output, when, { filter: 'highpass', frequency: 7000, peak: beatInBar % 2 ? .03 : .05, length: .04 });
  } else if (beatInBar % 2 === 0) {
    tone(output, when, { from: 120, to: 50, peak: beatInBar === 0 ? .5 : .32, length: .35 });
  } else {
    noise(output, when, { filter: 'highpass', frequency: 5000, peak: .04, length: .07 });
  }
}

// Notes are scheduled ~1.2 s ahead so a throttled timer can't make the beat stutter.
let beat = null;
function startBeat() {
  const ctx = ensureAudio();
  const output = ctx.createGain();
  output.connect(musicVolume);
  beat = { output, step: 0, nextTime: ctx.currentTime + .08 };
  const schedule = () => {
    const eighth = 60 / Number(bpmInput.value) / 2;
    while (beat.nextTime < ctx.currentTime + 1.2) {
      playStep(beat.output, beat.step, beat.nextTime, eighth * 8);
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
  if (source === 'file' && musicAudio.src) {
    mediaSource ||= ctx.createMediaElementSource(musicAudio);
    mediaSource.connect(musicVolume);
    musicAudio.play().catch(() => {});
  }
}
function pauseMusic() { stopBeat(); musicAudio.pause(); }
function stopMusic() {
  clearTimeout(fadeTimer);
  pauseMusic();
  if (musicAudio.src) musicAudio.currentTime = 0;
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
let voice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter(item => /^en/i.test(item.lang));
  voice = voices.find(item => item.localService) || voices[0] || null;
}
// The music ducks while the coach speaks so the words stay clear.
function duck(on) {
  if (audioContext) duckGain.gain.setTargetAtTime(on ? .35 : 1, audioContext.currentTime, .08);
}
function speak(text, interrupt = false) {
  if (!speechSupported || !voiceEnabled.checked) return false;
  if (interrupt) speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || 'en-US';
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
// Voice first; the pace bell only plays when the coach isn't talking.
function cue(previous, current) {
  const countDown = getMode() === 'down';
  const remaining = initialSeconds - current;
  if (countDown && remaining <= 10 && speak(String(remaining), true)) return;
  const minutes = Math.floor(current / 60);
  if (crossed(previous, current, 60) && speak(`${minutes} minute${minutes === 1 ? '' : 's'}`)) return;
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
  document.querySelector('#voiceCopy').textContent = !speechSupported
    ? "This browser doesn't support a voice coach."
    : countDown ? 'Calls out each full minute, then counts down the last ten seconds.' : 'Calls out each full minute you hold.';
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
  const settings = { mode: getMode(), music: getMusicSource() };
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
  const [file] = musicFile.files;
  if (!file) return;
  if (musicAudio.src) URL.revokeObjectURL(musicAudio.src);
  musicAudio.src = URL.createObjectURL(file);
  musicFileName.textContent = file.name;
  restartMusicIfPlaying();
});
previewButton.addEventListener('click', () => {
  if (previewing) { setPreviewing(false); stopMusic(); return; }
  if (running) return;
  setPreviewing(true); startMusic();
});
document.addEventListener('change', saveSettings);
startButton.addEventListener('click', startTimer); resetButton.addEventListener('click', resetTimer);
document.querySelector('#testSound').addEventListener('click', () => chime());
document.querySelector('#testVoice').addEventListener('click', () => speak('One minute. Keep holding.', true));
if (speechSupported) { pickVoice(); speechSynthesis.addEventListener('voiceschanged', pickVoice); }

loadSettings();
updateModeUI();
updateSoundUI();
resetTimer();
