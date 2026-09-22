/** Junta classes condicionais sem trazer uma dependencia para isso. */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
