export function nodeRole(position: number | null) {
  if (position === null) return "Not assigned";
  return position === 1 ? "Gateway" : "Sensor node";
}
