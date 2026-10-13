// Terminal-safe text. GitHub-provided strings (titles, bodies, names) may carry
// escape sequences that a terminal would act on; they are cleaned where the
// answers are normalized, before any of them reaches the UI. Pure.

const OSC = /\u001b\][^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)?/g
const CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]?/g
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/** Removes escape sequences and every control character but newline and tab (C0, DEL and C1). */
export function cleanText(text: string): string {
  return text.replace(OSC, '').replace(CSI, '').replace(CONTROLS, '')
}

/** A string value, cleaned; null for anything that is not a string. */
export function cleanStr(value: unknown): string | null {
  return typeof value === 'string' ? cleanText(value) : null
}

/** GitHub's allowed owner characters: letters, digits and hyphen. */
export const OWNER_PATTERN = /^[A-Za-z0-9-]+$/
/** GitHub's allowed repository characters: letters, digits, dot, underscore and hyphen; never `.` or `..`. */
export const REPO_PATTERN = /^(?![.]+$)[A-Za-z0-9._-]+$/
/** An `owner/name` slug made of an allowed owner and an allowed repository name. */
export const SLUG_PATTERN = /^[A-Za-z0-9-]+\/(?![.]+$)[A-Za-z0-9._-]+$/
