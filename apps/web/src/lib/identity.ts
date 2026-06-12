/** Anonymous, persistent per-browser identity (no accounts). */

const PID_KEY = 'ek_pid';
const NAME_KEY = 'ek_name';

export function getPlayerId(): string {
  let pid = localStorage.getItem(PID_KEY);
  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem(PID_KEY, pid);
  }
  return pid;
}

export function getName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

/** Normalize a name the same way the server does (trim + 20-char cap). */
export function normalizeName(name: string): string {
  return name.trim().slice(0, 20);
}

export function setName(name: string): void {
  localStorage.setItem(NAME_KEY, normalizeName(name));
}

/** Per-room seat token, used to authenticate reconnects to the same seat. */
export function getRoomToken(code: string): string {
  return localStorage.getItem(`ek_token_${code.toUpperCase()}`) ?? '';
}

export function setRoomToken(code: string, token: string): void {
  localStorage.setItem(`ek_token_${code.toUpperCase()}`, token);
}
