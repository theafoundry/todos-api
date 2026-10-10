import { ViewActivityProvider } from "../layout/ViewActivityContext";
import { ViewHeader } from "../layout/ViewHeader";
import { InboxReview, type InboxReviewProps } from "./InboxReview";

interface DesktopInboxProps extends InboxReviewProps {
  userId?: string;
  isActive: boolean;
}

/** Keep drafts in this account's mounted Inbox while other sections are open. */
export function DesktopInbox({
  userId,
  isActive,
  ...reviewProps
}: DesktopInboxProps) {
  return (
    <div
      className="view-router__slot"
      data-view-key="inbox"
      data-active={isActive ? "true" : "false"}
      hidden={!isActive}
      style={{ display: isActive ? undefined : "none" }}
    >
      <ViewActivityProvider isActive={isActive}>
        <ViewHeader
          title="Inbox"
          subtitle="Capture now. Review when you’re ready."
        />
        <div className="app-content">
          <InboxReview key={userId} draftOwnerId={userId} {...reviewProps} />
        </div>
      </ViewActivityProvider>
    </div>
  );
}
