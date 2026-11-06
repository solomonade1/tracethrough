import { useInspector } from '../store';

/** Copies text and confirms with a toast. Only ever called from a click or key handler. */
export async function copyText(text: string, label: string): Promise<void> {
  const { showToast } = useInspector.getState();
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copied ${label}`);
  } catch {
    showToast("Couldn't copy: clipboard unavailable");
  }
}
