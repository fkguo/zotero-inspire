/**
 * Journal abbreviation utilities to help filter by short forms such as
 * "PRL", "PRD", "JHEP", etc.
 */

const JOURNAL_PUNCT_REGEX = /[.,;:!?'"()[\]{}]/g;
const JOURNAL_SPACE_REGEX = /\s+/g;
const ABBREVIATION_NORMALIZE_REGEX = /[.\s\-_/]+/g;

export interface JournalAbbreviationMap {
  [normalizedFullName: string]: string[];
}

type JournalEntry = {
  names: string[];
  abbreviations: string[];
};

const JOURNAL_ENTRIES: JournalEntry[] = [
  {
    names: ["Physical Review Letters", "Phys. Rev. Lett.", "Phys Rev Lett"],
    abbreviations: ["PRL"],
  },
  {
    names: ["Physical Review D", "Phys. Rev. D", "Phys Rev D", "Physical Review D Particles Fields"],
    abbreviations: ["PRD"],
  },
  {
    names: ["Physical Review A", "Phys. Rev. A", "Phys Rev A"],
    abbreviations: ["PRA"],
  },
  {
    names: ["Physical Review B", "Phys. Rev. B", "Phys Rev B"],
    abbreviations: ["PRB"],
  },
  {
    names: ["Physical Review C", "Phys. Rev. C", "Phys Rev C"],
    abbreviations: ["PRC"],
  },
  {
    names: ["Physical Review E", "Phys. Rev. E", "Phys Rev E"],
    abbreviations: ["PRE"],
  },
  {
    names: ["Physical Review X", "Phys. Rev. X", "Phys Rev X"],
    abbreviations: ["PRX"],
  },
  {
    names: ["Physical Review Applied", "Phys. Rev. Applied"],
    abbreviations: ["PRApplied"],
  },
  {
    names: ["Physical Review Accelerators and Beams", "Phys. Rev. Accel. Beams"],
    abbreviations: ["PRAB"],
  },
  {
    names: ["Physical Review Physics Education Research", "Phys. Rev. Phys. Educ. Res."],
    abbreviations: ["PRPER"],
  },
  {
    names: ["Physical Review Research", "Phys. Rev. Res."],
    abbreviations: ["PRResearch", "PRR"],
  },
  {
    names: ["Physical Review Materials", "Phys. Rev. Mater."],
    abbreviations: ["PRMaterials", "PRM"],
  },
  {
    names: ["Physical Review Fluids", "Phys. Rev. Fluids"],
    abbreviations: ["PRFluids", "PRF"],
  },
  {
    names: ["Nature"],
    abbreviations: ["Nature"],
  },
  {
    names: ["Nature Physics", "Nat. Phys.", "Nat Phys"],
    abbreviations: ["NP", "NatPhys"],
  },
  {
    names: ["Nature Communications", "Nat. Commun.", "Nat Commun."],
    abbreviations: ["NC", "NatComm"],
  },
  {
    names: ["Nature Materials", "Nat. Mater.", "Nat Mater"],
    abbreviations: ["NatMat"],
  },
  {
    names: ["Nature Nanotechnology", "Nat. Nanotechnol.", "Nat Nanotechnol."],
    abbreviations: ["NatNano"],
  },
  {
    names: ["Nature Photonics", "Nat. Photon.", "Nat Photon"],
    abbreviations: ["NatPhoton"],
  },
  {
    names: ["Nature Chemistry", "Nat. Chem.", "Nat Chem"],
    abbreviations: ["NatChem"],
  },
  {
    names: ["Science"],
    abbreviations: ["Science"],
  },
  {
    names: ["Science Advances", "Sci. Adv.", "Sci Adv"],
    abbreviations: ["SciAdv"],
  },
  {
    names: ["Science Bulletin", "Sci. Bull.", "Sci Bull", "科学通报"],
    abbreviations: ["SciBull", "SB"],
  },
  {
    names: ["Journal of High Energy Physics", "J. High Energy Phys.", "JHEP"],
    abbreviations: ["JHEP"],
  },
  {
    names: ["Nuclear Physics B", "Nucl. Phys. B"],
    abbreviations: ["NPB"],
  },
  {
    names: ["Nuclear Physics A", "Nucl. Phys. A"],
    abbreviations: ["NPA"],
  },
  {
    names: ["Physics Letters B", "Phys. Lett. B"],
    abbreviations: ["PLB"],
  },
  {
    names: ["Physics Letters A", "Phys. Lett. A"],
    abbreviations: ["PLA"],
  },
  {
    names: ["European Physical Journal C", "Eur. Phys. J. C"],
    abbreviations: ["EPJC"],
  },
  {
    names: ["European Physical Journal A", "Eur. Phys. J. A"],
    abbreviations: ["EPJA"],
  },
  {
    names: ["European Physical Journal B", "Eur. Phys. J. B"],
    abbreviations: ["EPJB"],
  },
  {
    names: ["Classical and Quantum Gravity", "Class. Quantum Grav."],
    abbreviations: ["CQG"],
  },
  {
    names: ["Reviews of Modern Physics", "Rev. Mod. Phys."],
    abbreviations: ["RMP"],
  },
  {
    names: ["Progress of Theoretical Physics", "Prog. Theor. Phys."],
    abbreviations: ["PTP"],
  },
  {
    names: ["Physics Reports", "Phys. Rep."],
    abbreviations: ["PhysRep"],
  },
  {
    names: ["International Journal of Modern Physics A", "Int. J. Mod. Phys. A"],
    abbreviations: ["IJMPA"],
  },
  {
    names: ["International Journal of Modern Physics D", "Int. J. Mod. Phys. D"],
    abbreviations: ["IJMPD"],
  },
  {
    names: ["International Journal of Modern Physics E", "Int. J. Mod. Phys. E"],
    abbreviations: ["IJMPE"],
  },
  {
    names: ["Modern Physics Letters A", "Mod. Phys. Lett. A"],
    abbreviations: ["MPLA"],
  },
  {
    names: ["Chinese Physics C", "Chin. Phys. C"],
    abbreviations: ["CPC"],
  },
  {
    names: ["Chinese Physics Letters", "Chin. Phys. Lett."],
    abbreviations: ["CPL"],
  },
  {
    names: ["Chinese Physics B", "Chin. Phys. B"],
    abbreviations: ["CPB"],
  },
  {
    names: ["Chinese Physics A", "Chin. Phys. A"],
    abbreviations: ["CPA"],
  },
  {
    names: ["Chinese Journal of Physics", "Chin. J. Phys."],
    abbreviations: ["CJP"],
  },
  {
    names: ["Communications in Theoretical Physics", "Commun. Theor. Phys."],
    abbreviations: ["CTP"],
  },
  {
    names: ["Acta Physica Sinica", "Acta Phys. Sin.", "物理学报"],
    abbreviations: ["APS"],
  },
  {
    names: ["Chinese Journal of Chemical Physics", "Chin. J. Chem. Phys.", "化学物理学报"],
    abbreviations: ["CJCP"],
  },
  {
    names: ["High Energy Physics and Nuclear Physics", "High Energy Phys. Nucl. Phys.", "高能物理与核物理"],
    abbreviations: ["HEPNP"],
  },
  {
    names: ["Nuclear Science and Techniques", "Nucl. Sci. Tech.", "核技术"],
    abbreviations: ["NST"],
  },
  {
    names: [
      "Science China Physics Mechanics and Astronomy",
      "Sci. China Phys. Mech. Astron.",
      "中国科学物理学力学天文学",
      "中国科学 物理学 力学 天文学",
    ],
    abbreviations: ["SCPMA"],
  },
  {
    names: ["Journal of Physics G", "J. Phys. G"],
    abbreviations: ["JPhysG", "JPG"],
  },
  {
    names: ["New Journal of Physics", "New J. Phys."],
    abbreviations: ["NJP"],
  },
  {
    names: ["Journal of Cosmology and Astroparticle Physics", "J. Cosmol. Astropart. Phys."],
    abbreviations: ["JCAP"],
  },
  // Additional HEP journals
  {
    names: ["Annual Review of Nuclear and Particle Science", "Annu. Rev. Nucl. Part. Sci.", "Ann. Rev. Nucl. Part. Sci."],
    abbreviations: ["ARNPS"],
  },
  {
    names: ["Annals of Physics", "Ann. Phys.", "Ann Phys"],
    abbreviations: ["AnnPhys"],
  },
  {
    names: ["Reports on Progress in Physics", "Rep. Prog. Phys.", "Rept. Prog. Phys."],
    abbreviations: ["RPP"],
  },
  {
    names: ["Fortschritte der Physik", "Fortsch. Phys.", "Fortschr. Phys."],
    abbreviations: ["FortschPhys"],
  },
  {
    names: [
      "Nuclear Instruments and Methods in Physics Research Section A",
      "Nucl. Instrum. Methods Phys. Res. A",
      "Nucl. Instrum. Meth. A",
      "NIM A",
    ],
    abbreviations: ["NIMA"],
  },
  {
    names: [
      "Nuclear Instruments and Methods in Physics Research Section B",
      "Nucl. Instrum. Methods Phys. Res. B",
      "Nucl. Instrum. Meth. B",
      "NIM B",
    ],
    abbreviations: ["NIMB"],
  },
  {
    names: ["Physical Review", "Phys. Rev."],
    abbreviations: ["PR"],
  },
  {
    names: ["Progress of Theoretical and Experimental Physics", "Prog. Theor. Exp. Phys.", "PTEP"],
    abbreviations: ["PTEP"],
  },
  {
    names: ["Zeitschrift für Physik C", "Z. Phys. C", "Zeit. Phys. C"],
    abbreviations: ["ZPC"],
  },
  {
    names: ["Zeitschrift für Physik A", "Z. Phys. A", "Zeit. Phys. A"],
    abbreviations: ["ZPA"],
  },
  {
    names: ["Il Nuovo Cimento A", "Nuovo Cimento A", "Nuovo Cim. A"],
    abbreviations: ["NCA"],
  },
  {
    names: ["Il Nuovo Cimento B", "Nuovo Cimento B", "Nuovo Cim. B"],
    abbreviations: ["NCB"],
  },
  {
    names: ["Communications in Mathematical Physics", "Commun. Math. Phys."],
    abbreviations: ["CMP"],
  },
  {
    names: ["Living Reviews in Relativity", "Living Rev. Relativ.", "Living Rev. Rel."],
    abbreviations: ["LRR"],
  },
  {
    names: ["Astrophysical Journal", "Astrophys. J."],
    abbreviations: ["ApJ"],
  },
  {
    names: ["Astrophysical Journal Letters", "Astrophys. J. Lett."],
    abbreviations: ["ApJL"],
  },
  {
    names: ["Monthly Notices of the Royal Astronomical Society", "Mon. Not. Roy. Astron. Soc."],
    abbreviations: ["MNRAS"],
  },
  {
    names: ["Astronomy and Astrophysics", "Astron. Astrophys."],
    abbreviations: ["AA"],
  },
  {
    names: ["Computer Physics Communications", "Comput. Phys. Commun."],
    abbreviations: ["CPC_Comp"],
  },
  {
    names: ["Few-Body Systems", "Few Body Syst."],
    abbreviations: ["FBS"],
  },
  {
    names: ["Physics of the Dark Universe", "Phys. Dark Univ."],
    abbreviations: ["PDU"],
  },
];

export function normalizeJournalName(name: string): string {
  if (!name) {
    return "";
  }
  return name
    .toLowerCase()
    .replace(JOURNAL_PUNCT_REGEX, "")
    .replace(JOURNAL_SPACE_REGEX, " ")
    .trim();
}

const normalizeAbbreviation = (value: string): string =>
  value ? value.toLowerCase().replace(ABBREVIATION_NORMALIZE_REGEX, "") : "";

export const JOURNAL_ABBREVIATION_MAP: JournalAbbreviationMap = {};
export const JOURNAL_FULLNAME_MAP: Record<string, string[]> = {};

for (const entry of JOURNAL_ENTRIES) {
  const uniqueAbbreviations = Array.from(new Set(entry.abbreviations.filter(Boolean)));
  for (const name of entry.names) {
    const normalizedName = normalizeJournalName(name);
    if (!normalizedName || !uniqueAbbreviations.length) {
      continue;
    }
    JOURNAL_ABBREVIATION_MAP[normalizedName] = uniqueAbbreviations;
    for (const abbr of uniqueAbbreviations) {
      const normalizedAbbr = normalizeAbbreviation(abbr);
      if (!normalizedAbbr) {
        continue;
      }
      if (!JOURNAL_FULLNAME_MAP[normalizedAbbr]) {
        JOURNAL_FULLNAME_MAP[normalizedAbbr] = [];
      }
      if (!JOURNAL_FULLNAME_MAP[normalizedAbbr].includes(name)) {
        JOURNAL_FULLNAME_MAP[normalizedAbbr].push(name);
      }
    }
  }
}

export function getJournalAbbreviations(journalName: string): string[] {
  const normalized = normalizeJournalName(journalName);
  return normalized ? JOURNAL_ABBREVIATION_MAP[normalized] ?? [] : [];
}

export function getJournalFullNames(abbreviation: string): string[] {
  const normalized = normalizeAbbreviation(abbreviation);
  return normalized ? JOURNAL_FULLNAME_MAP[normalized] ?? [] : [];
}

