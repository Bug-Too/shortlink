'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  input: $('input'),
  paste: $('paste'),
  clean: $('clean'),
  go: $('go'),
  note: $('note'),
  result: $('result'),
  shortUrl: $('short-url'),
  copy: $('copy'),
  share: $('share'),
  open: $('open'),
  qrCard: $('qr-card'),
  qr: $('qr'),
  qrFor: $('qr-for'),
  saveQr: $('save-qr'),
  shareQr: $('share-qr'),
  poster: $('poster'),
  recentSection: $('recent-section'),
  recent: $('recent'),
  forget: $('forget'),
  toast: $('toast'),
  scratch: $('scratch'),
};

const HISTORY_KEY = 'shortlink.history';
const MAX_HISTORY = 20;

// Always black on white: it scans from any screen, in either page theme.
const QR_DARK = '#18181b';
const QR_LIGHT = '#ffffff';

// Params that only exist to track you. Stripped when the box is ticked.
const JUNK_PARAMS = [
  /^utm_/i, /^ga_/i, /^mc_/i, /^pk_/i, /^hsa_/i, /^vero_/i,
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'twclid', 'ttclid',
  'igshid', 'igsh', 'si', 'feature', 'ref_src', 'ref_url',
  '_t', '_r', '_d', 'is_from_webapp', 'sender_device', 'sender_web_id', 'web_id',
  'share_app_id', 'share_link_id', 'share_item_id', 'share_iid', 'tt_from',
  'u_code', 'ug_btm', 'social_share_type', 'enter_method', 'checksum',
  'preview_pb', 'iid', 'timestamp',
];

const state = {
  qrText: '',
  short: null,
  history: [],
};

/* ------------------------------------------------------------- helpers */

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2000);
}

function note(message, isError = false) {
  el.note.textContent = message || '';
  el.note.hidden = !message;
  el.note.classList.toggle('is-error', Boolean(isError));
}

// Never rejects: a blocked clipboard should not fail the action that used it.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
    return true;
  } catch { /* fall through to the legacy path */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? 'Copied' : 'Press and hold the link to copy');
    return ok;
  } catch {
    toast('Press and hold the link to copy');
    return false;
  }
}

/* ------------------------------------------------------------ the link */

function parseUrl(raw) {
  const text = (raw ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Something like "hello:" parses but is not a web address.
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) return null;
  return url;
}

function stripJunk(url) {
  const copy = new URL(url);
  let removed = 0;
  for (const key of [...copy.searchParams.keys()]) {
    const junk = JUNK_PARAMS.some((rule) =>
      rule instanceof RegExp ? rule.test(key) : rule === key.toLowerCase());
    if (junk) {
      copy.searchParams.delete(key);
      removed += 1;
    }
  }
  return { url: copy, removed };
}

/* ----------------------------------------------------------- shortening */

const PROVIDERS = [
  {
    name: 'spoo.me',
    async run(target) {
      const res = await fetch('https://spoo.me/', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: target }),
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!data.short_url) throw new Error('empty');
      return data.short_url.replace(/^http:\/\//, 'https://');
    },
  },
  {
    name: 'da.gd',
    async run(target) {
      const res = await fetch(`https://da.gd/shorten?url=${encodeURIComponent(target)}`,
        { signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.text()).trim();
    },
  },
  {
    name: 'clck.ru',
    async run(target) {
      const res = await fetch(`https://clck.ru/--?url=${encodeURIComponent(target)}`,
        { signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.text()).trim();
    },
  },
];

async function shorten(target) {
  for (const provider of PROVIDERS) {
    try {
      const short = await provider.run(target);
      if (/^https?:\/\/\S+$/.test(short)) return short;
    } catch { /* try the next one */ }
  }
  throw new Error('No service answered.');
}

/* ------------------------------------------------------------------ qr */

function drawQr(text) {
  state.qrText = text;
  if (!text) {
    el.qrCard.hidden = true;
    return;
  }
  try {
    QRCode.toCanvas(el.qr, text, {
      width: 512,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: QR_DARK, light: QR_LIGHT },
    });
    // toCanvas writes inline pixel sizing; let the tile decide instead.
    el.qr.style.width = '100%';
    el.qr.style.height = 'auto';
    el.qrCard.hidden = false;
    el.qrFor.textContent = state.short === text ? 'Opens your short link' : text;
  } catch {
    el.qrCard.hidden = true;
    note('That is a bit too long for one QR code.', true);
  }
}

function qrCanvas(size = 1024) {
  const canvas = document.createElement('canvas');
  QRCode.toCanvas(canvas, state.qrText, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: QR_DARK, light: QR_LIGHT },
  });
  return canvas;
}

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareOrSave(blob, filename, title) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  downloadBlob(blob, filename);
  toast('Saved');
}

