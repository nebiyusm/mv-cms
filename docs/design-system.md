# Mad Vervet PMS — Design System Reference

Extracted from the Hostelmate demo (Dashboard, Calendar, Guests views). This is the visual spec every UI-building KERNEL prompt should point to, so "match the design" is one enforceable reference instead of a vague instruction repeated differently in every prompt.

---

## 1. Color Tokens

| Token | Value (Tailwind equivalent) | Used for |
|---|---|---|
| `primary` | `blue-600` (#2563EB) | Active nav link, primary buttons ("Update", "Add Guest"), progress bars, today's date column |
| `primary-hover` | `blue-700` | Button hover state |
| `bg-page` | `slate-50` (#F8FAFC) | Page background behind cards |
| `bg-card` | `white` | Card, table, nav backgrounds |
| `border` | `gray-200` | Card borders, table row dividers |
| `text-primary` | `gray-900` | Headings, guest names, key numbers |
| `text-secondary` | `gray-500` | Subtitles, table body text |
| `text-label` | `gray-400`/`gray-500`, uppercase, tracked | Stat-card labels ("TODAY", "RATE", "OCCUPANCY"), table column headers |
| `success` | `emerald-500` | Availability dot, confirmed-status accents |
| `blocked` | `gray-400` bg + diagonal-hatch pattern | Blocked calendar cells |
| `danger` | `red-500`/`red-600` | Logout link, destructive actions |

**Booking-source badges** — each OTA/channel gets its own small colored icon badge shown inline before the guest name (on the calendar pills and the dashboard activity table): distinct hue per source (e.g. Airbnb, Booking.com, Agoda, Expedia, Hostelworld, direct/walk-in). Keep a fixed color-to-source mapping in one constants file so it's consistent everywhere it appears.

## 2. Typography

- System sans-serif stack (Inter or equivalent).
- Page title: bold, ~20–24px, `text-primary`.
- Page subtitle (directly under the title): regular, ~14px, `text-secondary`.
- Stat-card big numbers (e.g. "17", "9 / 9"): bold, ~32–40px.
- Section/column labels: uppercase, letter-spacing wide, ~11–12px, `text-label`. This is used consistently for stat-card headers and table column headers — treat it as one reusable style, not a one-off.

## 3. Layout Patterns

**Top navigation bar** (present on every page)
- White background, bottom border.
- Left: logo mark + wordmark, small tagline underneath.
- Next: property selector dropdown, currency selector dropdown.
- Right: page nav links (active link in `primary` color, inactive in `text-primary`/gray).
- Far right: overflow hamburger menu → dropdown listing secondary sections (Chat, Reports, Pricing, Channel Manager, Finance, etc.) plus language selector and logout.

**Page header pattern** (repeats on every page — build once, reuse)
- Left: a circular light-blue icon badge, then the page title, then the gray subtitle beneath it.
- Right: a contextual control — a date picker on Dashboard/Calendar, a search bar + primary button on Guests.

**Stat card row** (Dashboard)
- 2–3 equal-width white rounded cards in a horizontal row, light border, generous padding.
- Each card: uppercase label top-left, then either a big number, a short list (e.g. rates with a status dot), or a number + horizontal progress bar + two sub-stats below it.

**Segmented counter row** (Dashboard "Activity")
- A horizontal row of count blocks (number + label), the active/selected one highlighted with a light-blue background and a blue underline — functions like a tab bar but shows a count per tab.

**Data table**
- Uppercase gray column headers, no vertical borders, light horizontal row dividers, generous row height.
- Name cells are clickable blue text, often paired with a small contact icon (e.g. WhatsApp).
- Cells that combine an icon + label (platform, room/bed) stack the icon before the text.
- Row-level actions live in a right-aligned column: a dropdown (e.g. status) next to a solid `primary`-colored button with white text and rounded corners.

**Calendar / timeline grid** (the bed-level view — the most distinctive piece)
- First column is sticky and groups rows by room type (bold group header row), with lettered sub-rows underneath for each bed (A, B, C…).
- Date columns run left to right: two-line header (day abbreviation + date number), today's column highlighted in `primary` color.
- A booking is a horizontal colored pill spanning its date range, showing the source badge + guest name; consecutive bookings in the same row are separated by a small dot.
- A blocked date range renders as a gray cell with a lock icon and a diagonal hatch/stripe texture — visually distinct from an occupied (colored pill) cell at a glance.
- "Today" jump button + date picker sit top-right, same position as the Dashboard's date control.

**Buttons, inputs, badges**
- Rounded corners throughout (~6–8px radius) — buttons, dropdowns, cards, pills.
- Primary button: solid `primary` fill, white text, medium padding.
- Dropdowns/selects: white background, gray border, chevron icon, rounded.
- Source/platform badges and blocked-cell icons: small circular or square badge, colored background, white icon/letter.

## 4. Component Inventory (build once, reuse everywhere)

| Component | Notes |
|---|---|
| `<TopNav />` | Logo, property/currency selectors, page links, overflow menu |
| `<PageHeader icon title subtitle actions />` | Icon badge + title + subtitle pattern, slot for right-aligned controls |
| `<StatCard />` | Label + big number, or label + list, or label + number + progress bar |
| `<SegmentedCounter items={[{label, count}]} />` | Tab-like row of counts |
| `<DataTable columns rows />` | Generic table with the uppercase-header style |
| `<SourceBadge platform="airbnb\|booking\|agoda\|expedia\|hostelworld\|direct" />` | Fixed color per source |
| `<StatusDropdown />` + `<ActionButton />` | Paired row-action controls |
| `<BookingPill />` | Colored, rounded, spans date range, source badge + name |
| `<BlockedCell />` | Gray, lock icon, diagonal-hatch pattern |

Everything downstream — the front-desk timeline, kiosk, housekeeping view, folio table, and admin dashboard — should be built from this component set rather than each one inventing its own card/table/button styling.
