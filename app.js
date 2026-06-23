'use strict';

/* ============================================================
   AI音声メモ  —  Android Chrome 専用 PWA
   録音(Web Speech API) → Claude(haiku)清書 → 自動コピー
   ============================================================ */

const LS_KEY = 'voicememo.apiKey';
const LS_MODEL = 'voicememo.model';
const DEFAULT_MODEL = 'claude-haiku-4-5'; // 軽量・低コスト既定。docs.claude.com準拠。
const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT =
  '入力された音声認識テキストの誤字脱字、噛んだ表現、\'あー\'や\'えーっと\'などの不要な言葉を取り除き、' +
  '文脈をスマートに整えた読みやすい長文（日本語）に整形してください。' +
  '余計な挨拶や解説は一切含めず、整形後の本文のみを出力してください。';

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const els = {
  main: $('main'), settings: $('settings'),
  settingsBtn: $('settingsBtn'), settingsCloseBtn: $('settingsCloseBtn'),
  recordBtn: $('recordBtn'), status: $('status'),
  interim: $('interim'), result: $('result'), copyBtn: $('copyBtn'),
  apiKey: $('apiKey'), model: $('model'), saveBtn: $('saveBtn'), toggleKey: $('toggleKey'),
  installBtn: $('installBtn'), toast: $('toast'),
};

// ---- 状態 ----
let recognition = null;
let isRecording = false;   // ユーザーが録音中とみなす状態（onendの自動再開判定に使用）
let finalText = '';        // 確定した認識テキストの蓄積
let lastResult = '';       // 直近の清書結果

// ============================================================
// ユーティリティ
// ============================================================
function getKey() { return localStorage.getItem(LS_KEY) || ''; }
function getModel() { return localStorage.getItem(LS_MODEL) || DEFAULT_MODEL; }

function setStatus(t) { els.status.textContent = t; }

let toastTimer = null;
function toast(msg, type = '') {
  els.toast.textContent = msg;
  els.toast.className = 'toast ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

// ============================================================
// 画面遷移
// ============================================================
function showSettings() {
  els.apiKey.value = getKey();
  els.model.value = getModel();
  els.settings.classList.remove('hidden');
}
function hideSettings() { els.settings.classList.add('hidden'); }

els.settingsBtn.addEventListener('click', showSettings);
els.settingsCloseBtn.addEventListener('click', () => {
  if (!getKey()) { toast('APIキーを保存してください', 'err'); return; }
  hideSettings();
});

els.toggleKey.addEventListener('click', () => {
  els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
});

els.saveBtn.addEventListener('click', () => {
  const key = els.apiKey.value.trim();
  if (!key) { toast('APIキーを入力してください', 'err'); return; }
  localStorage.setItem(LS_KEY, key);
  const model = els.model.value.trim();
  localStorage.setItem(LS_MODEL, model || DEFAULT_MODEL);
  hideSettings();
  toast('保存しました', 'ok');
});

// ============================================================
// 音声認識（Web Speech API）
// ============================================================
function buildRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'ja-JP';
  r.continuous = true;
  r.interimResults = true;

  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const seg = e.results[i];
      if (seg.isFinal) finalText += seg[0].transcript;
      else interim += seg[0].transcript;
    }
    els.interim.textContent = interim;
  };

  r.onerror = (e) => {
    // no-speech / aborted は自動再開で吸収。致命的なものだけ通知。
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      isRecording = false;
      setRecordingUI(false);
      toast('マイクが拒否されています。ブラウザ設定で許可してください', 'err');
      setStatus('マイク権限が必要です');
    } else if (e.error === 'audio-capture') {
      isRecording = false;
      setRecordingUI(false);
      toast('マイクが見つかりません', 'err');
      setStatus('待機中');
    } else if (e.error === 'network') {
      toast('音声認識サーバーに接続できません', 'err');
    } else if (e.error === 'language-not-supported') {
      toast('この端末は日本語音声認識に未対応です', 'err');
    }
    // 原因特定用：エラー種別を画面に表示（no-speech/aborted含む）
    setStatus('認識エラー: ' + e.error + (isRecording ? '（再開中）' : ''));
    // no-speech / aborted はonendで再開
  };

  r.onend = () => {
    // ユーザーが止めていなければ自動再開（Androidは数十秒で勝手に切れるため）
    if (isRecording) {
      try { r.start(); } catch (_) { /* 連続start例外は無視 */ }
    }
  };

  return r;
}

