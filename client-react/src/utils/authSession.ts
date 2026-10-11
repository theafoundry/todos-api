export interface AuthSession {
  token: string | null;
  refreshToken: string | null;
  generation: number;
}

let generation = 0;
let current: AuthSession | undefined;

/** Track a logical login in memory; token refresh stays within that login. */
export function getAuthSession(): AuthSession {
  const token = localStorage.getItem("authToken");
  const refreshToken = localStorage.getItem("refreshToken");
  if (
    !current ||
    current.token !== token ||
    current.refreshToken !== refreshToken
  ) {
    current = { token, refreshToken, generation: ++generation };
  }
  return current;
}

export function isCurrentAuthSession(session: AuthSession): boolean {
  return session.generation === getAuthSession().generation;
}

export function invalidateAuthSession(): void {
  generation += 1;
  current = undefined;
}

export function rotateAuthSession(
  session: AuthSession,
  token: string,
  refreshToken: string,
): AuthSession {
  localStorage.setItem("authToken", token);
  localStorage.setItem("refreshToken", refreshToken);
  current = { token, refreshToken, generation: session.generation };
  return current;
}
