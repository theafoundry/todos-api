/** Remove the obsolete account-independent cache; briefs stay in component memory. */
export function clearPersistedFocusBrief(): void {
  try {
    localStorage.removeItem("todos:focus-brief-cache");
  } catch {
    // Disabled browser storage must not block authentication or the current view.
  }
}
