import type { ReactNode } from "react";
import type { BottomSheetSnap } from "../hooks/useBottomSheet";
import { MobileModal } from "./MobileModal";

interface Props {
  snap: BottomSheetSnap;
  onClose: () => void;
  onExpandFull: () => void;
  halfContent: ReactNode;
  fullContent: ReactNode;
  title?: string;
  dismissDisabled?: boolean;
}

export function BottomSheet({
  snap,
  onClose,
  onExpandFull,
  halfContent,
  fullContent,
  title = "Task details",
  dismissDisabled,
}: Props) {
  return (
    <MobileModal
      open={snap !== "closed"}
      title={title}
      onClose={onClose}
      onExpand={snap === "half" ? onExpandFull : undefined}
      compact={snap === "half"}
      fullHeight={snap === "full"}
      dismissDisabled={dismissDisabled}
      className={`m-bottom-sheet m-bottom-sheet--${snap}`}
      backdropClassName="m-bottom-sheet__backdrop"
    >
      {snap === "half" ? halfContent : fullContent}
    </MobileModal>
  );
}
