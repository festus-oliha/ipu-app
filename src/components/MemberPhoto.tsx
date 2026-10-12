/* eslint-disable @next/next/no-img-element -- private, signed-in image served by our own route */

/** The member's photo, or their initials on the brand colour when there is none. */
export function MemberPhoto({ memberId, name, version, className = "" }: { memberId: string; name: string; version: string | null; className?: string }) {
  if (version) {
    return <img src={`/files/photos/${memberId}?v=${encodeURIComponent(version)}`} alt={`Photo of ${name}`} className={`object-cover ${className}`} />;
  }
  const initials = name.replace(/\(.*\)/, "").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(Mr|Mrs|Miss|Madam|Chief|Dr|Pastor)\.?$/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return (
    <div aria-label={`No photo of ${name} yet`} className={`flex items-center justify-center bg-forest/10 font-display text-3xl text-forest ${className}`}>
      {initials}
    </div>
  );
}
