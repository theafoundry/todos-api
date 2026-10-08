import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MobileModal } from "./MobileModal";
import { MutationApiError } from "../../api/mutations";
import {
  localDateTimeToIso,
  localDateTimeValue,
  schedulingPresets,
} from "../utils/taskDates";
import "../date-actions.css";

interface Props {
  open: boolean;
  onClose: () => void;
  onSnooze: (date: string) => Promise<void>;
  onReconcile?: () => Promise<boolean>;
  closeRequestRef?: RefObject<(() => void) | null>;
}

export function SnoozePicker({
  open,
  onClose,
  onSnooze,
  onReconcile,
  closeRequestRef,
}: Props) {
  const [showDateInput, setShowDateInput] = useState(false);
  const [pickedDate, setPickedDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const needsReconciliationRef = useRef(false);
  const submitting = useRef(false);
  const presets = useMemo(() => schedulingPresets(), [open]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dirty = Boolean(pickedDate) || needsReconciliation;

  useEffect(() => {
    if (!open) {
      setShowDateInput(false);
      setPickedDate("");
      setError("");
      setDiscardOpen(false);
      needsReconciliationRef.current = false;
      setNeedsReconciliation(false);
      setRefreshing(false);
      setRefreshed(false);
    }
  }, [open]);

  const requestClose = useCallback(() => {
    if (submitting.current) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!closeRequestRef || !open) return;
    closeRequestRef.current = requestClose;
    return () => {
      if (closeRequestRef.current === requestClose)
        closeRequestRef.current = null;
    };
  }, [closeRequestRef, open, requestClose]);

  const handleOption = async (date: string) => {
    if (submitting.current || discardOpen || needsReconciliationRef.current)
      return;
    submitting.current = true;
    setPickedDate(localDateTimeValue(date));
    setPending(true);
    setError("");
    setRefreshed(false);
    try {
      await onSnooze(date);
      onClose();
    } catch (cause) {
      if (cause instanceof MutationApiError && cause.requiresReconciliation) {
        needsReconciliationRef.current = true;
        setNeedsReconciliation(true);
      }
      setShowDateInput(true);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the planned date. Try again.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const savePickedDate = () => {
    if (submitting.current || needsReconciliationRef.current) return;
    const iso = localDateTimeToIso(pickedDate);
    if (!iso) {
      setError("Choose a valid local date and time.");
      return;
    }
    void handleOption(iso);
  };

  const reconcile = async () => {
    if (
      !onReconcile ||
      submitting.current ||
      discardOpen ||
      !needsReconciliationRef.current
    )
      return;
    submitting.current = true;
    setPending(true);
    setRefreshing(true);
    try {
      if (await onReconcile()) {
        needsReconciliationRef.current = false;
        setNeedsReconciliation(false);
        setError("");
        setRefreshed(true);
      } else {
        setError(
          "Could not refresh this task. Your selected date is still here. Reconnect and try Refresh again.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh this task. Try Refresh again.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
      setRefreshing(false);
    }
  };

  return (
    <MobileModal
      open={open}
      title="Plan for…"
      onClose={requestClose}
      dismissDisabled={pending}
    >
      <div className="m-date-actions">
        {discardOpen && (
          <section
            className="m-mobile-modal__discard"
            role="group"
            aria-label="Discard planned date changes?"
          >
            <p>Discard your unsaved planned date?</p>
            <div className="m-mobile-modal__discard-actions">
              <button type="button" onClick={() => setDiscardOpen(false)}>
                Keep editing
              </button>
              <button type="button" onClick={onClose}>
                Discard changes
              </button>
            </div>
          </section>
        )}
        <p className="m-date-actions__hint">
          Times use this device’s time zone: {timezone}. The deadline stays
          unchanged.
        </p>
        <fieldset
          disabled={pending || discardOpen}
          className="m-date-actions__controls"
        >
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="m-snooze__option"
              disabled={needsReconciliation}
              onClick={() => void handleOption(preset.value)}
            >
              <span className="m-snooze__option-label">{preset.label}</span>
              <span className="m-snooze__option-detail">{preset.detail}</span>
            </button>
          ))}
          <button
            type="button"
            className="m-snooze__option"
            aria-expanded={showDateInput}
            aria-controls="reschedule-date"
            onClick={() => setShowDateInput(!showDateInput)}
          >
            <span className="m-snooze__option-label">Pick a date</span>
            <span className="m-snooze__option-detail">
              Choose a date and time
            </span>
          </button>
          {showDateInput && (
            <div id="reschedule-date" className="m-date-actions__field">
              <label htmlFor="planned-date">Plan for</label>
              <input
                id="planned-date"
                className="m-snooze__date"
                type="datetime-local"
                value={pickedDate}
                aria-describedby={error ? "planned-date-error" : undefined}
                onChange={(event) => {
                  setPickedDate(event.target.value);
                  if (!needsReconciliationRef.current) setError("");
                  setRefreshed(false);
                }}
              />
              <button
                type="button"
                className="m-snooze__confirm"
                disabled={!pickedDate || needsReconciliation}
                onClick={savePickedDate}
              >
                {pending
                  ? "Saving…"
                  : error
                    ? "Retry planned date"
                    : "Save planned date"}
              </button>
            </div>
          )}
        </fieldset>
        {error && (
          <div
            id="planned-date-error"
            className="m-date-actions__error"
            role="alert"
          >
            <p>{error}</p>
            {needsReconciliation && (
              <>
                <p>
                  Your selected date is still here. Refresh this task before
                  trying to save again.
                </p>
                {onReconcile ? (
                  <button
                    type="button"
                    className="m-snooze__confirm"
                    disabled={pending || discardOpen}
                    onClick={() => void reconcile()}
                  >
                    {refreshing ? "Refreshing planned task…" : "Refresh"}
                  </button>
                ) : (
                  <p>
                    Reconnect and refresh the task list to check whether the
                    change was saved.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {refreshed && (
          <p className="m-date-actions__hint" role="status">
            Refreshed task. Review the selected date and save when ready.
          </p>
        )}
        {pending && (
          <p className="m-date-actions__hint" role="status">
            {refreshing ? "Refreshing planned task…" : "Saving planned date…"}
          </p>
        )}
      </div>
    </MobileModal>
  );
}
