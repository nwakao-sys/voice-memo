'use strict';

/* ============================================================
   AI音声メモ → Obsidian  —  Android Chrome 専用 PWA
   録音(Web Speech API) → Claude清書(個人辞書注入) → 自動コピー
   → Obsidian新規ノート保存。Typeless風の再加工ボタン付き。
   ============================================================ */

// ---- localStorage キー ----
const LS = {
  key: 'voicememo.apiKey',
  model: 'voicememo.model',
  dict: 'voicememo.dict',
  vault: 'voicememo.obsVault',
  folder: 'voicememo.obsFolder',
  fname: 'voicememo.obsFname',
  autoObs: 'voicememo.autoObs',
  driveUrl: 'voicememo.driveUrl',
};

const DEFAULTS = {
  model: 'claude-haiku-4-5',   // 軽量・低コスト既定（docs.claude.com準拠）
  vault: 'あとづけ屋_Wiki_Raw',
  folder: '音声メモ',
  fname: 'YYYY-MM-DD_HHmm',
};

const API_URL = 'https://api.anthropic.com/v1/messages';

// 清書 systemプロンプト（依頼文言を厳密使用。末尾に個人辞書を動的追記）
const BASE_SYSTEM =
  '入力された音声認識テキストの誤字脱字、噛んだ表現、\'あー\'や\'えーっと\'などの不要な言葉を取り除き、' +
  '文脈をスマートに整えた読みやすい長文（日本語）に整形してください。話の流れに応じて適切に段落・' +
  '箇条書き・番号リストを使い、構造化してください。余計な挨拶や解説は一切含めず、整形後の本文のみを' +
  '出力してください。';

// 再加工（Typeless風）の systemプロンプト
const TOOL_SYSTEM = {
  short:   '次の日本語テキストを、要点を保ったまま簡潔に短くまとめてください。意味を変えず冗長な部分を削ります。整形後の本文のみを出力してください。',
  long:    '次の日本語テキストを、文意を保ったまま具体例や補足を加えて詳しく肉付けし、読み応えのある長文にしてください。整形後の本文のみを出力してください。',
  formal:  '次の日本語テキストを、丁寧で論理的なビジネス文書調（です・ます／敬体）に整えてください。意味は変えません。整形後の本文のみを出力してください。',
  casual:  '次の日本語テキストを、親しみやすく自然なくだけた口調に書き直してください。意味は変えません。整形後の本文のみを出力してください。',
  bullets: '次の日本語テキストを、論点ごとに整理した構造化された箇条書き（必要なら見出し・番号リスト併用）に変換してください。整形後の本文のみを出力してください。',
};

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const els = {
  main: $('main'), settings: $('settings'),
  settingsBtn: $('settingsBtn'), settingsCloseBtn: $('settingsCloseBtn'),
  recordBtn: $('recordBtn'), status: $('status'),
  interim: $('interim'), result: $('result'),
  tools: $('tools'), langSelect: $('langSelect'),
  copyBtn: $('copyBtn'), obsidianBtn: $('obsidianBtn'),
  apiKey: $('apiKey'), model: $('model'), dict: $('dict'),
  obsVault: $('obsVault'), obsFolder: $('obsFolder'), obsFname: $('obsFname'),
  autoObs: $('autoObs'), driveUrl: $('driveUrl'),
  saveBtn: $('saveBtn'), toggleKey: $('toggleKey'),
  installBtn: $('installBtn'), toast: $('toast'),
};

// ---- 状態 ----
let recognition = null;
let isRecording = false;   // ユーザーが録音中とみなす状態（onend自動再開の判定）
let finalText = '';        // 確定認識テキストの蓄積
let baseRefined = '';      // 最初の清書結果（「元に戻す」用に保持）
let currentText = '';      // 現在画面表示中のテキスト

// ============================================================
// 設定の取得
// ============================================================
const get = (k, d = '') => localStorage.getItem(k) ?? d;
const getKey = () => get(LS.key);
const getModel = () => get(LS.model) || DEFAULTS.model;
const getDict = () => get(LS.dict).trim();
const getVault = () => get(LS.vault) || DEFAULTS.vault;
const getFolder = () => get(LS.folder, DEFAULTS.folder);
const getFname = () => get(LS.fname) || DEFAULTS.fname;
const getAutoObs = () => get(LS.autoObs, '1') === '1'; // 既定ON
const getDriveUrl = () => get(LS.driveUrl).trim();

function setStatus(t) { els.status.textContent = t; }

let toastTimer = null;
function toast(msg, type = '') {
  els.toast.textContent = msg;
  els.toast.className = 'toast ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2800);
}

