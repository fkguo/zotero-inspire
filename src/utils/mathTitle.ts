function trimInternal(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Convert MathML to readable Unicode text
 * Handles common MathML elements like <mi>, <mo>, <msup>, <msub>, <mover>, etc.
 */
function convertMathML(html: string): string {
  // Quick check if there's any MathML content
  if (!/<math[\s>]/i.test(html)) {
    return html;
  }

  const superscriptMap: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "+": "⁺",
    "-": "⁻",
    "−": "⁻",
    "=": "⁼",
    "(": "⁽",
    ")": "⁾",
    "*": "*",
    a: "ᵃ",
    b: "ᵇ",
    c: "ᶜ",
    d: "ᵈ",
    e: "ᵉ",
    f: "ᶠ",
    g: "ᵍ",
    h: "ʰ",
    i: "ⁱ",
    j: "ʲ",
    k: "ᵏ",
    l: "ˡ",
    m: "ᵐ",
    n: "ⁿ",
    o: "ᵒ",
    p: "ᵖ",
    r: "ʳ",
    s: "ˢ",
    t: "ᵗ",
    u: "ᵘ",
    v: "ᵛ",
    w: "ʷ",
    x: "ˣ",
    y: "ʸ",
    z: "ᶻ",
  };

  const subscriptMap: Record<string, string> = {
    "0": "₀",
    "1": "₁",
    "2": "₂",
    "3": "₃",
    "4": "₄",
    "5": "₅",
    "6": "₆",
    "7": "₇",
    "8": "₈",
    "9": "₉",
    "+": "₊",
    "-": "₋",
    "−": "₋",
    "=": "₌",
    "(": "₍",
    ")": "₎",
    a: "ₐ",
    e: "ₑ",
    h: "ₕ",
    i: "ᵢ",
    j: "ⱼ",
    k: "ₖ",
    l: "ₗ",
    m: "ₘ",
    n: "ₙ",
    o: "ₒ",
    p: "ₚ",
    r: "ᵣ",
    s: "ₛ",
    t: "ₜ",
    u: "ᵤ",
    v: "ᵥ",
    x: "ₓ",
  };

  // Convert a string to superscript
  const toSuperscript = (s: string): string => {
    return s
      .split("")
      .map((c) => superscriptMap[c] || c)
      .join("");
  };

  // Convert a string to subscript
  const toSubscript = (s: string): string => {
    return s
      .split("")
      .map((c) => subscriptMap[c] || c)
      .join("");
  };

  // Recursive function to extract text content from MathML
  const extractMathContent = (mathStr: string): string => {
    let result = mathStr;

    // Handle <msup> (superscript): <msup><mi>e</mi><mo>+</mo></msup> → e⁺
    result = result.replace(
      /<msup[^>]*>([\s\S]*?)<\/msup>/gi,
      (_match, content) => {
        // Find the base and exponent parts
        const parts: string[] = [];
        const remaining = content;
        // Extract each element (roughly)
        const tagRegex = /<(mi|mo|mn|mrow|mtext)[^>]*>([\s\S]*?)<\/\1>/gi;
        let m;
        while ((m = tagRegex.exec(remaining)) !== null) {
          parts.push(extractMathContent(m[0]));
        }
        if (parts.length >= 2) {
          const base = parts[0];
          const exp = parts.slice(1).join("");
          return base + toSuperscript(exp);
        }
        // Fallback: just strip tags
        return extractMathContent(content);
      },
    );

    // Handle <msub> (subscript): <msub><mi>x</mi><mn>2</mn></msub> → x₂
    result = result.replace(
      /<msub[^>]*>([\s\S]*?)<\/msub>/gi,
      (_match, content) => {
        const parts: string[] = [];
        const tagRegex = /<(mi|mo|mn|mrow|mtext)[^>]*>([\s\S]*?)<\/\1>/gi;
        let m;
        while ((m = tagRegex.exec(content)) !== null) {
          parts.push(extractMathContent(m[0]));
        }
        if (parts.length >= 2) {
          const base = parts[0];
          const sub = parts.slice(1).join("");
          return base + toSubscript(sub);
        }
        return extractMathContent(content);
      },
    );

    // Handle <mover> with accent (e.g., bar over letter): <mover accent="true"><mi>Λ</mi><mo>¯</mo></mover> → Λ̄
    result = result.replace(
      /<mover[^>]*>([\s\S]*?)<\/mover>/gi,
      (_match, content) => {
        const parts: string[] = [];
        const tagRegex = /<(mi|mo|mn|mrow|mtext)[^>]*>([\s\S]*?)<\/\1>/gi;
        let m;
        while ((m = tagRegex.exec(content)) !== null) {
          parts.push(extractMathContent(m[0]));
        }
        if (parts.length >= 2) {
          const base = parts[0];
          const accent = parts[1];
          // Common accents
          if (accent === "¯" || accent === "−" || accent === "-") {
            return base + "\u0304"; // Combining macron
          }
          if (accent === "^" || accent === "ˆ") {
            return base + "\u0302"; // Combining circumflex
          }
          if (accent === "~" || accent === "˜") {
            return base + "\u0303"; // Combining tilde
          }
          if (accent === "." || accent === "˙") {
            return base + "\u0307"; // Combining dot above
          }
          return base + accent;
        }
        return extractMathContent(content);
      },
    );

    // Handle <munder> (accent under)
    result = result.replace(
      /<munder[^>]*>([\s\S]*?)<\/munder>/gi,
      (_match, content) => {
        return extractMathContent(content);
      },
    );

    // Handle <mrow> (grouping) - just extract content
    result = result.replace(/<mrow[^>]*>([\s\S]*?)<\/mrow>/gi, (_m, c) =>
      extractMathContent(c),
    );

    // Handle <mfrac> (fractions): <mfrac><mn>1</mn><mn>2</mn></mfrac> → 1/2
    result = result.replace(
      /<mfrac[^>]*>([\s\S]*?)<\/mfrac>/gi,
      (_match, content) => {
        const parts: string[] = [];
        const tagRegex = /<(mi|mo|mn|mrow|mtext)[^>]*>([\s\S]*?)<\/\1>/gi;
        let m;
        while ((m = tagRegex.exec(content)) !== null) {
          parts.push(extractMathContent(m[0]));
        }
        if (parts.length >= 2) {
          return parts[0] + "/" + parts[1];
        }
        return extractMathContent(content);
      },
    );

    // Handle <mi> (identifier) - may have mathvariant attribute
    result = result.replace(
      /<mi[^>]*mathvariant="normal"[^>]*>([\s\S]*?)<\/mi>/gi,
      (_m, c) => c,
    );
    result = result.replace(/<mi[^>]*>([\s\S]*?)<\/mi>/gi, (_m, c) => c);

    // Handle <mo> (operator)
    result = result.replace(/<mo[^>]*>([\s\S]*?)<\/mo>/gi, (_m, c) => c);

    // Handle <mn> (number)
    result = result.replace(/<mn[^>]*>([\s\S]*?)<\/mn>/gi, (_m, c) => c);

    // Handle <mtext> (text)
    result = result.replace(/<mtext[^>]*>([\s\S]*?)<\/mtext>/gi, (_m, c) => c);

    // Handle <mspace> (space)
    result = result.replace(/<mspace[^>]*\/?>/gi, " ");

    // Remove the outer <math> tags
    result = result.replace(/<\/?math[^>]*>/gi, "");

    // Clean up any remaining tags
    result = result.replace(/<[^>]+>/g, "");

    // Normalize Unicode operators
    result = result
      .replace(/→/g, "→")
      .replace(/−/g, "-")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");

    return result;
  };

  // Process each <math>...</math> block
  const result = html.replace(/<math[\s\S]*?<\/math>/gi, (mathBlock) => {
    return extractMathContent(mathBlock);
  });

  return result;
}

