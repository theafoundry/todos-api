import { useState, useCallback, useId } from "react";
import {
  IllustrationSwipe,
  IllustrationCapture,
  IllustrationTap,
} from "./Illustrations";
import { useModalSurface } from "../hooks/useModalSurface";

const ONBOARDING_KEY = "mobile:onboardingDone";

interface Step {
  icon: React.ReactNode;
  title: string;
  desc: string;
}

const STEPS: Step[] = [
  {
    icon: <IllustrationSwipe />,
    title: "Swipe to act",
    desc: "Swipe right to complete a task. Swipe left to choose when to plan it. These actions are also available in task details.",
  },
  {
    icon: <IllustrationCapture />,
    title: "Quick capture",
    desc: "Tap the + button to add a task in seconds.",
  },
  {
    icon: <IllustrationTap />,
    title: "Tap for details",
    desc: "Tap a task to see details. Choose Edit to change it, or Plan for to schedule it without changing its deadline.",
  },
];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(ONBOARDING_KEY) === "1",
  );

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      localStorage.setItem(ONBOARDING_KEY, "1");
      setDismissed(true);
    }
  }, [step]);

  const handleSkip = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    setDismissed(true);
  }, []);

  const titleId = useId();
  const descriptionId = useId();
  const { layerRef, dialogRef } = useModalSurface(!dismissed, handleSkip);

  if (dismissed) return null;

  const current = STEPS[step];

  return (
    <div className="m-onboarding__backdrop" ref={layerRef}>
      <div
        className="m-onboarding"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="m-onboarding__icon" aria-hidden="true">
          {current.icon}
        </div>
        <div aria-live="polite" aria-atomic="true">
          <h2 id={titleId} className="m-onboarding__title">
            {current.title}
          </h2>
          <p id={descriptionId} className="m-onboarding__desc">
            {current.desc}
          </p>
          <span className="sr-only">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        <div className="m-onboarding__dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`m-onboarding__dot${i === step ? " m-onboarding__dot--active" : ""}`}
            />
          ))}
        </div>

        <div className="m-onboarding__actions">
          <button
            type="button"
            className="m-onboarding__skip"
            onClick={handleSkip}
          >
            Skip
          </button>
          <button
            type="button"
            className="m-onboarding__next"
            onClick={handleNext}
            data-autofocus
          >
            {step < STEPS.length - 1 ? "Next" : "Get started"}
          </button>
        </div>
      </div>
    </div>
  );
}
