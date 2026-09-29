// ─────────────────────────────────────────────────────────────────────────────
// A citation key for an arXiv paper that is neither in the library nor in
// INSPIRE, in the owner's Better BibTeX fallback form (auth + ':' + year +
// shorttitle(1).lower): the first author's family name (a collaboration's
// name, as INSPIRE uses it), the year of the identifier and the first
// significant word of the title, e.g. Finkelberg:2022kostka. As Better BibTeX
// does, letters are folded to plain ASCII, "/", ":" and apostrophes
// separate words (JPAC's → JPAC), punctuation inside a word is dropped
// (quarter-century → quartercentury),
// and one-letter words and Better BibTeX's default skip words are passed
// over. No random letters are added, as INSPIRE's keys have.
// ─────────────────────────────────────────────────────────────────────────────

import { arxivSortKey } from "./arxivId";
import type { ListingAuthor } from "./listingTypes";

/** Better BibTeX's default skipWords (its preferences, 2026-09-29) */
const SKIP_WORDS = new Set(
  (
    "a,ab,aboard,about,above,across,after,against,al,along,amid,among,an," +
    "and,anti,around,as,at,before,behind,below,beneath,beside,besides," +
    "between,beyond,but,by,d,da,das,de,del,dell,dello,dei,degli,della,dell," +
    "delle,dem,den,der,des,despite,die,do,down,du,during,ein,eine,einem," +
    "einen,einer,eines,el,en,et,except,for,from,gli,i,il,in,inside,into,is," +
    "l,la,las,le,les,like,lo,los,near,nor,of,off,on,onto,or,over,past,per," +
    "plus,round,save,since,so,some,sur,than,the,through,to,toward,towards," +
    "un,una,unas,under,underneath,une,unlike,uno,unos,until,up,upon,versus," +
    "via,von,while,with,within,without,yet,zu,zum"
  ).split(","),
);

/** Letters that do not decompose into a plain letter and a mark */
const LETTERS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "TH",
  ł: "l",
  Ł: "L",
  ı: "i",
};

/** Plain ASCII letters and digits of a text, in their case */
function asciiLetters(text: string): string {
  return text
    .replace(/[ßæÆœŒøØđĐðÐþÞłŁı]/g, (char) => LETTERS[char])
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "");
}

/** The name a key begins with: a collaboration's, else the family name */
function authorPart(author: ListingAuthor | undefined): string {
  if (!author) return "";
  // "ATLAS Collaboration", "The CMS Collaboration", "LIGO Scientific
  // Collaboration and Virgo Collaboration" (INSPIRE: LIGOScientific)
  const collaboration = author.display.match(
    /^(?:(?:for\s+)?the\s+)?(.+?)\s+collaborations?\b/i,
  );
  if (collaboration) return asciiLetters(collaboration[1]);
  return asciiLetters(author.family ?? author.display);
}

/** The first significant word of a title, in lower case */
function titleWord(title: string): string {
  for (const raw of title.replace(/[/:'’]/g, " ").split(/\s+/)) {
    const word = asciiLetters(raw).toLowerCase();
    if (word.length > 1 || /^\d$/.test(word)) {
      if (!SKIP_WORDS.has(word)) return word;
    }
  }
  return "";
}

/** The citation key of an arXiv paper, e.g. Finkelberg:2022kostka */
export function arxivCitationKey(paper: {
  id: string;
  title: string;
  authors: readonly ListingAuthor[];
}): string {
  const name = authorPart(paper.authors[0]) || "preprint";
  const year = arxivSortKey(paper.id).slice(0, 4);
  return `${name}:${year}${titleWord(paper.title)}`;
}
