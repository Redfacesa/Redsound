export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#e23b2f" />
      <rect x="10" y="30" width="7" height="14" rx="1.5" fill="#fff" />
      <rect x="21" y="18" width="7" height="32" rx="1.5" fill="#fff" />
      <rect x="32" y="10" width="7" height="44" rx="1.5" fill="#fff" />
      <rect x="43" y="22" width="7" height="26" rx="1.5" fill="#fff" />
    </svg>
  );
}
