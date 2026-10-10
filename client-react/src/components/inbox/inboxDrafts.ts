export interface CaptureDraft {
  text: string;
  attempt: { text: string; key: string } | null;
  saving: boolean;
  needsCheck: boolean;
  error: string;
}

export interface TitleDraft {
  title: string;
  editing: boolean;
}

export interface InboxDraftState {
  capture: CaptureDraft;
  pendingIds: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  /** Bumped when a save or review settles after the Inbox that started it unmounted. */
  settledElsewhere: number;
}

/** Unsaved and in-flight Inbox state that must outlive a desktop/mobile shell swap. */
export class InboxDrafts {
  private state: InboxDraftState = {
    capture: {
      text: "",
      attempt: null,
      saving: false,
      needsCheck: false,
      error: "",
    },
    pendingIds: new Set(),
    errors: {},
    settledElsewhere: 0,
  };
  private listeners = new Set<() => void>();
  readonly titles = new Map<string, TitleDraft>();
  /** Confirmed reviews by sequence, so reads started earlier cannot resurrect them. */
  readonly removedIds = new Map<string, number>();
  reviewSequence = 0;

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(patch: Partial<InboxDraftState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  updateCapture(patch: Partial<CaptureDraft>) {
    this.update({ capture: { ...this.state.capture, ...patch } });
  }

  setPending(id: string, pending: boolean) {
    const pendingIds = new Set(this.state.pendingIds);
    if (pending) pendingIds.add(id);
    else pendingIds.delete(id);
    this.update({ pendingIds });
  }

  setError(id: string, error: string) {
    this.update({ errors: { ...this.state.errors, [id]: error } });
  }

  markSettledElsewhere() {
    this.update({ settledElsewhere: this.state.settledElsewhere + 1 });
  }
}

// Memory only: capture text is never written to browser storage, and only one
// account's drafts are held at a time.
let shared: { ownerId: string; drafts: InboxDrafts } | null = null;

export function inboxDraftsFor(ownerId: string): InboxDrafts {
  if (shared?.ownerId !== ownerId)
    shared = { ownerId, drafts: new InboxDrafts() };
  return shared.drafts;
}

/** True while these drafts still belong to the signed-in account. */
export function ownsInboxDrafts(drafts: InboxDrafts): boolean {
  return shared?.drafts === drafts;
}

/** Release drafts held for any account other than the signed-in one. */
export function keepInboxDraftsFor(ownerId: string | null) {
  if (shared?.ownerId !== ownerId) shared = null;
}
