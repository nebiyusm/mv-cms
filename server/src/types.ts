import { z } from "zod";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const bookingSourceSchema = z.enum([
  "direct",
  "booking_com",
  "hostelworld",
  "walk_in",
  "phone",
]);

export const createBookingBodySchema = z
  .object({
    propertyCode: z.enum(["ADD", "NBO"]),
    roomType: z.enum(["dorm", "private"]),
    checkIn: z
      .string()
      .regex(DATE_RE, "checkIn must be YYYY-MM-DD")
      .refine((d) => !Number.isNaN(Date.parse(d)), "checkIn is not a valid date"),
    checkOut: z
      .string()
      .regex(DATE_RE, "checkOut must be YYYY-MM-DD")
      .refine((d) => !Number.isNaN(Date.parse(d)), "checkOut is not a valid date"),
    guest: z.object({
      fullName: z.string().trim().min(1, "fullName is required"),
      email: z.string().email().optional(),
      phone: z.string().trim().min(1).optional(),
    }),
    source: bookingSourceSchema.default("direct"),
  })
  .superRefine((data, ctx) => {
    if (data.checkOut <= data.checkIn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkOut"],
        message: "checkOut must be after checkIn",
      });
    }
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (data.checkIn < todayUtc) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkIn"],
        message: "checkIn cannot be in the past (UTC date)",
      });
    }
  });

export type CreateBookingBody = z.infer<typeof createBookingBodySchema>;

export interface BookingCreatedResponse {
  bookingId: string;
  bedId: string;
  bedLabel: string;
  roomName: string;
  propertyCode: "ADD" | "NBO";
  stay: { checkIn: string; checkOut: string };
}

export interface NoAvailabilityResponse {
  error: "no_availability";
  propertyCode: string;
  roomType: string;
  stay: { checkIn: string; checkOut: string };
}

export interface ConflictResponse {
  error: "conflict";
  bedId?: string;
}

export interface ValidationErrorResponse {
  error: "validation_error";
  issues: { path: string; message: string }[];
}

const dateField = (name: string) =>
  z
    .string()
    .regex(DATE_RE, `${name} must be YYYY-MM-DD`)
    .refine((d) => !Number.isNaN(Date.parse(d)), `${name} is not a valid date`);

export const availabilityQuerySchema = z
  .object({
    propertyCode: z.enum(["ADD", "NBO"]),
    checkIn: dateField("checkIn"),
    checkOut: dateField("checkOut"),
  })
  .superRefine((data, ctx) => {
    if (data.checkOut <= data.checkIn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkOut"],
        message: "checkOut must be after checkIn",
      });
    }
  });

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export interface AvailableBed {
  bedId: string;
  bedLabel: string;
  roomId: string;
  roomName: string;
  roomType: string;
}

export interface AvailabilityResponse {
  beds: AvailableBed[];
}

export const guestInputSchema = z.object({
  fullName: z.string().trim().min(1, "fullName is required"),
  email: z.string().email().optional(),
  phone: z.string().trim().min(1).optional(),
});

export const groupBookingBodySchema = z
  .object({
    propertyCode: z.enum(["ADD", "NBO"]),
    checkIn: dateField("checkIn"),
    checkOut: dateField("checkOut"),
    source: bookingSourceSchema.default("walk_in"),
    entries: z
      .array(
        z.object({
          guest: guestInputSchema,
          bedId: z.string().uuid("bedId must be a UUID"),
        }),
      )
      .min(1, "at least one entry is required"),
  })
  .superRefine((data, ctx) => {
    if (data.checkOut <= data.checkIn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkOut"],
        message: "checkOut must be after checkIn",
      });
    }
    const seen = new Set<string>();
    data.entries.forEach((entry, index) => {
      if (seen.has(entry.bedId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "bedId"],
          message: "each entry must use a distinct bed",
        });
      }
      seen.add(entry.bedId);
    });
  });

export type GroupBookingBody = z.infer<typeof groupBookingBodySchema>;

export interface GroupBookingCreatedResponse {
  bookingIds: string[];
  count: number;
}

/* ------------------------------- kiosk flow ------------------------------ */

export const kioskLookupBodySchema = z.object({
  query: z.string().trim().min(2, "query must be at least 2 characters"),
});

export type KioskLookupBody = z.infer<typeof kioskLookupBodySchema>;

export interface KioskLookupMatch {
  bookingId: string;
  /** First 8 chars of the booking uuid — the guest-facing reference */
  reference: string;
  guestName: string;
  roomName: string;
  bedLabel: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  propertyName: string;
}

export interface KioskLookupResponse {
  results: KioskLookupMatch[];
}

/** ~4 MB binary -> ~5.6 MB base64; cap the whole data URL a bit above that. */
const IMAGE_DATA_URL_MAX = 5_700_000;

const dataUrl = (mime: string) =>
  z
    .string()
    .max(IMAGE_DATA_URL_MAX, "image exceeds the 4MB limit")
    .regex(
      new RegExp(`^data:${mime};base64,[A-Za-z0-9+/=]+$`),
      `must be a base64 data URL of type ${mime}`,
    );

export const kioskCheckinBodySchema = z.object({
  bookingId: z.string().uuid("bookingId must be a UUID"),
  idPhoto: z.union([dataUrl("image/jpeg"), dataUrl("image/png")]),
  signature: dataUrl("image/png"),
});

