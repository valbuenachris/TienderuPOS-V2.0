export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
];

export const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function monthGrid(year: number, month: number): { from: string; to: string; days: Date[] } {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - first.getUTCDay());
  const days: Date[] = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    days.push(day);
  }
  return { from: toIsoDate(start), to: toIsoDate(days[41]), days };
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0));
  return { from, to: toIsoDate(last) };
}

export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
