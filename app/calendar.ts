export type CalendarShift = {
  date: string;
  start: string;
  end: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateString(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isTimeString(value: string) {
  return TIME_PATTERN.test(value);
}

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function shiftEndDate(shift: CalendarShift) {
  return timeToMinutes(shift.end) < timeToMinutes(shift.start) ? addDays(shift.date, 1) : shift.date;
}

export function shiftDurationHours(shift: CalendarShift) {
  const start = timeToMinutes(shift.start);
  const end = timeToMinutes(shift.end);
  return ((end < start ? end + 24 * 60 : end) - start) / 60;
}

export function calendarTimestamp(date: string, time: string) {
  return `${date}T${time}:00`;
}

export function shiftStartTimestamp(shift: CalendarShift) {
  return calendarTimestamp(shift.date, shift.start);
}

export function shiftEndTimestamp(shift: CalendarShift) {
  return calendarTimestamp(shiftEndDate(shift), shift.end);
}

export function compactIcsTimestamp(date: string, time: string) {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}