export type KioskCheckinBody = z.infer<typeof kioskCheckinBodySchema>;

export interface KioskCheckinResponse {
  bookingId: string;
  reference: string;
  guestName: string;
  roomName: string;
  bedLabel: string;
  roomType: string;
  propertyName: string;
}

export type KioskCheckinErrorCode =
  | "not_found"
  | "already_checked_in"
  | "not_due"
  | "booking_not_active";

export interface KioskCheckinErrorResponse {
  error: KioskCheckinErrorCode;
}

/* ---------------------------- stay extension ----------------------------- */

export interface KioskExtendQuoteMatch {
  bookingId: string;
  reference: string;
  guestName: string;
  roomName: string;
  bedLabel: string;
  /** YYYY-MM-DD — the booking's current stay upper bound */
  currentCheckOut: string;
  nightlyRate: number;
  currency: "USD";
  /** Consecutive free nights on this bed after currentCheckOut (capped at 14) */
  maxNights: number;
}

export interface KioskExtendQuoteResponse {
  results: KioskExtendQuoteMatch[];
}

export const kioskExtendCheckoutBodySchema = z.object({
  bookingId: z.string().uuid("bookingId must be a UUID"),
  nights: z.number().int().min(1).max(14),
});

export type KioskExtendCheckoutBody = z.infer<typeof kioskExtendCheckoutBodySchema>;

export interface KioskExtendCheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
  /** Total in major units (dollars) */
  amount: number;
  currency: "USD";
}

export type KioskExtendErrorCode =
  | "not_found"
  | "not_in_house"
  | "bed_unavailable"
  | "nights_exceeded"
  | "stripe_unavailable";

export interface KioskExtendErrorResponse {
  error: KioskExtendErrorCode;
}

export interface KioskExtendStatusResponse {
  status: "paid" | "pending";
}

/* ------------------------------ housekeeping ----------------------------- */

export const housekeepingStatusSchema = z.enum(["clean", "dirty", "out_of_order"]);

export type HousekeepingStatus = z.infer<typeof housekeepingStatusSchema>;

export const patchHousekeepingBodySchema = z.object({
  housekeepingStatus: housekeepingStatusSchema,
});

export interface HousekeepingBed {
  bedId: string;
  bedLabel: string;
  roomId: string;
  roomName: string;
  roomType: string;
  /** Operational status: 'active' | 'maintenance' */
  status: string;
  housekeepingStatus: HousekeepingStatus;
  /** An active booking's stay covers today */
  occupied: boolean;
}

export interface HousekeepingBedsResponse {
  beds: HousekeepingBed[];
}

/* --------------------------------- folios -------------------------------- */

export const addFolioChargeBodySchema = z.object({
  description: z.string().trim().min(1, "description is required").max(120),
  amount: z.number().positive("amount must be positive").max(10_000),
});

export type AddFolioChargeBody = z.infer<typeof addFolioChargeBodySchema>;

export type FolioLineItemType = "room" | "extension" | "pos" | "payment";

export interface FolioLineItem {
  id: string;
  type: FolioLineItemType;
  description: string;
  amount: number;
  createdAt: string;
  externalRef: string | null;
}

export interface FolioSummary {
  folioId: string;
  bookingId: string | null;
  /** First 8 chars of the booking uuid */
  reference: string | null;
  guestName: string;
  status: "open" | "closed";
  currency: string;
  charges: number;
  payments: number;
  balance: number;
}

export interface FolioListResponse {
  folios: FolioSummary[];
}

export interface FolioDetailResponse extends FolioSummary {
  items: FolioLineItem[];
}

export type FolioErrorCode = "not_found" | "folio_closed" | "nothing_to_pay" | "stripe_unavailable";

export interface FolioErrorResponse {
  error: FolioErrorCode;
}

export interface FolioCheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
  amount: number;
}

/* --------------------------------- admin --------------------------------- */

export const adminStatsQuerySchema = z
  .object({
    propertyCode: z.enum(["ADD", "NBO"]),
    from: dateField("from"),
    to: dateField("to"),
  })
  .superRefine((data, ctx) => {
    if (data.to <= data.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "to must be after from",
      });
    } else {
      const days =
        (Date.parse(`${data.to}T00:00:00Z`) - Date.parse(`${data.from}T00:00:00Z`)) / 86_400_000;
      if (days > 92) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["to"],
          message: "range must be at most 92 days",
        });
      }
    }
  });

export interface AdminDailyStats {
  date: string;
  occupiedBedNights: number;
  availableBedNights: number;
  occupancyPct: number;
  revenue: number;
  adr: number;
  revpar: number;
}

export interface AdminTotals {
  occupancyPct: number;
  adr: number;
  revpar: number;
  revenue: number;
  occupiedBedNights: number;
  availableBedNights: number;
}

export interface AdminChannelStats {
  source: string;
  bookings: number;
  revenue: number;
}

export interface AdminTodayStats {
  occupancyPct: number;
  arrivals: number;
  inHouse: number;
  checkoutsToday: number;
}

export interface AdminStatsResponse {
  daily: AdminDailyStats[];
  totals: AdminTotals;
  channels: AdminChannelStats[];
  today: AdminTodayStats;
}
