export const REQUEST_STATUS = {
  CREATED: "creada",
  IN_REVIEW: "en_revision",
  IN_DIAGNOSIS: "en_diagnostico",
  IN_WORKSHOP_ASSIGNMENT: "en_asignacion_taller",
  DIAGNOSED: "diagnosticada",
  PENDING_CLIENT_WORKSHOP_INFO: "pendiente_envio_cliente_taller",
  IN_QUOTATION: "en_cotizacion",
  QUOTED: "cotizada",
  PROPOSAL_READY: "propuesta_armada",
  SENT_TO_CLIENT: "enviada_cliente",
  APPROVED: "aprobada",
  IN_PROCESS: "en_proceso",
  FINISHED: "finalizada",
  REJECTED_ADMIN: "rechazada_admin",
  REJECTED_WORKSHOP: "rechazada_taller",
  REJECTED_PROVIDER: "rechazada_proveedor",
  REJECTED_CLIENT: "rechazada_cliente",
  CANCELLED: "cancelada",
} as const;

export function normalizeStatus(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

export function normalizeServiceText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isQuoteWorkflowService(tipoServicio?: string | null) {
  const service = normalizeServiceText(tipoServicio);

  return (
    service.includes("bateria") ||
    service.includes("aceite") ||
    service.includes("filtro") ||
    service.includes("freno") ||
    service.includes("llanta")
  );
}

export function isCreatedStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.CREATED || normalized === "pendiente";
}

export function isInReviewStatus(status?: string | null) {
  return normalizeStatus(status) === REQUEST_STATUS.IN_REVIEW;
}

export function isInQuotationStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.IN_QUOTATION || normalized === "cotizando";
}

export function isInDiagnosisStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return (
    normalized === REQUEST_STATUS.IN_DIAGNOSIS ||
    normalized === REQUEST_STATUS.IN_WORKSHOP_ASSIGNMENT ||
    normalized === "diagnostico" ||
    normalized === "recibida"
  );
}

export function isDiagnosedStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return (
    normalized === REQUEST_STATUS.DIAGNOSED ||
    normalized === REQUEST_STATUS.PENDING_CLIENT_WORKSHOP_INFO ||
    normalized === "pendiente_aprobacion_admin"
  );
}

export function isQuotedStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.QUOTED || normalized === "cotizado";
}

export function isProposalReadyStatus(status?: string | null) {
  return normalizeStatus(status) === REQUEST_STATUS.PROPOSAL_READY;
}

export function isSentToClientStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.SENT_TO_CLIENT || normalized === "enviado_cliente";
}

export function isApprovedStatus(status?: string | null) {
  return normalizeStatus(status) === REQUEST_STATUS.APPROVED;
}

export function isInProcessStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.IN_PROCESS || normalized === "en_reparacion";
}

export function isFinishedStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.FINISHED || normalized === "finalizado";
}

export function isRejectedAdminStatus(status?: string | null) {
  return normalizeStatus(status) === REQUEST_STATUS.REJECTED_ADMIN;
}

export function isRejectedWorkshopStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.REJECTED_WORKSHOP || normalized === "rechazada";
}

export function isRejectedProviderStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.REJECTED_PROVIDER || normalized === "devuelto_proveedor";
}

export function isRejectedClientStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.REJECTED_CLIENT || normalized === "devuelta";
}

export function isCancelledStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === REQUEST_STATUS.CANCELLED || normalized === "archivada";
}

export function isHistoryStatus(status?: string | null) {
  const normalized = normalizeStatus(status);
  return (
    isFinishedStatus(normalized) ||
    isRejectedAdminStatus(normalized) ||
    isRejectedWorkshopStatus(normalized) ||
    isRejectedProviderStatus(normalized) ||
    isRejectedClientStatus(normalized) ||
    isCancelledStatus(normalized) ||
    normalized === "omitida_admin"
  );
}

export function isOpenRequestStatus(status?: string | null) {
  return !isHistoryStatus(status);
}

export function getStatusLabel(status?: string | null) {
  const normalized = normalizeStatus(status);

  if (isCreatedStatus(normalized)) return "Creada";
  if (isInReviewStatus(normalized)) return "En revision";
  if (normalized === REQUEST_STATUS.IN_WORKSHOP_ASSIGNMENT) return "En asignacion de taller";
  if (isInDiagnosisStatus(normalized)) return "En diagnostico";
  if (normalized === REQUEST_STATUS.PENDING_CLIENT_WORKSHOP_INFO) return "Pendiente de envio al cliente";
  if (isDiagnosedStatus(normalized)) return "Diagnosticada";
  if (isInQuotationStatus(normalized)) return "En cotizacion";
  if (isQuotedStatus(normalized)) return "Cotizada";
  if (isProposalReadyStatus(normalized)) return "Propuesta armada";
  if (isSentToClientStatus(normalized)) return "Enviada al cliente";
  if (isApprovedStatus(normalized)) return "Aprobada";
  if (isInProcessStatus(normalized)) return "En proceso";
  if (isFinishedStatus(normalized)) return "Finalizada";
  if (isRejectedAdminStatus(normalized)) return "Rechazada por admin";
  if (isRejectedWorkshopStatus(normalized)) return "Rechazada por taller";
  if (isRejectedProviderStatus(normalized)) return "Rechazada por proveedor";
  if (isRejectedClientStatus(normalized)) return "Rechazada por cliente";
  if (isCancelledStatus(normalized)) return "Cancelada";
  if (normalized === "omitida_admin") return "Omitida";

  return status || "Sin estado";
}
