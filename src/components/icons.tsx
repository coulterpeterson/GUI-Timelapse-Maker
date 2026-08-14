// Small inline SVGs so the app ships no icon-font or external asset.
const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const ExpandIcon = () => (
  <svg {...base}>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
  </svg>
);

export const FlagStartIcon = () => (
  <svg {...base} width={13} height={13}>
    <path d="M6 21V4" />
    <path d="M6 5h11l-2.5 4L17 13H6" />
  </svg>
);

export const FlagEndIcon = () => (
  <svg {...base} width={13} height={13}>
    <path d="M18 21V4" />
    <path d="M18 5H7l2.5 4L7 13h11" />
  </svg>
);

export const ChevronLeftIcon = () => (
  <svg {...base} width={28} height={28}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg {...base} width={28} height={28}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base} width={22} height={22}>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

export const FolderIcon = () => (
  <svg {...base}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const AlertIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16.5v.01" />
  </svg>
);

export const FilmIcon = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 12h18M3 8h4M3 16h4M17 8h4M17 16h4" />
  </svg>
);
