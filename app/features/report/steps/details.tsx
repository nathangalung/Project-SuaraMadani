import { useState } from "react"
import { DateInput } from "~/components/ui/date-input"
import { Textarea, TextInput } from "~/components/ui/field"
import { Select } from "~/components/ui/select"
import { m } from "~/paraglide/messages.js"
import { AGENCY_SUGGESTIONS } from "../../../../shared/agencies.ts"
import {
  CATEGORIES,
  CATEGORY_IDS,
  isCategoryId,
  type SubcategoryGroup,
  URGENCIES,
} from "../../../../shared/categories.ts"
import { latestIsoDate } from "../../../../shared/format.ts"
import {
  AGENCY_MAX_LENGTH,
  OCCURRED_ON_MIN_YEAR,
  STORY_LENGTH,
  TITLE_LENGTH,
} from "../../../../shared/report-fields.ts"
import { choicesFrom, RadioGroup } from "../choices"
import {
  browserStorage,
  type DetailsAnswer,
  type Draft,
  saveStep,
} from "../draft"
import { EmergencyNotice } from "../emergency"
import { CATEGORY_HINT_TEXT, SUBGROUP_TEXT, URGENCY_TEXT } from "../labels"
import { NearbyIssues } from "../nearby-issues"
import { CATEGORY_TEXT, SUBCATEGORY_TEXT } from "../public-labels"
import { errorText, formText, StepPage, useStepNav } from "../step-page"
import { OCCURRED_ON_FIELD, type StepError, validateDetails } from "../validate"

function SubcategoryOptions({ categoryId }: { categoryId: string }) {
  const category = CATEGORIES.find((c) => c.id === categoryId)
  if (!category) return null
  const groups = new Map<
    SubcategoryGroup | undefined,
    typeof category.subcategories
  >()
  for (const sub of category.subcategories) {
    groups.set(sub.group, [...(groups.get(sub.group) ?? []), sub])
  }
  return [...groups].map(([group, subs]) => {
    const options = subs.map((sub) => (
      <option key={sub.id} value={sub.id}>
        {SUBCATEGORY_TEXT[sub.id]()}
      </option>
    ))
    return group ? (
      <optgroup key={group} label={SUBGROUP_TEXT[group]()}>
        {options}
      </optgroup>
    ) : (
      options
    )
  })
}

export function DetailsStep({ draft }: { draft: Draft }) {
  const { next } = useStepNav("details")
  const saved = draft.details ?? {}
  const [errors, setErrors] = useState<StepError[]>([])
  const [categoryId, setCategoryId] = useState(saved.categoryId ?? "")
  const [subcategoryId, setSubcategoryId] = useState(saved.subcategoryId ?? "")
  const [urgency, setUrgency] = useState(saved.urgency)
  const [titleLength, setTitleLength] = useState(saved.title?.length ?? 0)
  const today = latestIsoDate(new Date())

  const onContinue = (form: HTMLFormElement) => {
    const data = new FormData(form)
    const answer: DetailsAnswer = {
      title: formText(data, "title"),
      story: formText(data, "story"),
      categoryId: categoryId || undefined,
      subcategoryId: subcategoryId || undefined,
      occurredOn: formText(data, "occurredOn"),
      agency: formText(data, "agency"),
      urgency,
    }
    const found = validateDetails(answer, today)
    setErrors(found)
    if (found.length > 0) return
    saveStep(browserStorage(), draft, "details", answer)
    next()
  }

  return (
    <StepPage
      step="details"
      title={m.step_details_title()}
      errors={errors}
      onContinue={onContinue}
    >
      <TextInput
        id="title"
        name="title"
        label={m.details_title_label()}
        hint={m.details_title_hint(TITLE_LENGTH)}
        error={errorText(errors, "title")}
        defaultValue={saved.title}
        onInput={(event) => setTitleLength(event.currentTarget.value.length)}
        aside={
          // Hint states limits, visual only
          <span
            aria-hidden="true"
            className={`font-ui text-xs tabular-nums ${titleLength > TITLE_LENGTH.max ? "font-semibold text-danger" : "text-ink-muted"}`}
          >
            {titleLength}/{TITLE_LENGTH.max}
          </span>
        }
        requiredMark
      />
      <Textarea
        id="story"
        name="story"
        label={m.details_story_label()}
        hint={m.details_story_hint(STORY_LENGTH)}
        error={errorText(errors, "story")}
        defaultValue={saved.story}
        rows={6}
        requiredMark
      />
      <div>
        <RadioGroup
          name="categoryId"
          legend={m.details_category_label()}
          error={errorText(errors, "categoryId")}
          requiredMark
          options={choicesFrom(CATEGORY_IDS, CATEGORY_TEXT, CATEGORY_HINT_TEXT)}
          optionsClassName="grid gap-3"
          value={categoryId}
          onChange={(value) => {
            setCategoryId(value)
            setSubcategoryId("")
          }}
        />
        <EmergencyNotice show={categoryId === "bencana"} />
      </div>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Select
          id="subcategoryId"
          name="subcategoryId"
          label={m.details_subcategory_label()}
          error={errorText(errors, "subcategoryId")}
          value={subcategoryId}
          disabled={!isCategoryId(categoryId)}
          onChange={(event) => setSubcategoryId(event.currentTarget.value)}
          requiredMark
        >
          <option value="">
            {isCategoryId(categoryId)
              ? m.location_choose()
              : m.details_choose_category_first()}
          </option>
          <SubcategoryOptions categoryId={categoryId} />
        </Select>
        <DateInput
          id={OCCURRED_ON_FIELD}
          name="occurredOn"
          label={m.details_occurred_legend()}
          error={errorText(errors, OCCURRED_ON_FIELD)}
          min={`${OCCURRED_ON_MIN_YEAR}-01-01`}
          max={today}
          defaultValue={saved.occurredOn}
          requiredMark
        />
      </div>
      <TextInput
        id="agency"
        name="agency"
        label={m.details_agency_label()}
        hint={m.details_agency_hint({ max: AGENCY_MAX_LENGTH })}
        error={errorText(errors, "agency")}
        defaultValue={saved.agency}
        list="agency-options"
        optional
      />
      <datalist id="agency-options">
        {AGENCY_SUGGESTIONS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div>
        <RadioGroup
          name="urgency"
          legend={m.details_urgency_legend()}
          hint={m.details_urgency_hint()}
          error={errorText(errors, "urgency")}
          requiredMark
          options={choicesFrom(URGENCIES, URGENCY_TEXT)}
          optionsClassName="grid gap-y-1 sm:flex sm:flex-wrap sm:gap-x-6"
          inline
          value={urgency}
          onChange={setUrgency}
        />
        {/* Category banner already shown */}
        <EmergencyNotice
          show={urgency === "emergency" && categoryId !== "bencana"}
        />
      </div>
      {/* Loads late: never above fields */}
      <NearbyIssues regencyCode={draft.location?.regencyCode} />
    </StepPage>
  )
}
