import { describe, expect, it } from 'vitest';
import { visibleEvents } from './visibleEvents';

describe('visibleEvents', () => {
  const events = [
    { id: 'real', simulated: false },
    { id: 'demo', simulated: true },
  ];

  it('includes real and simulated events when enabled', () => {
    expect(visibleEvents(events, true)).toEqual(events);
  });

  it('hides simulated events when disabled', () => {
    expect(visibleEvents(events, false)).toEqual([{ id: 'real', simulated: false }]);
  });

  it('preserves events without legacy simulation metadata', () => {
    const legacyEvents = [{ id: 'legacy-event' }];
    expect(visibleEvents(legacyEvents, false)).toEqual(legacyEvents);
  });
});
