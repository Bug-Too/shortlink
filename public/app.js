'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  input: $('input'),
  paste: $('paste'),
  clear: $('clear'),
  cleanToggle: $('clean-toggle'),
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
  swatches: $('swatches'),
  saveQr: $('save-qr'),
  shareQr: $('share-qr'),
  story: $('story'),
  recentSection: $('recent-section'),
  recent: $('recent'),
  forget: $('forget'),
  toast: $('toast'),
  scratch: $('scratch'),
};

const HISTORY_KEY = 'shortlink.history';
const THEME_KEY = 'shortlink.swatch';
const MAX_HISTORY = 30;

const PALETTES = [
  { id: 'ink', label: 'Black on white', dark: '#0b0b10', light: '#ffffff' },
  { id: 'pink', label: 'Pink', dark: '#fe2c55', light: '#ffffff' },
  { id: 'cyan', label: 'Teal', dark: '#0e7f7c', light: '#ffffff' },
  { id: 'night', label: 'White on black', dark: '#ffffff', light: '#0b0b10' },
];

// Params that only exist to track you. Stripped when the toggle is on.
const JUNK_PARAMS = [
  /^utm_/i, /^ga_/i, /^mc_/i, /^pk_/i, /^hsa_/i, /^vero_/i,
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'twclid', 'ttclid',
  'igshid', 'igsh', 'si', 'feature', 'ref_src', 'ref_url',
  // TikTok share links carry these
  '_t', '_r', '_d', 'is_from_webapp', 'sender_device', 'sender_web_id', 'web_id',
  'share_app_id', 'share_link_id', 'share_item_id', 'share_iid', 'tt_from',
  'u_code', 'ug_btm', 'social_share_type', 'enter_method', 'checksum',
  'preview_pb', 'iid', 'timestamp',
];

const state = {
  clean: true,
  palette: PALETTES[0],
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
    return true;
  } catch { /* older browsers, or clipboard blocked */ }
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
      color: { dark: state.palette.dark, light: state.palette.light },
    });
    // toCanvas writes inline pixel sizing; let the tile decide instead.
    el.qr.style.width = '100%';
    el.qr.style.height = 'auto';
    el.qrCard.hidden = false;
    el.qrFor.textContent = state.short === text ? 'Points to your short link' : text;
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
    color: { dark: state.palette.dark, light: state.palette.light },
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

/* --------------------------------------------------- story card (1080×1920) */

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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

async function makeStoryImage() {
  const W = 1080;
  const H = 1920;
  const canvas = el.scratch;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b0b10';
  ctx.fillRect(0, 0, W, H);

  const wash = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(11,11,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  wash(220, 380, 760, 'rgba(37,244,238,.34)');
  wash(880, 250, 700, 'rgba(254,44,85,.36)');
  wash(600, 1750, 800, 'rgba(254,44,85,.16)');

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 62px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.letterSpacing = '10px';
  ctx.fillText('SCAN ME', W / 2, 520);
  ctx.letterSpacing = '0px';

  const panel = 760;
  const px = (W - panel) / 2;
  const py = 640;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 26;
  // Always white: the QR paints its own background inside, so the panel is
  // just a frame that separates the code from the dark story background.
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, px, py, panel, panel, 60);
  ctx.fill();
  ctx.restore();

  const qr = qrCanvas(1024);
  const inset = 56;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, px + inset, py + inset, panel - inset * 2, panel - inset * 2);
  ctx.imageSmoothingEnabled = true;

  const label = state.short || state.qrText;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px ui-monospace, SFMono-Regular, Menlo, monospace';
  const lines = wrapText(ctx, label.replace(/^https?:\/\//, ''), W - 180);
  lines.forEach((line, i) => ctx.fillText(line, W / 2, py + panel + 130 + i * 60));

  // Keep the last 300px clear: that is where TikTok stacks its own buttons.
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.font = '600 34px -apple-system, system-ui, sans-serif';
  ctx.fillText('point your camera here', W / 2, py + panel + 130 + lines.length * 60 + 40);

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
      showResult(item.short, item.url);
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

function showResult(short, target) {
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
  el.result.dataset.target = target;
}

function refreshInputState() {
  const text = el.input.value.trim();
  el.clear.hidden = !text;
  el.go.disabled = !text;

  if (!text) {
    note('');
    drawQr('');
    return;
  }

  const url = parseUrl(text);
  el.go.textContent = url ? 'Shorten link' : 'Not a link';
  el.go.disabled = !url;
  if (!url) note('QR code below works for any text.');
  else note('');

  if (state.short !== text) state.short = null;
  drawQr(url ? url.toString() : text);
}

async function handleShorten() {
  const url = parseUrl(el.input.value);
  if (!url) return;

  let target = url.toString();
  if (state.clean) {
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
    showResult(short, target);
    drawQr(short);
    remember(short, target);
    await copyText(short);
  } catch {
    note('Could not make a short link right now. Check your connection and try again.', true);
  } finally {
    el.go.disabled = false;
    el.go.textContent = 'Shorten link';
  }
}

/* --------------------------------------------------------------- wiring */

function buildSwatches() {
  const saved = localStorage.getItem(THEME_KEY);
  state.palette = PALETTES.find((p) => p.id === saved) ?? PALETTES[0];

  for (const palette of PALETTES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.title = palette.label;
    button.setAttribute('aria-label', palette.label);
    button.style.background = palette.light;
    button.style.setProperty('--fg', palette.dark);
    button.classList.toggle('is-on', palette.id === state.palette.id);
    button.addEventListener('click', () => {
      state.palette = palette;
      try { localStorage.setItem(THEME_KEY, palette.id); } catch { /* ignore */ }
      for (const other of el.swatches.children) other.classList.remove('is-on');
      button.classList.add('is-on');
      drawQr(state.qrText);
    });
    el.swatches.append(button);
  }
}

el.input.addEventListener('input', refreshInputState);
el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleShorten();
  }
});

el.go.addEventListener('click', handleShorten);

el.clear.addEventListener('click', () => {
  el.input.value = '';
  state.short = null;
  el.result.hidden = true;
  refreshInputState();
  el.input.focus();
});

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

el.cleanToggle.addEventListener('click', () => {
  state.clean = !state.clean;
  el.cleanToggle.classList.toggle('is-on', state.clean);
  el.cleanToggle.setAttribute('aria-pressed', String(state.clean));
});

el.saveQr.addEventListener('click', async () => {
  const blob = await canvasBlob(qrCanvas(1024));
  downloadBlob(blob, 'qr-code.png');
  toast('Saved');
});

el.shareQr.addEventListener('click', async () => {
  const blob = await canvasBlob(qrCanvas(1024));
  await shareOrSave(blob, 'qr-code.png', 'QR code');
});

el.story.addEventListener('click', async () => {
  el.story.disabled = true;
  try {
    const blob = await makeStoryImage();
    await shareOrSave(blob, 'scan-me.png', 'Scan me');
  } finally {
    el.story.disabled = false;
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
buildSwatches();
refreshInputState();
