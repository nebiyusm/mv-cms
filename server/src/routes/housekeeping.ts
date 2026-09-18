import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z, type ZodError } from "zod";
import {
  patchHousekeepingBodySchema,
  type HousekeepingBed,
  type HousekeepingBedsResponse,
  type ValidationErrorResponse,
} from "../types.js";

function validationError(reply: FastifyReply, error: ZodError) {
  const body: ValidationErrorResponse = {
    error: "validation_error",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
  return reply.status(400).send(body);
}

const bedsQuerySchema = z.object({
  propertyCode: z.enum(["ADD", "NBO"]),
});

interface BedRow {
  bed_id: string;
  bed_label: string;
  room_id: string;
  room_name: string;
  room_type: string;
  status: string;
  housekeeping_status: HousekeepingBed["housekeepingStatus"];
  occupied: boolean;
}

const BED_SELECT = `
  select b.id as bed_id, b.label as bed_label, r.id as room_id,
         r.name as room_name, r.room_type, b.status, b.housekeeping_status,
         exists (
           select 1
             from booking_beds bb
            where bb.bed_id = b.id
              and bb.is_active
              and bb.stay @> current_date
         ) as occupied
    from beds b
    join rooms r on r.id = b.room_id
    join properties p on p.id = r.property_id
`;

function toResponse(row: BedRow): HousekeepingBed {
  return {
    bedId: row.bed_id,
    bedLabel: row.bed_label,
    roomId: row.room_id,
    roomName: row.room_name,
    roomType: row.room_type,
    status: row.status,
    housekeepingStatus: row.housekeeping_status,
    occupied: row.occupied,
  };
}

export function registerHousekeepingRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/housekeeping/beds", async (request, reply) => {
    const parsed = bedsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const result = await pool.query<BedRow>(
      `${BED_SELECT} where p.code = $1 order by r.name, b.label`,
      [parsed.data.propertyCode],
    );

    const body: HousekeepingBedsResponse = { beds: result.rows.map(toResponse) };
    return reply.status(200).send(body);
  });

  app.patch("/api/housekeeping/beds/:bedId", async (request, reply) => {
    const { bedId } = request.params as { bedId: string };
    const idParsed = z.string().uuid().safeParse(bedId);
    if (!idParsed.success) {
      return reply.status(404).send({ error: "not_found" });
    }

    const parsed = patchHousekeepingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const updated = await pool.query(
      "update beds set housekeeping_status = $2 where id = $1",
      [bedId, parsed.data.housekeepingStatus],
    );
    if (updated.rowCount === 0) {
      return reply.status(404).send({ error: "not_found" });
    }

    const row = await pool.query<BedRow>(`${BED_SELECT} where b.id = $1`, [bedId]);
    return reply.status(200).send(toResponse(row.rows[0]));
  });
}
