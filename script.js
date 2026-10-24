const minutesEl = document.querySelector('#minutes');
const secondsEl = document.querySelector('#seconds');
const startButton = document.querySelector('#startButton');
const resetButton = document.querySelector('#resetButton');
const durationInput = document.querySelector('#durationMinutes');
const durationSecondsInput = document.querySelector('#durationSeconds');
const soundEnabled = document.querySelector('#soundEnabled');
const beepInterval = document.querySelector('#beepInterval');
const soundDetails = document.querySelector('#soundDetails');
const progressFill = document.querySelector('#progressFill');
const statusText = document.querySelector('#statusText');
const presetButtons = document.querySelectorAll('[data-duration]');
const durationControls = document.querySelectorAll('.duration-control button, .duration-control input');

const MAX_SECONDS = 240 * 60 + 59;
let initialSeconds = 60;
let remainingSeconds = initialSeconds;
let remainingMs = initialSeconds * 1000;
let endTime = 0;
let running = false;
let timerId = null;
let audioContext;

function formatTime(total) {
  return [Math.floor(total / 60), total % 60].map(value => String(value).padStart(2, '0'));
}
function render() {
  const [minutes, seconds] = formatTime(remainingSeconds);
  minutesEl.textContent = minutes;
  secondsEl.textContent = seconds;
  progressFill.style.width = `${((initialSeconds - remainingSeconds) / initialSeconds) * 100}%`;
}
function chirp(final = false) {
  if (!soundEnabled.checked) return;
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const length = final ? .9 : .45;
  oscillator.type = 'square';
  oscillator.frequency.value = final ? 880 : 740;
  gain.gain.setValueAtTime(.001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.18, audioContext.currentTime + .025);
  gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + length);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(); oscillator.stop(audioContext.currentTime + length);
}
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
function setControlsLocked(locked) { durationControls.forEach(control => { control.disabled = locked; }); }
function stopTimer() {
  clearInterval(timerId); timerId = null; running = false; setControlsLocked(false);
  startButton.innerHTML = '<span class="play-icon">▶</span> START ROUTE';
}
// Time is derived from a wall-clock end time, so throttled background tabs don't drift.
function tick() {
  remainingMs = Math.max(0, endTime - Date.now());
  const left = Math.ceil(remainingMs / 1000);
  if (left === remainingSeconds) return;
  const interval = Number(beepInterval.value);
  const beepsPassed = Math.floor((remainingSeconds - 1) / interval) - Math.floor((Math.max(left, 1) - 1) / interval);
  remainingSeconds = left;
  render();
  if (remainingSeconds === 0) { stopTimer(); statusText.textContent = 'COMPLETE'; chirp(true); }
  else if (beepsPassed > 0) chirp();
}
function startTimer() {
  if (running) { remainingMs = Math.max(0, endTime - Date.now()); stopTimer(); statusText.textContent = 'PAUSED'; return; }
  if (remainingSeconds === 0) resetTimer();
  running = true; statusText.textContent = 'IN PROGRESS';
  startButton.innerHTML = 'Ⅱ PAUSE ROUTE';
  setControlsLocked(true);
  endTime = Date.now() + remainingMs;
  timerId = setInterval(tick, 200);
}
function resetTimer() {
  stopTimer();
  const total = readDuration();
  writeDuration(total);
  initialSeconds = total; remainingSeconds = total; remainingMs = total * 1000;
  statusText.textContent = 'READY'; render();
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
soundEnabled.addEventListener('change', () => soundDetails.classList.toggle('disabled', !soundEnabled.checked));
startButton.addEventListener('click', startTimer); resetButton.addEventListener('click', resetTimer);
document.querySelector('#testSound').addEventListener('click', () => chirp());
resetTimer();
