import type { Todo, User } from "../../types";
import type { RefObject } from "react";
import { InboxReview } from "../../components/inbox/InboxReview";
import { MobileHeader } from "../MobileHeader";

interface Props {
  user: User | null;
  refreshRef: RefObject<(() => Promise<boolean>) | null>;
  onAvatarClick: () => void;
  onSearch: () => void;
  onAccepted: (task: Todo) => void | Promise<void>;
  onReconcileTasks: () => void | Promise<void>;
  onOpenTask: (taskId: string) => void;
}

export function InboxScreen({
  user,
  refreshRef,
  onAvatarClick,
  onSearch,
  onAccepted,
  onReconcileTasks,
  onOpenTask,
}: Props) {
  return (
    <div className="m-screen m-screen--inbox">
      <MobileHeader
        title="Inbox"
        user={user}
        onAvatarClick={onAvatarClick}
        onSearch={onSearch}
      />
      <div className="m-custom__content">
        <InboxReview
          draftOwnerId={user?.id}
          refreshRef={refreshRef}
          onAccepted={onAccepted}
          onReconcileTasks={onReconcileTasks}
          onOpenTask={onOpenTask}
        />
      </div>
    </div>
  );
}
