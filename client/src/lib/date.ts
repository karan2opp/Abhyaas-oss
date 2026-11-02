export function formatDate(date: Date | string | number): string {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(date: Date | string | number): string {
  const datePart = formatDate(date);
  const timePart = new Date(date)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
  return `${datePart}, ${timePart}`;
}
