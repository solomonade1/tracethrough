import { setTheme, useTheme, type ThemePreference } from '../lib/theme';
import { Icon, type IconName } from './Icons';
import { MenuButton } from './Menu';

const OPTIONS: { id: ThemePreference; label: string; icon: IconName }[] = [
  { id: 'system', label: 'System', icon: 'monitor' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
];

/** Light, Dark or follow the OS. The choice is remembered on this machine. */
export function ThemeMenu() {
  const theme = useTheme();
  const active = OPTIONS.find((o) => o.id === theme)!;
  return (
    <MenuButton
      className="btn theme-btn"
      ariaLabel={`Theme: ${active.label}`}
      title={`Theme: ${active.label}`}
      entries={OPTIONS.map((o) => ({ label: o.label, hint: o.id === theme ? '✓' : undefined, onSelect: () => setTheme(o.id) }))}
    >
      <Icon name={active.icon} />
    </MenuButton>
  );
}
