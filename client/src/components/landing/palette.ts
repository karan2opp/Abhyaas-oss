// The landing page's colours. ink, cream and paper are theme variables (defined in globals.css, light and dark); the rest are fixed.
// The landing page's colours. Orange is the brand colour and leads; pink, blue and lime are the playful pops around it,
// on a near-white page with near-black ink. "paper" is a soft grey-beige for tiles, tracks and highlights on white.
export const C = {
  cream: "var(--l-bg)",
  paper: "var(--l-paper)",
  ink: "var(--l-ink)",
  orange: "#F26A1B",
  pink: "#FF5C9A",
  blue: "#3F5CFF",
  lime: "#C5F135",
  yellow: "#FFC83D",
} as const;

// A soft offset shadow, like a cut-out paper sticker.
export const STICKER_SHADOW = "6px 7px 0 rgba(27,20,16,0.16)";