// ============================================================
// 画面遷移・設定フォーム
// ============================================================
function showSettings() {
  els.apiKey.value = getKey();
  els.model.value = getModel();
  els.dict.value = get(LS.dict);
  els.obsVault.value = getVault();
  els.obsFolder.value = getFolder();
  els.obsFname.value = getFname();
  els.autoObs.checked = getAutoObs();
  els.driveUrl.value = getDriveUrl();
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
  localStorage.setItem(LS.key, key);
  localStorage.setItem(LS.model, els.model.value.trim() || DEFAULTS.model);
  localStorage.setItem(LS.dict, els.dict.value);
  localStorage.setItem(LS.vault, els.obsVault.value.trim() || DEFAULTS.vault);
  localStorage.setItem(LS.folder, els.obsFolder.value.trim());
  localStorage.setItem(LS.fname, els.obsFname.value.trim() || DEFAULTS.fname);
  localStorage.setItem(LS.autoObs, els.autoObs.checked ? '1' : '0');
  localStorage.setItem(LS.driveUrl, els.driveUrl.value.trim());
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
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      isRecording = false; setRecordingUI(false);
      toast('マイクが拒否されています。ブラウザ設定で許可してください', 'err');
      setStatus('マイク権限が必要です');
    } else if (e.error === 'audio-capture') {
      isRecording = false; setRecordingUI(false);
      toast('マイクが見つかりません', 'err');
      setStatus('待機中');
    } else if (e.error === 'network') {
      toast('音声認識サーバーに接続できません', 'err');
    } else if (e.error === 'language-not-supported') {
      toast('この端末は日本語音声認識に未対応です', 'err');
    }
    setStatus('認識エラー: ' + e.error + (isRecording ? '（再開中）' : ''));
  };

  r.onend = () => {
    // ユーザーが止めていなければ自動再開（Androidは数十秒で勝手に切れる）
    if (isRecording) { try { r.start(); } catch (_) {} }
  };

  return r;
}

function setRecordingUI(on) {
  els.recordBtn.classList.toggle('recording', on);
  els.recordBtn.setAttribute('aria-label', on ? '録音停止' : '録音開始');
}

async function ensureMicPermission() {
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
  if (!getKey()) { toast('先にAPIキーを設定してください', 'err'); showSettings(); return; }
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
  els.tools.classList.add('hidden');
  baseRefined = ''; currentText = '';

  isRecording = true;
  setRecordingUI(true);
  setStatus('録音中…');
  try { recognition.start(); } catch (_) {}
}

function stopRecording() {
  isRecording = false;       // onendでの自動再開を止める
  setRecordingUI(false);
  if (recognition) { try { recognition.stop(); } catch (_) {} }

  setStatus('整えています…');
  setTimeout(() => {
    const text = (finalText + ' ' + (els.interim.textContent || '')).trim();
    els.interim.textContent = text ? '🎙 認識: ' + text : '';
    if (!text || text.replace(/[\s。、.,「」]/g, '').length === 0) {
      setStatus('待機中');
      els.interim.textContent = '';
      els.result.textContent =
        '⚠️ 音声が認識されませんでした。\n・Android Chromeで開いているか\n・マイクが「許可」か（アドレスバーの🔒）\n・話し始めてから1〜2秒待つ\nを確認してもう一度お試しください。';
      toast('音声が認識されませんでした', 'err');
      return;
    }
    refineFirst(text);
  }, 600);
}

els.recordBtn.addEventListener('click', () => {
  if (isRecording) stopRecording();
  else startRecording();
});