export function cleanMathTitle(title?: string | null): string {
  if (!title) return "";

  // First, convert any MathML to text
  let text = convertMathML(title);

  const SUPERSCRIPT_CANDIDATE = /^[0-9A-Za-z+\-=()*]$/;
  const SUBSCRIPT_CANDIDATE = /^[0-9A-Za-z+\-=()]$/;
  const ESCAPED_LBRACE = "__MATH_ESC_LBRACE__";
  const ESCAPED_RBRACE = "__MATH_ESC_RBRACE__";

  text = text.replace(/\^\{?((?:\\prime)+)\}?/g, (_match, primes) => {
    const count = primes.match(/\\prime/g)?.length ?? 1;
    return "'".repeat(count);
  });
  text = text.replace(/\\prime/g, "'");

  // Handle font commands with braces: \text{...}, \mathrm{...}, etc.
  text = text.replace(
    /\\(text|mathrm|bf|it|mathcal|cal|rm|sf|tt)\{([^}]+)\}/g,
    "$2",
  );
  text = text.replace(/\\(cal|mathcal)\s+([A-Za-z])/g, "$2");

  // Handle declarative font commands without braces: \rm, \bf, \it, \sf, \tt
  // These affect all following text, so we just remove them
  // e.g., "1 \rm S" → "1 S" → "1S" (after trimInternal)
  text = text.replace(
    /\\(rm|bf|it|sf|tt|normalfont|textrm|textbf|textit|textsf|texttt)(?![a-zA-Z])/g,
    "",
  );

  // Remove spacing commands with their arguments: \hspace{...}, \vspace{...}, \kern{...}, \mkern{...}
  // These are used for fine-tuning spacing in LaTeX but should be completely removed in plain text
  // e.g., "J \hspace{-1.66656pt}/\hspace{-1.111pt}\psi" → "J/ψ"
  text = text.replace(/\\[hv]space\s*\{[^}]*\}/g, "");
  text = text.replace(/\\m?kern\s*-?[\d.]+\s*(pt|em|ex|mu|mm|cm|in)?/g, "");
  text = text.replace(/\\m?kern\s*\{[^}]*\}/g, "");
  // Also handle \, \; \: \! (thin/medium/thick/negative space)
  text = text.replace(/\\[,;:!]/g, "");
  // Handle \quad, \qquad, \enspace, \thinspace, \negthinspace
  text = text.replace(
    /\\(quad|qquad|enspace|thinspace|negthinspace|negthickspace|negmedspace)(?![a-zA-Z])/g,
    " ",
  );

  const superscriptMap: Record<string, string> = {
    0: "⁰",
    1: "¹",
    2: "²",
    3: "³",
    4: "⁴",
    5: "⁵",
    6: "⁶",
    7: "⁷",
    8: "⁸",
    9: "⁹",
    "+": "⁺",
    "-": "⁻",
    "=": "⁼",
    "(": "⁽",
    ")": "⁾",
    "*": "*",
    a: "ᵃ",
    b: "ᵇ",
    c: "ᶜ",
    d: "ᵈ",
    e: "ᵉ",
    f: "ᶠ",
    g: "ᵍ",
    h: "ʰ",
    i: "ⁱ",
    j: "ʲ",
    k: "ᵏ",
    l: "ˡ",
    m: "ᵐ",
    n: "ⁿ",
    o: "ᵒ",
    p: "ᵖ",
    r: "ʳ",
    s: "ˢ",
    t: "ᵗ",
    u: "ᵘ",
    v: "ᵛ",
    w: "ʷ",
    x: "ˣ",
    y: "ʸ",
    z: "ᶻ",
  };
  text = text.replace(
    /\^([0-9a-zA-Z+\-*])|\^\\(pm|mp)/g,
    (match, char: string, latex: string) => {
      if (char) {
        if (superscriptMap[char]) return superscriptMap[char];
        return `<sup>${char}</sup>`;
      }
      if (latex === "pm") return "<sup>±</sup>";
      if (latex === "mp") return "<sup>∓</sup>";
      return match;
    },
  );

  text = text.replace(/\^\{([^}]+)\}/g, (_match, content) => {
    const cleaned = cleanMathTitle(content);
    const candidates = [content.trim(), cleaned.trim()];
    for (const candidate of candidates) {
      if (candidate.length === 1) {
        if (superscriptMap[candidate]) return superscriptMap[candidate];
        if (SUPERSCRIPT_CANDIDATE.test(candidate)) {
          return `<sup>${candidate}</sup>`;
        }
      }
    }
    return `<sup>${cleaned}</sup>`;
  });

  const subscriptMap: Record<string, string> = {
    0: "₀",
    1: "₁",
    2: "₂",
    3: "₃",
    4: "₄",
    5: "₅",
    6: "₆",
    7: "₇",
    8: "₈",
    9: "₉",
    "+": "₊",
    "-": "₋",
    "=": "₌",
    "(": "₍",
    ")": "₎",
    a: "ₐ",
    e: "ₑ",
    h: "ₕ",
    i: "ᵢ",
    j: "ⱼ",
    k: "ₖ",
    l: "ₗ",
    m: "ₘ",
    n: "ₙ",
    o: "ₒ",
    p: "ₚ",
    r: "ᵣ",
    s: "ₛ",
    t: "ₜ",
    u: "ᵤ",
    v: "ᵥ",
    x: "ₓ",
  };
  text = text.replace(
    /_([0-9a-zA-Z+\-*])|_\\(pm|mp)/g,
    (match, char: string, latex: string) => {
      if (char) {
        if (char === "*") return "⁎";
        if (subscriptMap[char]) return subscriptMap[char];
        return `<sub>${char}</sub>`;
      }
      if (latex === "pm") return "<sub>±</sub>";
      if (latex === "mp") return "<sub>∓</sub>";
      return match;
    },
  );

  text = text.replace(/_\{([^}]+)\}/g, (_match, content) => {
    const cleaned = cleanMathTitle(content);
    const candidates = [content.trim(), cleaned.trim()];
    for (const candidate of candidates) {
      if (candidate.length === 1) {
        if (candidate === "*") return "⁎";
        if (subscriptMap[candidate]) return subscriptMap[candidate];
        if (SUBSCRIPT_CANDIDATE.test(candidate)) {
          return `<sub>${candidate}</sub>`;
        }
      }
    }
    return `<sub>${cleaned}</sub>`;
  });

  const greekMap: Record<string, string> = {
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\epsilon": "ε",
    "\\varepsilon": "ε",
    "\\zeta": "ζ",
    "\\eta": "η",
    "\\theta": "θ",
    "\\vartheta": "ϑ",
    "\\iota": "ι",
    "\\kappa": "κ",
    "\\varkappa": "ϰ",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\nu": "ν",
    "\\xi": "ξ",
    "\\pi": "π",
    "\\varpi": "ϖ",
    "\\rho": "ρ",
    "\\varrho": "ϱ",
    "\\sigma": "σ",
    "\\varsigma": "ς",
    "\\tau": "τ",
    "\\upsilon": "υ",
    "\\phi": "φ",
    "\\varphi": "φ",
    "\\chi": "χ",
    "\\psi": "ψ",
    "\\omega": "ω",
    "\\Gamma": "Γ",
    "\\varGamma": "Γ",
    "\\Delta": "Δ",
    "\\varDelta": "Δ",
    "\\Theta": "Θ",
    "\\varTheta": "Θ",
    "\\Lambda": "Λ",
    "\\varLambda": "Λ",
    "\\Xi": "Ξ",
    "\\varXi": "Ξ",
    "\\Pi": "Π",
    "\\varPi": "Π",
    "\\Sigma": "Σ",
    "\\varSigma": "Σ",
    "\\Upsilon": "Υ",
    "\\varUpsilon": "Υ",
    "\\Phi": "Φ",
    "\\varPhi": "Φ",
    "\\Psi": "Ψ",
    "\\varPsi": "Ψ",
    "\\Omega": "Ω",
    "\\varOmega": "Ω",
  };
  for (const [tex, char] of Object.entries(greekMap)) {
    const re = new RegExp(tex.replace("\\", "\\\\") + "(?![a-zA-Z])", "g");
    text = text.replace(re, char);
  }

  text = text
    .replace(/\\to/g, "→")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\leftarrow/g, "←")
    .replace(/\\longrightarrow/g, "⟶")
    .replace(/\\longleftarrow/g, "⟵")
    .replace(/\\infty/g, "∞")
    .replace(/\\approx/g, "≈")
    .replace(/\\simeq/g, "≃")
    .replace(/\\sim/g, "~")
    .replace(/\\times/g, "×")
    .replace(/\\pm/g, "±")
    .replace(/\\mp/g, "∓")
    .replace(/\\sqrt/g, "√")
    .replace(/\\partial/g, "∂")
    .replace(/\\nabla/g, "∇")
    .replace(/\\cdot/g, "⋅")
    .replace(/\\neq/g, "≠")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\ll/g, "≪")
    .replace(/\\gg/g, "≫")
    .replace(/\\leftrightarrow/g, "↔")
    .replace(/\\ell/g, "ℓ")
    .replace(/\\hbar/g, "ℏ")
    .replace(/\\dagger/g, "†")
    .replace(/\\ast/g, "*")
    .replace(/\\star/g, "★")
    .replace(/\\bullet/g, "•")
    .replace(/\\circ/g, "∘")
    .replace(/\\bar\{([^}]+)\}/g, "$1\u0304")
    .replace(/-{2,}>/g, "→") // ---> or --> to →
    .replace(/->/g, "→");

  text = text.replace(/\$([^$]+)\$/g, (_match, content) => {
    let inner = (content as string)
      .replace(/\\\{/g, ESCAPED_LBRACE)
      .replace(/\\\}/g, ESCAPED_RBRACE)
      .replace(/\s+/g, "");
    inner = inner
      .replace(/\^\{?\+?\}?/g, "⁺")
      .replace(/\^\{?-?\}?/g, "⁻")
      .replace(/e\^/g, "e")
      .replace(/\\/g, "");
    inner = inner.replace(/[{}]/g, "");
    inner = inner
      .replace(new RegExp(ESCAPED_LBRACE, "g"), "{")
      .replace(new RegExp(ESCAPED_RBRACE, "g"), "}");
    return inner;
  });

  text = text.replace(/\\\{/g, "{").replace(/\\\}/g, "}");

  // Handle old-style square root notation: s**(1/2) → √s, x**(1/2) → √x
  text = text.replace(/(\w)\*\*\(1\/2\)/g, "√$1");
  text = text.replace(/\*\*\(1\/2\)/g, "^(1/2)"); // Fallback for standalone

  // Handle old-style exponent notation: **2 → ² (superscript)
  text = text.replace(/\*\*(\d+)/g, (_match, num) => {
    const superscriptMap: Record<string, string> = {
      "0": "⁰",
      "1": "¹",
      "2": "²",
      "3": "³",
      "4": "⁴",
      "5": "⁵",
      "6": "⁶",
      "7": "⁷",
      "8": "⁸",
      "9": "⁹",
    };
    return num
      .split("")
      .map((d: string) => superscriptMap[d] || d)
      .join("");
  });

  // Handle old-style INSPIRE format: 0.9-GeV → 0.9 GeV (remove hyphen before units)
  // Also handle "10. GeV" → "10 GeV" (trailing decimal point)
  // Must be done before Title Case conversion
  text = text.replace(
    /(\d)-?(TEV|GEV|MEV|KEV|EV|GEV\*\*2|MEV\*\*2)\b/gi,
    "$1 $2",
  );
  text = text.replace(/(\d)\.\s+(TEV|GEV|MEV|KEV|EV)\b/gi, "$1 $2");

  // Handle approximate symbol: ~ → ≈ (when used as "approximately")
  // Only convert when surrounded by spaces or at word boundaries (not in URLs or paths)
  text = text.replace(/\s~\s/g, " ≈ ");
  text = text.replace(/\s~(\d)/g, " ≈ $1");

  // Check if title is ALL CAPS and convert to Title Case if so
  // This must happen BEFORE particle symbol conversion
  text = convertAllCapsToTitleCase(text);

  // Convert particle names with charge notation to proper symbols
  // e.g., pi+ → π⁺, pi- → π⁻, K+ → K⁺, mu- → μ⁻
  // Must be done AFTER Title Case conversion to avoid Pi+ instead of π⁺
  text = convertParticleNotation(text);

  return trimInternal(text);
}

