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
}

export interface ValidationErrorResponse {
  error: "validation_error";
  issues: { path: string; message: string }[];
}
