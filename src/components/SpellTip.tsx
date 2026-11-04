"use client";

/**
 * Spell name with Wowhead's hover tooltip, for use inside buttons. Wowhead's script only handles links with
 * a real address, so this is a Wowhead link whose click is cancelled: the surrounding button keeps working.
 */
export function SpellTip({ id, children }: { id: number; children: React.ReactNode }) {
  if (id <= 1) return <>{children}</>;
  return (
    <a href={`https://www.wowhead.com/spell=${id}`} tabIndex={-1} onClick={(e) => e.preventDefault()} className="cursor-pointer">
      {children}
    </a>
  );
}