/**
 * Convert particle notation to proper Unicode symbols
 */
function convertParticleNotation(text: string): string {
  // Handle prime notation first: psi-prime → psi', eta-prime → eta'
  // Must be done BEFORE Greek letter conversion so psi' → ψ'
  // Order matters: -double-prime must be matched before -prime
  text = text.replace(/\b(\w+)-double-prime\b/gi, "$1''");
  text = text.replace(/\b(\w+)-prime\b/gi, "$1'");

  // Map of particle names to their symbols (case-insensitive matching)
  // Note: "pion" and "kaon" are excluded - they should remain as words
  // Only convert symbol forms like "pi+", "K+" etc.
  const particleMap: Record<string, string> = {
    pi: "π", // but not "pion"
    mu: "μ",
    muon: "μ",
    tau: "τ",
    tauon: "τ",
    eta: "η",
    rho: "ρ",
    omega: "ω",
    phi: "φ",
    sigma: "Σ",
    lambda: "Λ",
    xi: "Ξ",
    delta: "Δ",
    nu: "ν",
    neutrino: "ν",
    gamma: "γ",
    upsilon: "Υ",
    psi: "ψ",
    chi: "χ",
  };

  // Convert particle+charge patterns: pi+ → π⁺, Pi- → π⁻, pi0 → π⁰
  // Also handles prime notation: psi' → ψ', eta' → η'
  for (const [name, symbol] of Object.entries(particleMap)) {
    // Match particle name (case-insensitive) followed by optional prime(s) and charge
    // Use word boundary at start only; charge/prime characters are non-word chars
    const pattern = new RegExp(
      `\\b${name}('+)?(\\+{1,2}|-{1,2}|0)?(?![a-zA-Z])`,
      "gi",
    );
    text = text.replace(pattern, (_match, primes, charge) => {
      let result = symbol;
      if (primes) result += primes; // Keep the prime marks
      if (charge) {
        for (const c of charge) {
          if (c === "+") result += "⁺";
          else if (c === "-") result += "⁻";
          else if (c === "0") result += "⁰";
        }
      }
      return result;
    });
  }

  // Convert common particle pairs: e+e- → e⁺e⁻, p+p- → p⁺p⁻
  // Also handle: e+ e- (with space)
  text = text.replace(/\b([epKBD])\+\s*\1-/gi, (match, p) => {
    const particle = p.toLowerCase() === "e" ? "e" : p; // Keep e lowercase
    return particle + "⁺" + particle + "⁻";
  });
  text = text.replace(/\b([epKBD])-\s*\1\+/gi, (match, p) => {
    const particle = p.toLowerCase() === "e" ? "e" : p;
    return particle + "⁻" + particle + "⁺";
  });

  // Convert single particle charges: e+, e-, p+, K+, K-, B+, B-, D+, D-, W+, W-, Z
  text = text.replace(/\b([eE])([+-])/g, (_match, _p, charge) => {
    return "e" + (charge === "+" ? "⁺" : "⁻");
  });
  text = text.replace(/\b([pKBDWH])([+-])\b/g, (_match, particle, charge) => {
    return particle + (charge === "+" ? "⁺" : "⁻");
  });

  // Handle excited state notation: D(*) → D⁽*⁾, B(*) → B⁽*⁾
  // The (*) indicates the particle can be either ground state or excited
  text = text.replace(/\b([KBDX])(\(\*\))/g, "$1⁽*⁾");

  // Handle anti-particle notation: anti-D → D̄, anti-B → B̄, anti-b → b̄
  // Uses combining overline (U+0304) for the bar
  // Preserve original case: anti-b (quark) stays lowercase, anti-B (meson) stays uppercase
  text = text.replace(/\banti-([a-zA-Z])/g, (_match, p) => p + "\u0304");
  text = text.replace(/\bbar-([a-zA-Z])/g, (_match, p) => p + "\u0304");

  return text;
}

