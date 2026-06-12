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

export function setName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 20));
}