function setRecordingUI(on) {
  els.recordBtn.classList.toggle('recording', on);
  els.recordBtn.setAttribute('aria-label', on ? '録音停止' : '録音開始');
}

async function ensureMicPermission() {
  // 事前にgetUserMediaで権限を確定させ、明確な案内を出せるようにする
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      toast('マイクが拒否されています。アドレスバーの🔒からマイクを許可してください', 'err');
      setStatus('マイク権限が必要です');
    } else if (err && err.name === 'NotFoundError') {
      toast('マイクが見つかりません', 'err');
    } else {
      toast('マイクを利用できません', 'err');
    }
    return false;
  }
}

async function startRecording() {
  if (!getKey()) {
    toast('先にAPIキーを設定してください', 'err');
    showSettings();
    return;
  }
  if (!recognition) recognition = buildRecognition();
  if (!recognition) {
    toast('この端末/ブラウザは音声認識に未対応です（Android Chrome推奨）', 'err');
    return;
  }

  const ok = await ensureMicPermission();
  if (!ok) return;

  finalText = '';
  els.interim.textContent = '';
  els.result.textContent = '';
  els.copyBtn.classList.add('hidden');
  lastResult = '';

  isRecording = true;
  setRecordingUI(true);
  setStatus('録音中…');
  try { recognition.start(); }
  catch (_) { /* 既にstart済みの例外は無視 */ }
}

function stopRecording() {
  isRecording = false;       // onendでの自動再開を止める
  setRecordingUI(false);
  if (recognition) { try { recognition.stop(); } catch (_) {} }

  // 認識の最終結果が確定するまで少し待ってから清書へ
  setStatus('整えています…');
  setTimeout(() => {
    const text = (finalText + ' ' + (els.interim.textContent || '')).trim();
    els.interim.textContent = '';
    if (!text) {
      setStatus('待機中');
      toast('音声が認識されませんでした', 'err');
      return;
    }
    refineText(text);
  }, 600);
}

els.recordBtn.addEventListener('click', () => {
  if (isRecording) stopRecording();
  else startRecording();
});

// ============================================================
// Claude 清書（ブラウザ直叩き）
// ============================================================
async function refineText(rawText) {
  els.recordBtn.classList.add('busy');
  setStatus('AIが清書中…');

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': getKey(),
        'anthropic-version': '2023-06-01',
        // ブラウザ直叩きのCORS回避に必須
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: rawText }],
      }),
    });

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j && j.error && j.error.message) ? j.error.message : '';
      } catch (_) {}
      throw new Error(`API エラー (${res.status})${detail ? ': ' + detail : ''}`);
    }

    const data = await res.json();
    const out = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!out) throw new Error('空の応答が返りました');

    lastResult = out;
    els.result.textContent = out;
    els.copyBtn.classList.remove('hidden');
    setStatus('完了');
    await copyToClipboard(out, true);
  } catch (err) {
    setStatus('待機中');
    toast(err.message || '通信エラーが発生しました', 'err');
  } finally {
    els.recordBtn.classList.remove('busy');
  }
}

// ============================================================
// クリップボード（自動コピー＋フォールバック）
// ============================================================
async function copyToClipboard(text, isAuto) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast('コピー完了', 'ok');
      return;
    }
    throw new Error('clipboard API なし');
  } catch (_) {
    // フォールバック: 一時textareaでexecCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) toast('コピー完了', 'ok');
      else throw new Error('execCommand失敗');
    } catch (e2) {
      toast(isAuto ? '自動コピー不可。コピーボタンを押してください' : 'コピーできませんでした', 'err');
    }
  }
}

els.copyBtn.addEventListener('click', () => {
  if (lastResult) copyToClipboard(lastResult, false);
});

// ============================================================
// PWA: Service Worker 登録（相対パス）
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 失敗しても通常動作はする */ });
  });
}

// ============================================================
// インストール体験（beforeinstallprompt）
// ============================================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!sessionStorage.getItem('installDismissed')) {
    els.installBtn.classList.remove('hidden');
  }
});
els.installBtn.addEventListener('click', async () => {
  els.installBtn.classList.add('hidden');
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try { await deferredPrompt.userChoice; } catch (_) {}
  deferredPrompt = null;
  sessionStorage.setItem('installDismissed', '1');
});
window.addEventListener('appinstalled', () => {
  els.installBtn.classList.add('hidden');
  deferredPrompt = null;
});

// ============================================================
// 初期化
// ============================================================
(function init() {
  if (!getKey()) showSettings(); // 初回はキー未保存 → 設定画面
  setStatus('待機中');
})();
