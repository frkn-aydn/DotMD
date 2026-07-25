const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let getUserDataPath = null;
let cachedSystemFonts = null;
let fontScanPromise = null;
let fontsBroadcast = null;

function initFonts(appOrGetUserDataPath) {
  if (typeof appOrGetUserDataPath === 'function') {
    getUserDataPath = appOrGetUserDataPath;
  } else {
    getUserDataPath = () => appOrGetUserDataPath.getPath('userData');
  }
}

function getFontCachePath() {
  return path.join(getUserDataPath(), 'system-fonts-cache.json');
}

function setFontsBroadcast(cb) {
  fontsBroadcast = cb;
}

function notifyFontsUpdated(fonts) {
  if (fontsBroadcast) fontsBroadcast(fonts);
}

function sortFontFamilies(families) {
  return [...new Set(families.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

function mergeFontLists(existing, scanned) {
  return sortFontFamilies([...(existing || []), ...(scanned || [])]);
}

function fontsListChanged(before, after) {
  if (!before || before.length !== after.length) return true;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) return true;
  }
  return false;
}

function loadFontCacheSync() {
  try {
    const raw = fs.readFileSync(getFontCachePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.platform && parsed.platform !== process.platform) return false;
    if (Array.isArray(parsed.fonts) && parsed.fonts.length) {
      cachedSystemFonts = parsed.fonts;
      return true;
    }
  } catch {
    /* no cache yet */
  }
  return false;
}

async function getMacOSFonts() {
  const profiler = fs.existsSync('/usr/sbin/system_profiler')
    ? '/usr/sbin/system_profiler'
    : 'system_profiler';
  const { stdout } = await execFileAsync(profiler, ['-json', 'SPFontsDataType'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const data = JSON.parse(stdout);
  const families = [];

  for (const font of data.SPFontsDataType || []) {
    if (typeof font.family === 'string' && font.family.trim()) {
      families.push(font.family.trim());
    }

    for (const typeface of font.typefaces || []) {
      if (typeof typeface.family === 'string' && typeface.family.trim()) {
        families.push(typeface.family.trim());
      }
    }
  }

  return sortFontFamilies(families);
}

async function getWindowsFonts() {
  const script =
    'Add-Type -AssemblyName System.Drawing; ' +
    '[System.Drawing.Text.InstalledFontCollection]::new().Families | ' +
    'ForEach-Object { $_.Name }';
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return sortFontFamilies(stdout.split(/\r?\n/));
}

async function getLinuxFonts() {
  const { stdout } = await execFileAsync('fc-list', [':family', '--format=%{family}\n'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const families = [];

  for (const line of stdout.split('\n')) {
    for (const part of line.split(',')) {
      const name = part.trim();
      if (name) families.push(name);
    }
  }

  return sortFontFamilies(families);
}

async function readFontCache() {
  try {
    const raw = await fsp.readFile(getFontCachePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.platform && parsed.platform !== process.platform) return null;
    if (Array.isArray(parsed.fonts) && parsed.fonts.length) {
      return parsed.fonts;
    }
  } catch {
    /* no cache yet */
  }
  return null;
}

async function writeFontCache(fonts) {
  await fsp.writeFile(
    getFontCachePath(),
    JSON.stringify({ fonts, updatedAt: Date.now(), platform: process.platform }),
    'utf-8',
  );
}

async function enumerateSystemFonts() {
  if (process.platform === 'darwin') return getMacOSFonts();
  if (process.platform === 'win32') return getWindowsFonts();
  return getLinuxFonts();
}

async function refreshSystemFonts({ broadcast = false } = {}) {
  const previous = cachedSystemFonts ? [...cachedSystemFonts] : [];
  const scanned = await enumerateSystemFonts();
  const merged = mergeFontLists(previous, scanned);
  cachedSystemFonts = merged;
  await writeFontCache(merged).catch(() => {});
  if (broadcast && fontsListChanged(previous, merged)) {
    notifyFontsUpdated(merged);
  }
  return merged;
}

function startFontScan({ broadcastOnComplete = false } = {}) {
  if (fontScanPromise) return fontScanPromise;

  fontScanPromise = refreshSystemFonts({ broadcast: broadcastOnComplete })
    .catch((err) => {
      console.error('Failed to enumerate system fonts:', err);
      if (!cachedSystemFonts) cachedSystemFonts = [];
      return cachedSystemFonts;
    })
    .finally(() => {
      fontScanPromise = null;
    });

  return fontScanPromise;
}

async function getSystemFonts() {
  if (cachedSystemFonts) return cachedSystemFonts;

  const cached = await readFontCache();
  if (cached) {
    cachedSystemFonts = cached;
    startFontScan({ broadcastOnComplete: true });
    return cachedSystemFonts;
  }

  if (fontScanPromise) return fontScanPromise;
  return startFontScan({ broadcastOnComplete: true });
}

function getCachedSystemFonts() {
  return cachedSystemFonts;
}

module.exports = {
  initFonts,
  getSystemFonts,
  loadFontCacheSync,
  startFontScan,
  setFontsBroadcast,
  getCachedSystemFonts,
};
