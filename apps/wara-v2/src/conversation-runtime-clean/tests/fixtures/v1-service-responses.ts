export const V1_SERVICE_RESPONSE_FIXTURES = Object.freeze({
  odooCreated: { ok: true, statusCode: 201, data: { ticketId: "odoo-4812", reference: "4812", status: "open" }, ticketId: "odoo-4812", reference: "4812" },
  accepted: { statusCode: 202, status: "pending", data: { ticketId: "local-7", status: "in_progress" }, ticketId: "local-7" },
  missing: { statusCode: 404, code: "ticket_not_found" },
  rejected: { statusCode: 422, status: "rejected", code: "stage_rejected" },
  conflict: { statusCode: 409, code: "already_assigned" },
  unauthorized: { statusCode: 403, code: "forbidden" },
  invalid: { statusCode: 400, errors: ["subject_required"] },
  unavailable: { statusCode: 503, code: "backend_unavailable" },
  timeout: { statusCode: 504, code: "upstream_timeout" },
  unknown: { ok: "yes", payload: { arbitrary: true } },
});
