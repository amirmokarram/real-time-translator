// Types shared across the Question Bank, plus a keyword matcher used ONLY as an
// offline fallback when the LLM router (router.ts) can't be reached. The primary,
// accuracy-first selection path is the LLM router — see router.ts.

export interface BankEntry {
  path: string; // absolute path to the .md file
  title: string; // first "# " heading, or the filename if none
  content: string; // full markdown body
}

export interface BankMatch {
  path: string;
  title: string;
  snippet: string; // short context line for the card
}

// English stopwords dropped from the query so common glue words don't dominate.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'you', 'your',
  'me', 'my', 'i', 'we', 'it', 'that', 'this', 'how', 'what', 'why', 'when',
  'can', 'could', 'would', 'should', 'about', 'at', 'as', 'so', 'if', 'have',
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Deterministic keyword/overlap scoring. Title hits weigh most, then filename,
// then body frequency. Only reached when the LLM router is unavailable.
export function keywordSearch(query: string, entries: BankEntry[], max: number): BankMatch[] {
  const qTerms = [...new Set(terms(query))];
  if (qTerms.length === 0) return [];

  return entries
    .map((entry) => {
      const titleTerms = new Set(terms(entry.title));
      const bodyLower = entry.content.toLowerCase();
      const fileName = entry.path.toLowerCase();
      let score = 0;
      for (const term of qTerms) {
        if (titleTerms.has(term)) score += 5;
        if (fileName.includes(term)) score += 3;
        score += Math.min(bodyLower.split(term).length - 1, 5);
      }
      return { entry, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ entry }) => ({
      path: entry.path,
      title: entry.title,
      snippet: snippetFor(entry, qTerms),
    }));
}

// First body line that mentions a query term (skipping the title heading), so the
// card shows why the file matched. Falls back to the first non-empty line.
function snippetFor(entry: BankEntry, qTerms: string[]): string {
  const lines = entry.content
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l.length > 0);
  const hit = lines.find((l) => qTerms.some((t) => l.toLowerCase().includes(t)));
  const chosen = hit ?? lines[0] ?? '';
  return chosen.length > 140 ? chosen.slice(0, 137) + '…' : chosen;
}
