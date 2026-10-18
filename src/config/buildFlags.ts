/**
 * Release-build switches.
 *
 * Sample/simulated devices and demo events are compiled out of release builds so
 * that fake threats can never be mistaken for real scan results. Set
 * VITE_ENABLE_SIMULATOR=true when building a demo APK on purpose.
 */
export const SIMULATOR_ENABLED: boolean =
  import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_SIMULATOR === 'true';
