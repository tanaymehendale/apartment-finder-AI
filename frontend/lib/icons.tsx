// Shared SVG icon set (P4-3). Rounded stroke line icons, 1.75-2 stroke width,
// 24x24 viewBox — a consistent, warm alternative to raw emoji (🚗 ⭐ 🤫) and
// ad-hoc glyphs (braille spinner frames, "✓ " text prefixes) used previously.
// Every icon accepts a className so callers control size/color via Tailwind.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

// Wordmark glyph — an abstract roofline over a path, used for the brand
// mark and the assistant's message avatar.
export function MarkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12.5 12 5l8 7.5" />
      <path d="M6.5 11v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-7" />
      <path d="M10 19v-4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V19" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <rect x="6" y="6" width="12" height="12" rx="3" />
    </svg>
  );
}

export function BedIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7" />
      <path d="M3 18v2M21 18v2" />
      <path d="M3 13h18" />
      <path d="M6.5 13V9.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V13" />
    </svg>
  );
}

export function BathIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12h16v2.5A4.5 4.5 0 0 1 15.5 19h-7A4.5 4.5 0 0 1 4 14.5V12Z" />
      <path d="M6 12V7a2 2 0 0 1 3.2-1.6" />
      <path d="M7 19v2M17 19v2" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2.5" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M17.7 16.7 13.4 21a1.98 1.98 0 0 1-2.8 0l-4.3-4.3a8 8 0 1 1 11.4 0Z" />
      <circle cx="12" cy="11" r="2.75" />
    </svg>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
      <path d="M14 4h6v6M20 4 10 14" />
    </svg>
  );
}

export function RouteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 20 3.5 17.4a1 1 0 0 1-.5-.9V5.6a1 1 0 0 1 1.4-.9L9 7m0 13 6-3m-6 3V7m6 10 4.6 2.3a1 1 0 0 0 1.4-.9V7.6a1 1 0 0 0-.5-.9L15 4m0 13V4m0 0L9 7" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 19 6.3v5.4c0 4.3-2.9 7.6-7 8.8-4.1-1.2-7-4.5-7-8.8V6.3L12 3.5Z" />
      <path d="m9.25 12 2 2 3.5-3.75" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg fill="currentColor" stroke="none" viewBox="0 0 24 24" {...props}>
      <path d="M11.2 3.6a.9.9 0 0 1 1.6 0l1.4 2.9a5.6 5.6 0 0 0 2.6 2.6l2.9 1.4a.9.9 0 0 1 0 1.6l-2.9 1.4a5.6 5.6 0 0 0-2.6 2.6l-1.4 2.9a.9.9 0 0 1-1.6 0l-1.4-2.9a5.6 5.6 0 0 0-2.6-2.6l-2.9-1.4a.9.9 0 0 1 0-1.6l2.9-1.4a5.6 5.6 0 0 0 2.6-2.6l1.4-2.9Z" />
    </svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.14" />
      <path d="m8.25 12.25 2.5 2.5 5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v16m8-8H4" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M6 18 18 6" />
    </svg>
  );
}

// Used as the ApartmentCard photo-slot fallback when a listing has no photo.
export function BuildingIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h5A1.5 1.5 0 0 1 14 4.5V21" />
      <path d="M14 10.5h4A1.5 1.5 0 0 1 19.5 12V21" />
      <path d="M6 21h13.5" />
      <path d="M8.5 7h2M8.5 10.5h2M8.5 14h2M15 13.5h2M15 17h2" />
    </svg>
  );
}

export function HomeSearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 11.5 11.5 5l7.5 6.5" />
      <path d="M6.5 10v6.5a1 1 0 0 0 1 1H12" />
      <circle cx="16.5" cy="16.5" r="2.75" />
      <path d="m19.3 19.3 1.7 1.7" />
    </svg>
  );
}
