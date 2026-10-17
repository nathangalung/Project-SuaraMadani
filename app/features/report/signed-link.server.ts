import { writeLog } from "../../../server/log.ts"
import {
  type LinkPurpose,
  linkKeyring,
  verifyLink,
} from "../../../server/signed-link.ts"

/** Null unless valid and configured. */
export function readLink(
  token: string,
  purpose: LinkPurpose,
  orgId: string,
): { subjectId: string; userId: string } | null {
  if (!token) return null
  try {
    return verifyLink(linkKeyring(), token, {
      purpose,
      orgId,
      now: new Date(),
    })
  } catch (error) {
    // Missing keyring: links fail closed
    writeLog({
      msg: "signed link check failed",
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
