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
        headers: { 'User-Agent': 'HiddenBayAdventures/1.0' }
      });
      const text = await response.text();
      results[cabin] = parseIcal(text);
    } catch (err) {
      console.error(`Failed to fetch iCal for ${cabin}:`, err);
      results[cabin] = [];
    }
  }

  res.setHeader('Cache-Control', 's-maxage=3600'); // cache 1hr on Vercel edge
  res.status(200).json(results);
}

function parseIcal(text) {
  const blocked = [];
  const events = text.split('BEGIN:VEVENT');

  for (let i = 1; i < events.length; i++) {
    const event = events[i];

    // Get DTSTART and DTEND — handle both date-only and datetime formats
    const startMatch = event.match(/DTSTART(?:;VALUE=DATE)?(?:;TZID=[^:]+)?:(\d{8})/);
    const endMatch   = event.match(/DTEND(?:;VALUE=DATE)?(?:;TZID=[^:]+)?:(\d{8})/);

    if (!startMatch || !endMatch) continue;

    const start = parseIcalDate(startMatch[1]);
    const end   = parseIcalDate(endMatch[1]);

    // Add every date in the range (end date is exclusive in iCal)
    const cur = new Date(start);
    while (cur < end) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const d = cur.getDate();
      blocked.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
  }

  return blocked;
}

function parseIcalDate(str) {
  // str format: YYYYMMDD
  const y = parseInt(str.substring(0, 4));
  const m = parseInt(str.substring(4, 6)) - 1; // 0-indexed
  const d = parseInt(str.substring(6, 8));
  return new Date(y, m, d);
}
