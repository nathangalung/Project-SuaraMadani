import { m } from "~/paraglide/messages.js"
import type { NavItem } from "./header"

/** Main menu, order is fixed. */
export function mainNav(): NavItem[] {
  return [
    { to: "/", label: m.nav_home() },
    { to: "/lapor", label: m.nav_report() },
    { to: "/isu", label: m.nav_issues(), also: ["/tuntutan"] },
    { to: "/data", label: m.nav_data() },
    { to: "/tentang", label: m.nav_about() },
  ]
}

// Home is the logo
export function footerNav(): NavItem[] {
  return [...mainNav().slice(1), { to: "/lacak", label: m.nav_track() }]
}

/** Kelola sections, labels match H1. */
export function manageNav(): NavItem[] {
  return [
    { to: "/kelola", label: m.manage_home_title(), end: true },
    { to: "/kelola/antrean", label: m.manage_queue_title() },
    { to: "/kelola/isu", label: m.manage_issues_title() },
    { to: "/kelola/tuntutan", label: m.manage_demands_title() },
    { to: "/kelola/audit", label: m.manage_audit_title() },
    { to: "/kelola/anggota", label: m.team_title() },
    { to: "/kelola/pengaturan", label: m.settings_nav() },
  ]
}

/** Footer legal row links. */
export function policyNav(): NavItem[] {
  return [
    { to: "/privasi", label: m.footer_privacy() },
    { to: "/pedoman", label: m.footer_guidelines() },
    { to: "/aksesibilitas", label: m.footer_accessibility() },
  ]
}

/** Apex: no reporting, no account. */
export function nationalNav(): NavItem[] {
  return [
    { to: "/", label: m.nav_home() },
    { to: "/tentang", label: m.nav_about() },
  ]
}
