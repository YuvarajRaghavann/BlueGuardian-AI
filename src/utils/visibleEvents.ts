export function visibleEvents<T extends object>(
  events: T[],
  showSimulated: boolean,
): T[] {
  return showSimulated
    ? events
    : events.filter(event => !('simulated' in event && event.simulated === true));
}
