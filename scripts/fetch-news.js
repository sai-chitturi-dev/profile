// Fetches the latest Salesforce, Retool and Go news and writes news.json.
// Runs every morning in GitHub Actions. No packages to install (uses Node's built-in fetch).
const fs = require('fs');

const gnews = q =>
  'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-GB&gl=GB&ceid=GB:en';

// Sources per topic. A feed that fails is skipped, so it's safe to add or remove lines.
const TOPICS = {
  salesforce: [
    { name: 'Apex Hours', url: 'https://www.apexhours.com/feed/' },
    { name: 'Salesforce Developers Blog', url: 'https://developer.salesforce.com/blogs/feed' },
    { name: 'Google News', url: gnews('Salesforce Agentforce when:7d') }
  ],
  retool: [
    { name: 'Retool Blog', url: 'https://retool.com/blog/rss.xml' },
    { name: 'Google News', url: gnews('"Retool" when:14d') }
  ],
  go: [
    { name: 'The Go Blog', url: 'https://go.dev/blog/feed.atom' },
    { name: 'Golang Weekly', url: 'https://golangweekly.com/rss' },
    { name: 'Google News', url: gnews('golang OR "Go programming language" when:14d') }
  ]
};
const PER_TOPIC = 5;

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}
function clip(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }

function parse(xml, sourceName) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let title = decode(tag(b, 'title'));
    let link = decode(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); if (m) link = m[1]; }
    const when = decode(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    let source = sourceName;
    if (sourceName === 'Google News') {
      const src = decode(tag(b, 'source'));
      if (src) { source = src; title = title.replace(new RegExp('\\s+-\\s+' + src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), ''); }
    }
    const summary = sourceName === 'Google News' ? '' : clip(decode(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')), 180);
    const date = when ? new Date(when) : null;
    if (title && link) items.push({ title, url: link, source, summary, date: date && !isNaN(date) ? date.toISOString() : '' });
  }
  return items;
}

async function getFeed(src) {
  try {
    const res = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0 (morning-brief news bot)' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = parse(await res.text(), src.name);
    console.log('OK  ', src.name.padEnd(28), items.length, 'items');
    return items;
  } catch (e) {
    console.log('SKIP', src.name.padEnd(28), e.message);
    return [];
  }
}

async function main() {
  const out = {};
  for (const [topic, sources] of Object.entries(TOPICS)) {
    const all = (await Promise.all(sources.map(getFeed))).flat();
    const seen = new Set();
    out[topic] = all
      .filter(n => { const k = n.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, PER_TOPIC)
      .map(n => ({ ...n, source: n.date ? n.source + ' · ' + new Date(n.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : n.source }));
  }
  out.updated = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  fs.writeFileSync('news.json', JSON.stringify(out, null, 2) + '\n');
  console.log('Wrote news.json:', Object.entries(out).filter(([k]) => k !== 'updated').map(([k, v]) => k + '=' + v.length).join(', '));
}

main();