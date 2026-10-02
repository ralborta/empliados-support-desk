import Image from "next/image";

export function AtilioAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass =
    size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  const imgSize = size === "sm" ? 28 : size === "lg" ? 40 : 32;

  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-full bg-black ${sizeClass}`}
      title="Kira"
    >
      <Image
        src="/kira-avatar.png"
        alt="Kira"
        width={imgSize}
        height={imgSize}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