/* --------------------------------------------------- poster (1080×1350) */

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const char of text) {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

async function makePoster() {
  const W = 1080;
  const H = 1350;
  const canvas = el.scratch;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const size = 620;
  const x = (W - size) / 2;
  const y = 300;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas(1024), x, y, size, size);
  ctx.imageSmoothingEnabled = true;

  const label = (state.short || state.qrText).replace(/^https?:\/\//, '');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#18181b';
  ctx.font = '600 44px ui-monospace, SFMono-Regular, Menlo, monospace';
  const lines = wrapText(ctx, label, W - 160);
  lines.forEach((line, i) => ctx.fillText(line, W / 2, y + size + 110 + i * 58));

  ctx.fillStyle = '#71717a';
  ctx.font = '400 32px -apple-system, system-ui, sans-serif';
  ctx.fillText('Scan to open', W / 2, y + size + 110 + lines.length * 58 + 26);

  return canvasBlob(canvas);
}

/* ------------------------------------------------------------- history */

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    state.history = Array.isArray(raw) ? raw.slice(0, MAX_HISTORY) : [];
  } catch {
    state.history = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch { /* private mode: history simply will not persist */ }
}

function remember(short, target) {
  state.history = [{ short, url: target, at: Date.now() },
    ...state.history.filter((item) => item.short !== short)].slice(0, MAX_HISTORY);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  el.recent.textContent = '';
  el.recentSection.hidden = state.history.length === 0;

  for (const item of state.history) {
    const li = document.createElement('li');
    li.className = 'recent-item';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'recent-main';

    const short = document.createElement('div');
    short.className = 'recent-short';
    short.textContent = item.short.replace(/^https?:\/\//, '');

    const target = document.createElement('div');
    target.className = 'recent-target';
    target.textContent = item.url.replace(/^https?:\/\//, '');

    main.append(short, target);
    main.addEventListener('click', () => {
      state.short = item.short;
      showResult(item.short);
      drawQr(item.short);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'recent-copy';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => copyText(item.short));

    li.append(main, copy);
    el.recent.append(li);
  }
}

/* ----------------------------------------------------------------- ui */

function showResult(short) {
  el.shortUrl.textContent = short.replace(/^https?:\/\//, '');
  el.open.href = short;
  el.result.hidden = false;
  el.copy.onclick = () => copyText(short);
  el.shortUrl.onclick = () => copyText(short);
  el.share.onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Short link', url: short });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    copyText(short);
  };
}

function refreshInputState() {
  const text = el.input.value.trim();

  if (!text) {
    el.go.disabled = true;
    note('');
    drawQr('');
    return;
  }

  const url = parseUrl(text);
  el.go.disabled = !url;
  note(url ? '' : 'Not a link — the QR code below still works.');

  if (state.short !== text) state.short = null;
  drawQr(url ? url.toString() : text);
}

async function handleShorten() {
  const url = parseUrl(el.input.value);
  if (!url) return;

  let target = url.toString();
  if (el.clean.checked) {
    const { url: cleaned, removed } = stripJunk(url);
    target = cleaned.toString();
    if (removed) toast(`Removed ${removed} tracking bit${removed === 1 ? '' : 's'}`);
  }

  el.go.disabled = true;
  el.go.textContent = 'Working…';
  note('');

  try {
    const short = await shorten(target);
    state.short = short;
    showResult(short);
    drawQr(short);
    remember(short, target);
    await copyText(short);
  } catch {
    note('Could not make a short link right now. Check your connection and try again.', true);
  } finally {
    el.go.disabled = false;
    el.go.textContent = 'Shorten';
  }
}

/* --------------------------------------------------------------- wiring */

el.input.addEventListener('input', refreshInputState);
el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleShorten();
  }
});

el.go.addEventListener('click', handleShorten);

el.paste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return toast('Clipboard is empty');
    el.input.value = text.trim();
    refreshInputState();
  } catch {
    el.input.focus();
    toast('Long-press the box to paste');
  }
});

el.saveQr.addEventListener('click', async () => {
  downloadBlob(await canvasBlob(qrCanvas(1024)), 'qr-code.png');
  toast('Saved');
});

el.shareQr.addEventListener('click', async () => {
  await shareOrSave(await canvasBlob(qrCanvas(1024)), 'qr-code.png', 'QR code');
});

el.poster.addEventListener('click', async () => {
  el.poster.disabled = true;
  try {
    await shareOrSave(await makePoster(), 'qr-poster.png', 'QR code');
  } finally {
    el.poster.disabled = false;
  }
});

el.forget.addEventListener('click', () => {
  state.history = [];
  saveHistory();
  renderHistory();
  toast('Cleared');
});

loadHistory();
renderHistory();
refreshInputState();
