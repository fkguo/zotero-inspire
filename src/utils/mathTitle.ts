function trimInternal(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function cleanMathTitle(title?: string | null): string {
  if (!title) return "";

  let text = title;

  const SUPERSCRIPT_CANDIDATE = /^[0-9A-Za-z+\-=()*]$/;
  const SUBSCRIPT_CANDIDATE = /^[0-9A-Za-z+\-=()]$/;
  const ESCAPED_LBRACE = "__MATH_ESC_LBRACE__";
  const ESCAPED_RBRACE = "__MATH_ESC_RBRACE__";

  text = text.replace(/\^\{?((?:\\prime)+)\}?/g, (_match, primes) => {
    const count = primes.match(/\\prime/g)?.length ?? 1;
    return "'".repeat(count);
  });
  text = text.replace(/\\prime/g, "'");

  text = text.replace(/\\(text|mathrm|bf|it|mathcal|cal)\{([^}]+)\}/g, "$2");
  text = text.replace(/\\(cal|mathcal)\s+([A-Za-z])/g, "$2");

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
    /_([0-9a-zA-Z+\-*])|\_\\(pm|mp)/g,
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
    "\\zeta": "ζ",
    "\\eta": "η",
    "\\theta": "θ",
    "\\iota": "ι",
    "\\kappa": "κ",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\nu": "ν",
    "\\xi": "ξ",
    "\\pi": "π",
    "\\rho": "ρ",
    "\\sigma": "σ",
    "\\tau": "τ",
    "\\upsilon": "υ",
    "\\phi": "φ",
    "\\chi": "χ",
    "\\psi": "ψ",
    "\\omega": "ω",
    "\\Gamma": "Γ",
    "\\Delta": "Δ",
    "\\Theta": "Θ",
    "\\Lambda": "Λ",
    "\\Xi": "Ξ",
    "\\Pi": "Π",
    "\\Sigma": "Σ",
    "\\Upsilon": "Υ",
    "\\Phi": "Φ",
    "\\Psi": "Ψ",
    "\\Omega": "Ω",
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
    .replace(/\\bar\{([^}]+)\}/g, "$1\u0304")
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

  return trimInternal(text);
}

