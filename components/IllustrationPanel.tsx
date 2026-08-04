import Image from "next/image";

export function IllustrationPanel({
  src,
  alt,
  priority = false,
  className = "",
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`illustration-panel ${className}`.trim()}>
      <Image
        src={src}
        alt={alt}
        width={800}
        height={800}
        priority={priority}
        loading={priority ? "eager" : "lazy"}
        className="h-auto max-h-[22rem] w-full object-contain sm:max-h-[28rem]"
      />
    </div>
  );
}

export function FeatureIllustration({
  src,
  alt,
  compact = false,
}: {
  src: string;
  alt: string;
  compact?: boolean;
}) {
  return (
    <div className="feature-illustration">
      <Image
        src={src}
        alt={alt}
        width={720}
        height={520}
        className={`${compact ? "h-32 sm:h-36" : "h-48 sm:h-56"} w-full object-contain p-4`}
      />
    </div>
  );
}
