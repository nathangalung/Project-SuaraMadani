import { errorRecord, writeError } from "../../../server/log.ts"
import {
  type Keyring,
  type LinkPurpose,
  linkKeyring,
  verifyLink,
} from "../../../server/signed-link.ts"

/** Null unless valid and configured. */
export function readLink(
  token: string,
  purpose: LinkPurpose,
  orgId: string,
  keyring: () => Keyring = linkKeyring,
): { subjectId: string; userId: string } | null {
  if (!token) return null
  try {
    return verifyLink(keyring(), token, {
      purpose,
      orgId,
      now: new Date(),
    })
  } catch (error) {
    // Missing keyring: links fail closed
    writeError({ msg: "signed link check failed", ...errorRecord(error) })
    return null
  }
}
