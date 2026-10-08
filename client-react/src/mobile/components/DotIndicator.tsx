interface Props {
  count: number;
  activeIndex: number;
  onSelect: (index: number) => void;
}

export function DotIndicator({ count, activeIndex, onSelect }: Props) {
  if (count <= 1) return null;

  return (
    <nav className="m-dot-indicator" aria-label="Card position">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          className={`m-dot${i === activeIndex ? " m-dot--active" : ""}`}
          type="button"
          aria-current={i === activeIndex ? "true" : undefined}
          aria-label={`Card ${i + 1} of ${count}`}
          onClick={() => onSelect(i)}
        />
      ))}
    </nav>
  );
}
