# Abhyas AI Platform - Design System Specification

## Brand Lane & Voice
- **Surface Lane:** Product UI & Dashboard (AI Exam & Learning Management Platform)
- **Tone:** Technical, Modern, Precise, OLED Pitch Black Contrast
- **Visual Aesthetic:** True Pitch Black dark mode, crisp flame orange highlights, amber gold indicators, high-contrast white text.

## Color Tokens

### Backgrounds & Surfaces
- `--background`: `#000000` (True Pitch Black)
- `--card`: `#09090b` (Obsidian Charcoal Surface)
- `--popover`: `#09090b` (Elevated Obsidian Layer)
- `--sidebar`: `#000000` (True Pitch Black Sidebar)
- `--muted`: `#141416` (Subtle Obsidian Inset / Code Block Surface)

### Brand Accents
- `--primary`: `#EA580C` (Flame Orange 600)
- `--primary-foreground`: `#FFFFFF`
- `--secondary`: `#F59E0B` (Amber Gold 500)
- `--secondary-foreground`: `#FFFFFF`
- `--accent`: `#C2410C` (Terracotta/Copper 700)
- `--accent-foreground`: `#FAFAFA`
- `--ring`: `#F97316` (Vibrant Orange Highlight Ring)

### Status Indicators
- **Success / Active**: `#10B981` (Emerald 500) / `bg-emerald-500/15 text-emerald-200 border-emerald-500/30`
- **Pending / Warning**: `#F59E0B` (Amber 500) / `bg-amber-500/15 text-amber-200 border-amber-500/30`
- **Destructive / Due**: `#EF4444` (Rose Red 500) / `bg-rose-500/15 text-rose-200 border-rose-500/30`

### Typography & Contrast Rules
- **Headings**: `Space Grotesk`, `text-white` (`#FAFAFA`)
- **Body Text**: `Inter`, `text-white/80` or `text-zinc-300` (`#E5E7EB`)
- **Muted Labels**: `text-zinc-400` or `text-zinc-500`
- **Rule**: Never use gray text directly on colored backgrounds. Always use bright tints or crisp white.
