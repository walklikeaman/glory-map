import { z } from "zod";

export const tourRequestSchema = z
  .object({
    city: z.string().trim().min(1).max(120),
    film: z
      .object({
        id: z.string().min(1).max(160),
        title: z.string().trim().min(1).max(240),
        year: z.number().int().nullable().optional(),
        kind: z.enum(["film", "series", "book"]).optional(),
      })
      .optional(),
    durationMinutes: z.union([z.literal(30), z.literal(60), z.literal(120)]).optional(),
    preserveOrder: z.boolean().optional().default(false),
    language: z.string().trim().max(16).optional(),
    locations: z
      .array(
        z.object({
          id: z.string().min(1).max(320),
          place: z.string().trim().min(1).max(240),
          scene: z.string().trim().min(1).max(320),
          description: z.string().trim().min(1).max(1000),
          film: z.string().trim().min(1).max(240).optional(),
        }),
      )
      .min(1)
      .max(5),
  })
  .superRefine(({ locations }, context) => {
    if (new Set(locations.map((location) => location.id)).size !== locations.length) {
      context.addIssue({
        code: "custom",
        message: "Location ids must be unique",
        path: ["locations"],
      });
    }
  });

export function createTourSchema(locationIds) {
  if (locationIds.length === 0) {
    throw new Error("A tour needs at least one known location");
  }

  const locationId = z.enum(locationIds);

  return z.object({
    title: z.string().min(1).max(90),
    intro: z.string().min(1).max(320),
    stops: z
      .array(
        z.object({
          locationId,
          narration: z.string().min(1).max(260),
        }),
      )
      .length(locationIds.length),
  });
}

export function assertCompleteTour(tour, locationIds, preserveOrder = false) {
  const returnedIds = tour.stops.map((stop) => stop.locationId);
  const uniqueIds = new Set(returnedIds);

  if (
    uniqueIds.size !== locationIds.length ||
    locationIds.some((locationId) => !uniqueIds.has(locationId))
  ) {
    throw new Error("The model returned an incomplete or duplicated route");
  }

  if (
    preserveOrder &&
    returnedIds.some((locationId, index) => locationId !== locationIds[index])
  ) {
    throw new Error("The model changed the verified route order");
  }

  return tour;
}
