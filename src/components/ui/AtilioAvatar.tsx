import Image from "next/image";

export function AtilioAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass =
    size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  const imgSize = size === "sm" ? 16 : size === "lg" ? 22 : 18;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#4a0e1c] ring-2 ring-[#4a0e1c]/20 ${sizeClass}`}
      title="Atilio"
    >
      <Image
        src="/wara-logo.png"
        alt="Atilio"
        width={imgSize}
        height={imgSize}
        className="h-[55%] w-[55%] object-contain brightness-0 invert"
      />
    </span>
  );
}
