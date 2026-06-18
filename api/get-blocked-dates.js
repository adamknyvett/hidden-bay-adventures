export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const urls = {
    tui: process.env.TUI_ICAL_URL,
    kah: process.env.KAH_ICAL_URL,
    duo: process.env.DUO_ICAL_URL, // Harbour View Duo — blocks BOTH cabins
  };

  const rawBlocked = {};

  for (const [key, url] of Object.entries(urls)) {
    if (!url) { rawBlocked[key] = []; continue; }
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const text = await response.text();
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
    } catch (err) {
      rawBlocked[key] = [];
    }
  }

  // Merge: Duo bookings block BOTH Tui Ridge and Kahawai Quarters
  const tuiBlocked = mergeUnique(rawBlocked.tui, rawBlocked.duo);
  const kahBlocked = mergeUnique(rawBlocked.kah, rawBlocked.duo);

  res.setHeader('Cache-Control', 's-maxage=1800');
  res.status(200).json({
    tui: tuiBlocked,
    kah: kahBlocked,
  });
}

function mergeUnique(arrA, arrB) {
  const set = new Set([...(arrA || []), ...(arrB || [])]);
  return Array.from(set);
}

function parseIcalEvents(text) {
  const events = [];
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\r|\n/);

  let inEvent = false;
  let dtstart = null;
  let dtend   = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true; dtstart = null; dtend = null;
      continue;
    }
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