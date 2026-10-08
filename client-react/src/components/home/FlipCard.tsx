import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { CardInteractionContext } from "./CardInteractionContext";
import "./flip-card-controls.css";

interface Props {
  front: ReactNode;
  back: ReactNode;
  className?: string;
}

function DogEar({
  onClick,
  reversed,
  buttonRef,
}: {
  onClick: () => void;
  reversed: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      type="button"
      className="dog-ear"
      ref={buttonRef}
      onClick={onClick}
      title={reversed ? "Show card front" : "About this card"}
      aria-label={reversed ? "Show card front" : "About this card"}
    >
      <span aria-hidden="true" className="dog-ear__fold" />
      <span aria-hidden="true" className="dog-ear__under" />
      <span className="dog-ear__label">{reversed ? "↩" : "i"}</span>
    </button>
  );
}

export function FlipCard({ front, back, className }: Props) {
  const [flipped, setFlipped] = useState(false);
  const carousel = useContext(CardInteractionContext);
  const frontButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const shouldMoveFocus = useRef(false);
  useEffect(() => {
    if (carousel && !carousel.active) setFlipped(false);
  }, [carousel?.active]);
  useLayoutEffect(() => {
    if (!shouldMoveFocus.current) return;
    shouldMoveFocus.current = false;
    (flipped ? backButton : frontButton).current?.focus({
      preventScroll: true,
    });
  }, [flipped]);

  const flip = (next: boolean) => {
    shouldMoveFocus.current = true;
    setFlipped(next);
    carousel?.onFlipChange(next);
    // Both faces stay mounted for the Fold animation, but only one is operable.
  };

  return (
    <div
      className={`flip-card ${flipped ? "flip-card--flipped" : ""} ${className || ""}`}
    >
      <div className="flip-card__inner">
        <div className="flip-card__front" aria-hidden={flipped} inert={flipped}>
          <DogEar
            onClick={() => flip(true)}
            reversed={false}
            buttonRef={frontButton}
          />
          {front}
        </div>
        <div
          className="flip-card__back"
          aria-hidden={!flipped}
          inert={!flipped}
        >
          <DogEar onClick={() => flip(false)} reversed buttonRef={backButton} />
          {back}
        </div>
      </div>
    </div>
  );
}
