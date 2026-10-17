/** Item 11, every campus. */
export function globalIntakePause(): boolean {
  return process.env.INTAKE_PAUSED === "true"
}

/** Env switch or campus switch. */
export function intakePaused(
  tenant: { settings: { intakePaused?: boolean } },
  global = globalIntakePause(),
): boolean {
  return global || tenant.settings.intakePaused === true
}