/**
 * Check if a string is predominantly ALL CAPS
 * Returns true if most letters are uppercase
 */
function isAllCaps(text: string): boolean {
  // Extract only letters (ignore numbers, symbols, etc.)
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 3) return false; // Too short to determine

  const upperCount = (letters.match(/[A-Z]/g) || []).length;
  const lowerCount = (letters.match(/[a-z]/g) || []).length;

  // Consider it ALL CAPS if >80% of letters are uppercase
  // and there are very few lowercase letters
  return upperCount > 0 && lowerCount / letters.length < 0.2;
}

/**
 * Convert ALL CAPS text to Title Case
 * Preserves known acronyms and special terms
 */
function convertAllCapsToTitleCase(text: string): string {
  if (!isAllCaps(text)) {
    return text;
  }

  // Common words that should stay lowercase in Title Case (except at start)
  const lowercaseWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "but",
    "or",
    "nor",
    "for",
    "yet",
    "so",
    "at",
    "by",
    "in",
    "of",
    "on",
    "to",
    "up",
    "as",
    "is",
    "if",
    "into",
    "onto",
    "upon",
    "with",
    "from",
    "over",
    "under",
  ]);

  // Physics acronyms and terms that should stay uppercase
  const keepUppercase = new Set([
    "QCD",
    "QED",
    "QFT",
    "SM",
    "BSM",
    "SUSY",
    "MSSM",
    "NMSSM",
    "LHC",
    "ATLAS",
    "CMS",
    "ALICE",
    "LHCB",
    "BELLE",
    "BABAR",
    "LEP",
    "HERA",
    "RHIC",
    "TEVATRON",
    "CERN",
    "SLAC",
    "DESY",
    "KEK",
    "FERMILAB",
    "PDF",
    "NLO",
    "NNLO",
    "LO",
    "EW",
    "EFT",
    "UV",
    "IR",
    "CP",
    "CPT",
    "CPV",
    "CKM",
    "PMNS",
    "GUT",
    "TOE",
    "DM",
    "DE",
    "WIMP",
    "MACHO",
    "PBH",
    "CMB",
    "BBN",
    "BAO",
    "SNE",
    "GRB",
    "AGN",
    "BH",
    "LIGO",
    "VIRGO",
    "LISA",
    "ET",
    "MC",
    "ML",
    "NN",
    "DNN",
    "CNN",
    "RNN",
    "GAN",
    "VAE",
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
    "X",
    "USA",
    "UK",
    "EU",
    "UN",
    "PP",
    "PB",
    "AU", // collision types
  ]);

  // Terms that have specific casing (case-insensitive lookup, value is correct form)
  const specialCasing: Record<string, string> = {
    // Energy units (with and without exponents)
    TEV: "TeV",
    GEV: "GeV",
    MEV: "MeV",
    KEV: "keV",
    EV: "eV",
    "TEV²": "TeV²",
    "GEV²": "GeV²",
    "MEV²": "MeV²",
    "KEV²": "keV²",
    "EV²": "eV²",
    // Particles - keep capitalized
    HIGGS: "Higgs",
  };

  const words = text.split(/(\s+)/); // Split but keep whitespace
  const result: string[] = [];
  let isFirstWord = true;

  for (const word of words) {
    // Keep whitespace as-is
    if (/^\s+$/.test(word)) {
      result.push(word);
      continue;
    }

    const upperWord = word.toUpperCase();

    // Check for special casing first (e.g., TeV, GeV)
    if (specialCasing[upperWord]) {
      result.push(specialCasing[upperWord]);
      isFirstWord = false;
      continue;
    }

    // Check if it's a known acronym (keep uppercase)
    if (keepUppercase.has(upperWord)) {
      result.push(upperWord);
      isFirstWord = false;
      continue;
    }

    // Check for particle symbols like Υ, ψ, Λ - keep as-is
    if (/^[Υυψ∧Λλ∑Σ∏Π∆Δ]+$/.test(word)) {
      result.push(word);
      isFirstWord = false;
      continue;
    }

    // Check for particle names that should stay lowercase (will be converted to symbols later)
    const lowerWord = word.toLowerCase();
    const particleNames = [
      "pi",
      "pion",
      "mu",
      "muon",
      "tau",
      "tauon",
      "eta",
      "rho",
      "omega",
      "phi",
      "sigma",
      "lambda",
      "xi",
      "delta",
      "nu",
      "neutrino",
      "gamma",
      "upsilon",
      "psi",
      "chi",
    ];
    // Single-letter particles with charge: e+, e-, p+, p-
    const singleLetterParticlePattern = /^[ep][+-]$/i;
    if (
      particleNames.includes(lowerWord) ||
      particleNames.some(
        (p) =>
          lowerWord.startsWith(p) &&
          /^[+\-0]+$/.test(lowerWord.slice(p.length)),
      ) ||
      singleLetterParticlePattern.test(lowerWord)
    ) {
      // Keep particle names lowercase (they'll be converted to symbols later)
      result.push(lowerWord);
      isFirstWord = false;
      continue;
    }

    // Convert to Title Case
    // First word is always capitalized
    if (isFirstWord) {
      result.push(lowerWord.charAt(0).toUpperCase() + lowerWord.slice(1));
    } else if (lowercaseWords.has(lowerWord)) {
      // Common small words stay lowercase
      result.push(lowerWord);
    } else {
      // Other words get capitalized
      result.push(lowerWord.charAt(0).toUpperCase() + lowerWord.slice(1));
    }

    isFirstWord = false;
  }

  return result.join("");
}
