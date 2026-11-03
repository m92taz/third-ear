"use strict";

const LANG = { fr: { tts: "fr-FR", name: "French" }, en: { tts: "en-US", name: "English" } };
const DAY = 86400000;
const KEY = "thirdear.v1";

// ---------- state ----------
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) return s;
  } catch (e) {}
  const cards = FR_STARTER.map(([front, back], i) => ({
    id: "fr" + i, track: "fr", front, back, interval: 0, due: 0, reps: 0,
  }));
  return { cards, log: {}, done: {}, track: "fr", tab: "today" };
}
let S = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

const today = () => new Date().toISOString().slice(0, 10);
const logDay = () => (S.log[today()] ||= { listen: 0, reviews: 0, spoken: 0 });
const dueCards = () => S.cards.filter(c => c.track === S.track && c.due <= Date.now());

// ---------- speech ----------
function say(text, lang) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/…/g, ""));
  u.lang = lang; u.rate = 0.85;
  const v = speechSynthesis.getVoices().find(v => v.lang.replace("_", "-") === lang);
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const view = $("#view");

function streak() {
  let n = 0, d = new Date();
  if (!S.log[d.toISOString().slice(0, 10)]) d = new Date(d - DAY);
  while (S.log[d.toISOString().slice(0, 10)]) { n++; d = new Date(d - DAY); }
  return n;
}

// ---------- Today ----------
function renderToday() {
  const t = S.track, L = LANG[t], l = logDay();
  const k = today() + t;
  const done = (S.done[k] ||= {});
  const list = TASKS[t];
  const task = list[Math.floor(Date.now() / DAY) % list.length];
  const due = dueCards().length;
  const items = [
    ["listen", `Brain soak: listen to ${L.name} for 20+ minutes (podcast, radio, show). Logged: ${l.listen} min.`],
    ["review", `Review your cards (${due} due).`],
    ["speak", "Say 5 phrases out loud in the Speak tab."],
    ["real", "Real-life task: " + task],
  ];
  view.innerHTML = `
    <div class="card"><div class="stats">
      <div><b>${streak()}</b><span class="muted">day streak</span></div>
      <div><b>${l.listen}</b><span class="muted">min listened</span></div>
      <div><b>${l.reviews + l.spoken}</b><span class="muted">phrases used</span></div>
    </div></div>
    <div class="card"><h2>Today's plan · ${L.name}</h2>
      ${items.map(([id, txt]) => `<label class="task"><input type="checkbox" data-task="${id}" ${done[id] ? "checked" : ""}><span>${esc(txt)}</span></label>`).join("")}
    </div>
    <div class="card"><h2>Log listening time</h2>
      <p class="muted">Immersion counts most. Add the minutes you listened.</p>
      <div class="row"><button class="btn alt" data-add="10">+10 min</button><button class="btn alt" data-add="30">+30 min</button></div>
    </div>
    <p class="muted">The goal is results, not completed lessons: can you understand and say more than last week?</p>`;
  view.querySelectorAll("[data-task]").forEach(el => el.onchange = () => { done[el.dataset.task] = el.checked; save(); });
  view.querySelectorAll("[data-add]").forEach(el => el.onclick = () => { logDay().listen += +el.dataset.add; save(); renderToday(); });
}

// ---------- Review (spaced repetition) ----------
let current = null, revealed = false;
function renderReview() {
  const due = dueCards();
  if (!due.length) {
    view.innerHTML = `<div class="card"><h2>All done</h2><p class="muted">No cards due. Add words you meet in real life in the Cards tab.</p></div>`;
    return;
  }
  current = current && due.includes(current) ? current : due[Math.floor(Math.random() * due.length)];
  const c = current, tts = LANG[c.track].tts;
  const fr = c.track === "fr";
  // French: hear it first (sounds before spelling). English: see the word, recall the meaning.
  view.innerHTML = `
    <p class="muted">${due.length} due</p>
    <div class="card">
      ${fr && !revealed ? `<p class="muted" style="text-align:center">Listen first. What do you think it means?</p>` : ""}
      <div class="big">${fr && !revealed ? "🔊" : esc(c.front)}</div>
      ${revealed ? `<div class="big" style="font-weight:400">${esc(c.back)}</div>` : ""}
      <div class="row">
        <button class="btn alt" id="play">Play</button>
        ${revealed ? "" : `<button class="btn" id="show">Show</button>`}
      </div>
    </div>
    ${revealed ? `<div class="row">
      <button class="btn bad" data-g="0">Again</button>
      <button class="btn alt" data-g="1">Good</button>
      <button class="btn" data-g="2">Easy</button></div>` : ""}`;
  $("#play").onclick = () => say(c.front, tts);
  if (fr && !revealed) say(c.front, tts);
  if ($("#show")) $("#show").onclick = () => { revealed = true; renderReview(); };
  view.querySelectorAll("[data-g]").forEach(b => b.onclick = () => grade(c, +b.dataset.g));
}
function grade(c, g) {
  c.reps++;
  c.interval = g === 0 ? 0 : g === 1 ? Math.max(1, Math.round((c.interval || 0.5) * 2)) : Math.max(3, Math.round((c.interval || 1) * 3.5));
  c.due = g === 0 ? Date.now() + 60000 : Date.now() + c.interval * DAY;
  logDay().reviews++;
  current = null; revealed = false;
  save(); renderReview();
}

