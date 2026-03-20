export function onlyDigits(value: string | number | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatNumberWithDots(value: string | number | null | undefined) {
  const digits = onlyDigits(value);

  if (!digits) {
    return "";
  }

  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function parseFormattedNumber(value: string | number | null | undefined) {
  const digits = onlyDigits(value);
  return digits ? Number(digits) : 0;
}

export function formatCurrency(value: string | number | null | undefined) {
  const formatted = formatNumberWithDots(value);
  return formatted ? `$${formatted}` : "$0";
}

export function formatKilometraje(value: string | number | null | undefined) {
  const formatted = formatNumberWithDots(value);
  return formatted ? `${formatted} km` : "--";
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
