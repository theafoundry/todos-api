import type { SVGProps } from "react";
import fold from "../../brand/fold.json";

export interface BrandMarkProps extends SVGProps<SVGSVGElement> {
  size?: number;
  label?: string;
  variant?: "adaptive" | "coral" | "cream" | "ink";
}

/** Fold's two wings share the geometry used to generate every brand asset. */
export function BrandMark({
  size = 24,
  className,
  label,
  variant = "adaptive",
  ...rest
}: BrandMarkProps) {
  const accessibleLabel = label ?? rest["aria-label"];
  const named = Boolean(accessibleLabel || rest["aria-labelledby"]);
  const fill =
    variant === "adaptive"
      ? "var(--brand-mark, #E17055)"
      : fold.colors[variant];

  return (
    <svg
      width={size}
      height={size}
      viewBox={fold.viewBox}
      fill={fill}
      className={className}
      role={named ? "img" : undefined}
      aria-label={accessibleLabel}
      aria-hidden={named ? undefined : true}
      {...rest}
    >
      {fold.paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
