/**
 * Copies text, falling back to a hidden textarea + execCommand where the async Clipboard API is
 * missing or refused (non-HTTPS origins, some in-app browsers). Resolves whether it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    // Deprecated, but still the only option where the Clipboard API is unavailable.
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