// ---------- Speak (record and compare) ----------
let rec = null, chunks = [], myUrl = null, speakId = null;
function renderSpeak() {
  const cards = S.cards.filter(c => c.track === S.track);
  if (!cards.length) { view.innerHTML = `<div class="card">Add some cards first.</div>`; return; }
  speakId = cards.some(c => c.id === speakId) ? speakId : cards[0].id;
  const c = cards.find(c => c.id === speakId);
  view.innerHTML = `
    <div class="card">
      <select id="pick">${cards.map(x => `<option value="${x.id}" ${x.id === speakId ? "selected" : ""}>${esc(x.front)}</option>`).join("")}</select>
      <div class="big">${esc(c.front)}</div>
      <p class="muted" style="text-align:center">${esc(c.back)}</p>
      <div class="row"><button class="btn alt" id="model">1. Hear it</button>
      <button class="btn" id="rec">2. Record</button></div>
      <div id="mine"></div>
    </div>
    <p class="muted">Hear it, say it, play yourself back, repeat. Aim for rhythm and sound, not perfection.</p>`;
  $("#pick").onchange = e => { speakId = e.target.value; myUrl = null; renderSpeak(); };
  $("#model").onclick = () => say(c.front, LANG[c.track].tts);
  $("#rec").onclick = toggleRec;
  if (myUrl) showMine();
}
function showMine() { $("#mine").innerHTML = `<audio controls src="${myUrl}"></audio>`; }
async function toggleRec() {
  const btn = $("#rec");
  if (rec && rec.state === "recording") { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec = new MediaRecorder(stream); chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      myUrl = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
      logDay().spoken++; save();
      if ($("#rec")) { $("#rec").textContent = "2. Record"; showMine(); }
    };
    rec.start(); btn.textContent = "■ Stop";
  } catch (e) { $("#mine").innerHTML = `<p class="muted">Microphone not available. Allow it in Safari settings.</p>`; }
}

// ---------- Cards ----------
function renderCards() {
  const t = S.track, mine = S.cards.filter(c => c.track === t);
  view.innerHTML = `
    <div class="card"><h2>Add a ${LANG[t].name} card</h2>
      <input type="text" id="f" placeholder="${t === "fr" ? "French word or phrase" : "English word or phrase"}" autocapitalize="off">
      <input type="text" id="b" placeholder="${t === "fr" ? "Meaning" : "Meaning or example sentence"}">
      <button class="btn" id="add" style="width:100%">Add</button></div>
    <div class="card"><h2>${mine.length} cards</h2>
      ${mine.slice().reverse().map(c => `<div class="list-item"><span>${esc(c.front)}<br><span class="muted">${esc(c.back)}</span></span><button data-del="${c.id}">Delete</button></div>`).join("") || `<p class="muted">Nothing yet.</p>`}
    </div>`;
  $("#add").onclick = () => {
    const f = $("#f").value.trim(), b = $("#b").value.trim();
    if (!f || !b) return;
    S.cards.push({ id: t + Date.now(), track: t, front: f, back: b, interval: 0, due: 0, reps: 0 });
    save(); renderCards();
  };
  view.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { S.cards = S.cards.filter(c => c.id !== b.dataset.del); save(); renderCards(); });
}

// ---------- shell ----------
const TABS = { today: renderToday, review: renderReview, speak: renderSpeak, cards: renderCards };
function render() {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === S.tab));
  document.querySelectorAll(".tracks button").forEach(b => b.classList.toggle("active", b.dataset.track === S.track));
  TABS[S.tab]();
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; current = null; revealed = false; save(); render(); });
document.querySelectorAll(".tracks button").forEach(b => b.onclick = () => { S.track = b.dataset.track; current = null; revealed = false; speakId = null; myUrl = null; save(); render(); });
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
