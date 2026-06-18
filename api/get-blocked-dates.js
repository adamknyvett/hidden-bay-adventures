// ═══════════════════════════════════════════════════════════════════
// MANUAL OVERRIDE — edit this list any time to manually block dates
// Format: { cabin: 'tui' or 'kah', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
// 'end' is the checkout date (exclusive) — e.g. a 3-night stay 10th-13th
// would be start: '2026-06-10', end: '2026-06-13'
// These ALWAYS apply, regardless of what Airbnb's feed says.
// ═══════════════════════════════════════════════════════════════════
const MANUAL_BLOCKS = [
  // Example — remove the leading // to activate:
  // { cabin: 'kah', start: '2026-06-19', end: '2026-06-20' },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const urls = {
    tui: process.env.TUI_ICAL_URL,
    kah: process.env.KAH_ICAL_URL,
    duo: process.env.DUO_ICAL_URL,
  };

  const rawBlocked = {};
  const debug = {};

  for (const [key, url] of Object.entries(urls)) {
    debug[`${key}_url_present`] = !!url;

    if (!url) { rawBlocked[key] = []; continue; }
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      debug[`${key}_status`] = response.status;
      const text = await response.text();
      debug[`${key}_event_count`] = (text.match(/BEGIN:VEVENT/g) || []).length;

      const events = parseIcalEvents(text);
      const blocked = [];
      for (const { start, end } of events) {
        const [sy, sm, sd] = start.split('-').map(Number);
        const [ey, em, ed] = end.split('-').map(Number);
        const cur  = new Date(sy, sm - 1, sd);
        const endD = new Date(ey, em - 1, ed);
        while (cur < endD) {
          blocked.push(cur.getFullYear() + '-' + cur.getMonth() + '-' + cur.getDate());
          cur.setDate(cur.getDate() + 1);
        }
      }
      rawBlocked[key] = blocked;
      debug[`${key}_blocked_count`] = blocked.length;
    } catch (err) {
      rawBlocked[key] = [];
      debug[`${key}_fetch_error`] = err.message;
    }
  }

  // Apply manual overrides — convert YYYY-MM-DD strings to the same
  // "Y-M-D" (0-indexed month) key format used everywhere else
  const manualByCabin = { tui: [], kah: [] };
  for (const block of MANUAL_BLOCKS) {
    const [sy, sm, sd] = block.start.split('-').map(Number);
    const [ey, em, ed] = block.end.split('-').map(Number);
    const cur  = new Date(sy, sm - 1, sd);
    const endD = new Date(ey, em - 1, ed);
    while (cur < endD) {
      const key = cur.getFullYear() + '-' + cur.getMonth() + '-' + cur.getDate();
      if (manualByCabin[block.cabin]) manualByCabin[block.cabin].push(key);
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Merge: Tui = own feed + Duo feed + manual overrides for tui
  // Kah  = own feed + Duo feed + manual overrides for kah
  const tuiBlocked = mergeUnique(rawBlocked.tui, rawBlocked.duo, manualByCabin.tui);
  const kahBlocked = mergeUnique(rawBlocked.kah, rawBlocked.duo, manualByCabin.kah);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    tui: tuiBlocked,
    kah: kahBlocked,
    _debug: debug,
    _manualBlocksActive: MANUAL_BLOCKS.length,
  });
}

function mergeUnique(...arrays) {
  const set = new Set();
  for (const arr of arrays) for (const item of (arr || [])) set.add(item);
  return Array.from(set);
}

function parseIcalEvents(text) {
  const events = [];
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\r|\n/);

  let inEvent = false, dtstart = null, dtend = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') { inEvent = true; dtstart = null; dtend = null; continue; }
    if (trimmed === 'END:VEVENT') {
      inEvent = false;
      if (dtstart && dtend) events.push({ start: dtstart, end: dtend });
      continue;
    }
    if (!inEvent) continue;
    if (trimmed.startsWith('DTSTART')) dtstart = extractDateStr(trimmed);
    else if (trimmed.startsWith('DTEND')) dtend = extractDateStr(trimmed);
  }
  return events;
}

function extractDateStr(line) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const val = line.substring(colonIdx + 1).trim();
  const match = val.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}