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
      results[cabin] = parseIcal(text);
      results[`${cabin}_debug`] = text.substring(0, 500); // first 500 chars for debugging
    } catch (err) {
      results[cabin] = [];
      results[`${cabin}_error`] = err.message;
    }
  }

  res.setHeader('Cache-Control', 's-maxage=1800');
  res.status(200).json(results);
}

function parseIcal(text) {
  const blocked = [];

  // Unfold lines (iCal wraps long lines with CRLF + space/tab)
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n|\r/);

  let inEvent = false;
  let dtstart = null;
  let dtend = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      dtstart = null;
      dtend = null;
      continue;
    }

    if (line === 'END:VEVENT') {
      inEvent = false;
      if (dtstart && dtend) {
        // Add every date from start up to (not including) end
        const cur = new Date(dtstart);
        const end = new Date(dtend);
        while (cur < end) {
          blocked.push(
            cur.getFullYear() + '-' + cur.getMonth() + '-' + cur.getDate()
          );
          cur.setDate(cur.getDate() + 1);
        }
      }
      continue;
    }

    if (!inEvent) continue;

    // Match DTSTART in any of its forms:
    // DTSTART;VALUE=DATE:20261015
    // DTSTART:20261015
    // DTSTART;TZID=Pacific/Auckland:20261015T000000
    if (line.startsWith('DTSTART')) {
      dtstart = extractDate(line);
    }

    if (line.startsWith('DTEND')) {
      dtend = extractDate(line);
    }
  }

  return blocked;
}

function extractDate(line) {
  // Get the value after the colon
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const val = line.substring(colonIdx + 1).trim();

  // Extract first 8 digits (YYYYMMDD)
  const match = val.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;

  const year  = parseInt(match[1]);
  const month = parseInt(match[2]) - 1; // 0-indexed
  const day   = parseInt(match[3]);

  return new Date(year, month, day);
}
