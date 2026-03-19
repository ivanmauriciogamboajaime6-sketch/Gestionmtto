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
