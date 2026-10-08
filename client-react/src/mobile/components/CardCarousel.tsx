import {
  useEffect,
  useState,
  isValidElement,
  type ReactNode,
  Children,
} from "react";
import { useSwipeNavigation } from "../hooks/useSwipeNavigation";
import { DotIndicator } from "./DotIndicator";
import { CardInteractionContext } from "../../components/home/CardInteractionContext";
import "./card-interactions.css";

interface Props {
  children: ReactNode[];
}

export function CardCarousel({ children }: Props) {
  const cards = Children.toArray(children);
  const keys = cards.map((card, index) =>
    isValidElement(card) && card.key !== null
      ? String(card.key)
      : String(index),
  );
  const identity = JSON.stringify(keys);
  const [flippedIndex, setFlippedIndex] = useState<number | null>(null);
  useEffect(() => setFlippedIndex(null), [identity]);

  const { activeIndex, handlers, goTo } = useSwipeNavigation({
    count: cards.length,
    locked: flippedIndex !== null,
    onIndexChange: () => setFlippedIndex(null),
  });

  return (
    <section
      className="m-carousel"
      aria-label="Focus cards"
      aria-roledescription="carousel"
    >
      <div
        className="m-carousel__track"
        style={{ transform: `translateX(${-(activeIndex * 100)}%)` }}
        {...handlers}
      >
        {cards.map((card, i) => (
          <div
            key={keys[i]}
            className="m-carousel__slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`Card ${i + 1} of ${cards.length}`}
            aria-hidden={i !== activeIndex}
            inert={i !== activeIndex}
          >
            <CardInteractionContext.Provider
              value={{
                active: i === activeIndex,
                onFlipChange: (flipped) => setFlippedIndex(flipped ? i : null),
              }}
            >
              {card}
            </CardInteractionContext.Provider>
          </div>
        ))}
      </div>
      {cards.length > 1 && (
        <div className="m-carousel__navigation">
          <button
            type="button"
            aria-label="Previous card"
            disabled={activeIndex === 0}
            onClick={() => goTo(activeIndex - 1)}
          >
            ‹
          </button>
          <DotIndicator
            count={cards.length}
            activeIndex={activeIndex}
            onSelect={goTo}
          />
          <button
            type="button"
            aria-label="Next card"
            disabled={activeIndex === cards.length - 1}
            onClick={() => goTo(activeIndex + 1)}
          >
            ›
          </button>
        </div>
      )}
      <span className="m-carousel__position" role="status">
        {cards.length > 0
          ? `Card ${activeIndex + 1} of ${cards.length}`
          : "No focus cards"}
      </span>
    </section>
  );
}