// ============================================================
// Claude 呼び出し（共通）
// ============================================================
async function callClaude(systemPrompt, userText) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true', // ブラウザ直叩きCORS回避に必須
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || ''; } catch (_) {}
    throw new Error(`API エラー (${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  const out = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!out) throw new Error('空の応答が返りました');
  return out;
}

// 個人辞書を清書プロンプトに動的注入
function refineSystem() {
  const dict = getDict();
  if (!dict) return BASE_SYSTEM;
  const terms = dict.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join('、');
  if (!terms) return BASE_SYSTEM;
  return BASE_SYSTEM + `\n次の固有名詞・専門用語は正しい表記を優先：${terms}`;
}

// 最初の清書
async function refineFirst(rawText) {
  if (!rawText || !rawText.trim()) { setStatus('待機中'); toast('音声が認識されませんでした', 'err'); return; }
  setBusy(true);
  setStatus('AIが清書中…');
  try {
    const out = await callClaude(refineSystem(), rawText);
    baseRefined = out;
    showResult(out, true);
    setStatus('完了');
  } catch (err) {
    setStatus('待機中');
    toast(err.message || '通信エラー', 'err');
  } finally {
    setBusy(false);
  }
}

// 再加工（短く/長く/フォーマル/カジュアル/箇条書き/翻訳）
async function reprocess(act) {
  if (!currentText) return;
  if (act === 'restore') {
    if (baseRefined) { showResult(baseRefined, true); toast('元の清書に戻しました', 'ok'); }
    return;
  }
  let system;
  if (act === 'translate') {
    const lang = els.langSelect.value || '英語';
    system = `次の日本語テキストを自然で正確な${lang}に翻訳してください。訳文のみを出力し、余計な説明や原文は含めないでください。`;
    setStatus(`${lang}に翻訳中…`);
  } else {
    system = TOOL_SYSTEM[act];
    if (!system) return;
    setStatus('再加工中…');
  }
  setBusy(true);
  try {
    const out = await callClaude(system, currentText);
    showResult(out, true);
    setStatus('完了');
  } catch (err) {
    setStatus('完了');
    toast(err.message || '通信エラー', 'err');
  } finally {
    setBusy(false);
  }
}

// 機能ボタンのイベント委譲
els.tools.addEventListener('click', (e) => {
  const btn = e.target.closest('.tool-btn');
  if (!btn || !btn.dataset.act) return;
  reprocess(btn.dataset.act);
});

function setBusy(on) { els.recordBtn.classList.toggle('busy', on); }

// 結果表示＋（自動コピー／自動Obsidian保存）
function showResult(text, doSideEffects) {
  currentText = text;
  els.result.textContent = text;
  els.tools.classList.remove('hidden');
  if (doSideEffects) {
    copyToClipboard(text, true);
    if (getDriveUrl()) saveToDrive(text);
    if (getAutoObs()) saveToObsidian(text);
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
    throw new Error('no clipboard api');
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) toast('コピー完了', 'ok'); else throw new Error('execCommand fail');
    } catch (_) {
      toast(isAuto ? '自動コピー不可。コピーボタンを押してください' : 'コピーできませんでした', 'err');
    }
  }
}
els.copyBtn.addEventListener('click', () => { if (currentText) copyToClipboard(currentText, false); });

// ============================================================
// Obsidian 保存（obsidian://new で新規ノート作成）
// ============================================================
function buildFileName() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const map = {
    YYYY: d.getFullYear(), MM: p(d.getMonth() + 1), DD: p(d.getDate()),
    HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds()),
  };
  let name = getFname().replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => map[t]);
  // 同名衝突を避けるため、テンプレートに秒が無ければ秒を付与
  if (!/ss/.test(getFname())) name += '-' + map.ss;
  return name.replace(/[\\/:*?"<>|]/g, '-'); // ファイル名に使えない文字を除去
}

function saveToObsidian(text, isManual) {
  const vault = getVault();
  const folder = getFolder();
  const fname = buildFileName();
  const path = folder ? `${folder}/${fname}` : fname;

  const uri = 'obsidian://new'
    + '?vault=' + encodeURIComponent(vault)
    + '&file=' + encodeURIComponent(path)
    + '&content=' + encodeURIComponent(text);

  // Obsidian未起動/未インストール検出のための簡易ヒューリスティック
  let switched = false;
  const onHide = () => { switched = true; };
  document.addEventListener('visibilitychange', onHide, { once: true });

  try {
    window.location.href = uri;
  } catch (_) {
    toast('Obsidianを開けませんでした', 'err');
    return;
  }

  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    if (!switched && !document.hidden) {
      toast('Obsidianが開きません。インストール状況とvault名を確認してください', 'err');
    } else {
      toast('Obsidianに保存しました', 'ok');
    }
  }, 1500);
}
els.obsidianBtn.addEventListener('click', () => { if (currentText) saveToObsidian(currentText, true); });

// ============================================================
// Google Drive 保存（任意・GAS Web App へ fire-and-forget POST）
// ============================================================
async function saveToDrive(text) {
  const url = getDriveUrl();
  if (!url) return;
  try {
    // text/plain + no-cors でCORSプリフライトを回避（GAS doPostでJSON解析）
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ text, at: new Date().toISOString() }),
    });
    // no-corsは応答を読めないため成功可否は確定できない（送信完了のみ）
  } catch (_) {
    toast('Drive保存に失敗（URLを確認）', 'err');
  }
}

// ============================================================
// PWA: Service Worker 登録（相対パス）
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ============================================================
// インストール体験（beforeinstallprompt）
// ============================================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!sessionStorage.getItem('installDismissed')) els.installBtn.classList.remove('hidden');
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
