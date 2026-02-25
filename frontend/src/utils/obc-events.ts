export const getToggleChecked = (event: Event, fallback: boolean): boolean => {
  const custom = event as CustomEvent<{
    checked?: boolean;
    value?: boolean | string | number;
  }>;
  const detail = custom.detail;
  if (typeof detail?.checked === "boolean") {
    return detail.checked;
  }
  if (typeof detail?.value === "boolean") {
    return detail.value;
  }
  if (typeof detail?.value === "string") {
    const normalized = detail.value.trim().toLowerCase();
    if (normalized === "true" || normalized === "on" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "off" || normalized === "0") {
      return false;
    }
  }
  const currentTarget = event.currentTarget as { checked?: boolean } | null;
  if (currentTarget && typeof currentTarget.checked === "boolean") {
    return currentTarget.checked;
  }
  const target = event.target as { checked?: boolean } | null;
  if (target && typeof target.checked === "boolean") {
    return target.checked;
  }
  return fallback;
};
