export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const urls = {
    tui: process.env.TUI_ICAL_URL,
    kah: process.env.KAH_ICAL_URL,
  };

  const results = {};

  for (const [cabin, url] of Object.entries(urls)) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const text = await response.text();
      const events = parseIcalEvents(text);
      const blocked = [];

      for (const { start, end } of events) {
        // Iterate using LOCAL date math to avoid timezone rollover
        // start/end are already plain YYYY-MM-DD strings
        const [sy, sm, sd] = start.split('-').map(Number);
        const [ey, em, ed] = end.split('-').map(Number);
        const cur  = new Date(sy, sm - 1, sd);  // local, month 1-indexed
        const endD = new Date(ey, em - 1, ed);

        while (cur < endD) {
          // Key format: "YYYY-M-D" with 0-indexed month — matches calendar
          blocked.push(
            cur.getFullYear() + '-' + cur.getMonth() + '-' + cur.getDate()
          );
          cur.setDate(cur.getDate() + 1);
        }
      }

      results[cabin] = blocked;

    } catch (err) {
      results[cabin] = [];
      results[`${cabin}_error`] = err.message;
    }
  }

  res.setHeader('Cache-Control', 's-maxage=1800');
  res.status(200).json(results);
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
    else if (trimmed.startsWith('DTEND'))   dtend   = extractDateStr(trimmed);
  }

  return events;
}

function extractDateStr(line) {
  // Returns "YYYY-MM-DD" string — no Date object, no timezone issues
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const val = line.substring(colonIdx + 1).trim();
  const match = val.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}
