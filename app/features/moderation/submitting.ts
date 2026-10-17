import { useNavigation } from "react-router"

type Pending = { state: string; formData?: FormData }

/** Busy only for this intent. */
export function isSubmitting(navigation: Pending, intent?: string): boolean {
  if (navigation.state !== "submitting") return false
  return intent === undefined || navigation.formData?.get("intent") === intent
}

export function useSubmitting(intent?: string): boolean {
  return isSubmitting(useNavigation(), intent)
}
