const DEFAULT_DIM = 1024;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "with",
  "we",
  "our",
  "you",
  "your",
  "they",
  "them",
  "these",
  "those",
  "not",
  "no",
  "yes",
  "can",
  "could",
  "should",
  "would",
  "may",
  "might",
  "will",
  "shall",
  "do",
  "does",
  "did",
  "done",
  "than",
  "then",
  "there",
  "here",
  "which",
  "who",
  "whom",
  "what",
  "when",
  "where",
  "why",
  "how",
  "also",
  "such",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "any",
  "all",
  "many",
  "much",
  "very",
]);

const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function tokenizeForEmbedding(text: string): string[] {
  const src = String(text ?? "").toLowerCase();
  if (!src.trim()) return [];

  // Keep unicode letters/numbers, collapse everything else to spaces.
  const cleaned = src.replace(/[^\p{L}\p{N}]+/gu, " ");
  const rawTokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  // For CJK text (often no whitespace), use overlapping bigrams to improve recall.
  const tokens: string[] = [];
  for (const tok of rawTokens) {
    if (!CJK_REGEX.test(tok) || tok.length <= 2) {
      tokens.push(tok);
      continue;
    }
    for (let i = 0; i < tok.length - 1; i++) {
      const bi = tok.slice(i, i + 2);
      if (bi.length === 2) tokens.push(bi);
    }
  }

  // De-dup consecutive duplicates to reduce PDF cache repetition artifacts.
  const out: string[] = [];
  let prev = "";
  for (const t of tokens) {
    if (t === prev) continue;
    out.push(t);
    prev = t;
  }
  return out;
}

export function buildHashingEmbedding(text: string, dim = DEFAULT_DIM): Float32Array {
  const size = Number.isFinite(dim) && dim > 0 ? Math.floor(dim) : DEFAULT_DIM;
  const vec = new Float32Array(size);
  const tokens = tokenizeForEmbedding(text);

  for (const tok of tokens) {
    const idx = fnv1a32(tok) % size;
    vec[idx] += 1;
  }

  // log normalization
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (v > 0) vec[i] = Math.log1p(v);
  }

  // L2 normalize
  let norm2 = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    norm2 += v * v;
  }
  const norm = Math.sqrt(norm2);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }

  return vec;
}

export function dotProduct(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // buildHashingEmbedding already normalizes, but keep this safe for future vectors.
  if (a.length !== b.length) return 0;
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    a2 += av * av;
    b2 += bv * bv;
  }
  const denom = Math.sqrt(a2) * Math.sqrt(b2);
  return denom > 0 ? dot / denom : 0;
}
