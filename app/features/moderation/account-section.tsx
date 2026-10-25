import { Form, Link } from "react-router"
import { Button } from "~/components/ui/button"
import { Fact } from "~/components/ui/fact"
import { m } from "~/paraglide/messages.js"
import { formatDate, formatNumber } from "../../../shared/format.ts"
import type { ReporterAccount } from "./contact.server"

const LINK = "font-semibold text-accent underline underline-offset-4"

function AccountFacts({ account }: { account: ReporterAccount }) {
  return (
    <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
      <Fact term={m.manage_contact_name()}>
        {account.name || m.manage_contact_name_none()}
      </Fact>
      <Fact term={m.manage_account_email()}>
        {account.email ? (
          <a href={`mailto:${account.email}`} className={LINK}>
            {account.email}
          </a>
        ) : (
          m.manage_account_email_none()
        )}
      </Fact>
      <Fact term={m.manage_account_phone()}>
        {account.phone ? (
          <>
            <a href={`tel:${account.phone}`} className={LINK}>
              {account.phone}
            </a>
            {account.phoneVerified ? null : (
              <span className="text-ink-muted">
                {" "}
                ({m.manage_account_phone_unverified()})
              </span>
            )}
          </>
        ) : (
          m.manage_account_phone_none()
        )}
      </Fact>
      <Fact term={m.manage_account_joined()}>
        {formatDate(account.joinedAt)}
      </Fact>
      <Fact term={m.manage_account_reports()}>
        {formatNumber(account.reports)}
      </Fact>
    </dl>
  )
}

/** Opened on request, audited. */
export function AccountSection({
  code,
  account,
}: {
  code: string
  // Undefined until asked
  account: ReporterAccount | null | undefined
}) {
  return (
    <section aria-labelledby="report-account" className="mt-12">
      <h2 id="report-account" className="font-bold text-2xl">
        {m.manage_account_title()}
      </h2>
      <p className="mt-2 mb-5 text-ink-soft">{m.manage_account_lead()}</p>
      {account === undefined ? (
        <Form method="post">
          <input type="hidden" name="intent" value="show_account" />
          <Button type="submit" variant="secondary">
            {m.manage_account_show()}
          </Button>
        </Form>
      ) : account === null ? (
        <p>{m.manage_account_missing()}</p>
      ) : (
        <AccountFacts account={account} />
      )}
      <Link
        to={`/kelola/laporan/${code}/tutup-akun`}
        className="mt-6 inline-block font-semibold text-danger underline underline-offset-4"
      >
        {m.manage_account_close_link()}
      </Link>
    </section>
  )
}
