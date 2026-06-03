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

      // Include raw snippet for debugging — remove once confirmed working
      results[`${cabin}_raw`] = text.substring(0, 800);

      const events = parseIcalEvents(text);
      results[`${cabin}_events`] = events; // show parsed events for debugging

      // Expand every event into individual blocked dates
      const blocked = [];
      for (const { start, end } of events) {
        const cur = new Date(start);
        const endDate = new Date(end);
        while (cur < endDate) {
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

  // Unfold wrapped lines
  const unfolded = text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\r|\n/);

  let inEvent = false;
  let dtstart = null;
  let dtend   = null;
  let summary = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      dtstart = null;
      dtend   = null;
      summary = '';
      continue;
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false;
      if (dtstart && dtend) {
        events.push({
          summary,
          start: dtstart,
          end:   dtend,
          startStr: dtstart.toISOString().split('T')[0],
          endStr:   dtend.toISOString().split('T')[0],
        });
      }
      continue;
    }

    if (!inEvent) continue;

    if (trimmed.startsWith('DTSTART')) {
      dtstart = extractDate(trimmed);
    } else if (trimmed.startsWith('DTEND')) {
      dtend = extractDate(trimmed);
    } else if (trimmed.startsWith('SUMMARY')) {
      summary = trimmed.split(':').slice(1).join(':');
    }
  }

  return events;
}

function extractDate(line) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const val = line.substring(colonIdx + 1).trim();
  const match = val.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  // Use UTC to avoid timezone shifting the date
  return new Date(Date.UTC(
    parseInt(match[1]),
    parseInt(match[2]) - 1,
    parseInt(match[3])
  ));
}
