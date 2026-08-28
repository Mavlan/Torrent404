export function isMagnetInput(value: string): boolean {
  return value.trim().toLowerCase().startsWith("magnet:");
}
