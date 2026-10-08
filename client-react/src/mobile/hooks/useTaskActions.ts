import { useCallback, useRef, useState } from "react";
import { TodoApiError } from "../../api/todos";

export interface TaskFeedback {
  kind: "pending" | "success" | "error";
  message: string;
  action?: { label: string; run: () => void };
}

/** UI command ownership is separate from the store's per-task write queue. */
export function useTaskActions(reconcile?: () => Promise<boolean>) {
  const inFlight = useRef(new Set<string>());
  const reconciling = useRef(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<TaskFeedback | null>(null);

  const run = useCallback(
    async (
      id: string,
      command: () => Promise<unknown>,
      message: string,
      action?: TaskFeedback["action"],
    ): Promise<boolean> => {
      if (inFlight.current.has(id)) return false;
      inFlight.current.add(id);
      setPendingIds(new Set(inFlight.current));
      setFeedback({ kind: "pending", message: "Saving task…" });
      try {
        await command();
        setFeedback({ kind: "success", message, action });
        return true;
      } catch (error) {
        const uncertain =
          error instanceof TodoApiError && error.requiresReconciliation;
        setFeedback({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "The change could not be saved.",
          action: uncertain
            ? reconcile
              ? {
                  label: "Refresh",
                  run: () => {
                    if (reconciling.current) return;
                    reconciling.current = true;
                    const failed = () => {
                      setFeedback((current) =>
                        current?.kind === "error"
                          ? {
                              ...current,
                              message:
                                "Could not refresh tasks. Try Refresh again.",
                            }
                          : current,
                      );
                    };
                    void reconcile()
                      .then((applied) => {
                        if (applied)
                          setFeedback({
                            kind: "success",
                            message:
                              "Refreshed tasks. Check the change before trying again.",
                          });
                        else failed();
                      })
                      .catch(failed)
                      .finally(() => {
                        reconciling.current = false;
                      });
                  },
                }
              : undefined
            : {
                label: "Retry",
                run: () => {
                  void run(id, command, message, action);
                },
              },
        });
        return false;
      } finally {
        inFlight.current.delete(id);
        setPendingIds(new Set(inFlight.current));
      }
    },
    [reconcile],
  );

  return { pendingIds, feedback, setFeedback, run };
}
