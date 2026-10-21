import { Switch } from '@/components/ui/switch'
import { SIDEBAR_OPTIONS, setSidebarPreference, useSidebarPreferences, type SidebarPreference } from '@/lib/sidebar-preferences'
import { toast } from 'sonner'

export function SidebarSettings() {
  const preferences = useSidebarPreferences()
  return <div className="space-y-4">
    <div>
      <h4 className="text-sm font-medium">Sidebar shortcuts</h4>
      <p className="text-xs text-muted-foreground mt-1">Choose what appears in the expanded and compact sidebar. Hiding a shortcut does not disable the feature or its background activity. Account connections remain available in Settings.</p>
    </div>
    {(Object.keys(SIDEBAR_OPTIONS) as SidebarPreference[]).map(key => <label key={key} className="flex items-center justify-between gap-4 text-sm">
      {SIDEBAR_OPTIONS[key]}
      <Switch checked={preferences[key]} onCheckedChange={value => {
        try { setSidebarPreference(key, value) } catch { toast.error('Could not save sidebar preferences') }
      }} />
    </label>)}
  </div>
}
