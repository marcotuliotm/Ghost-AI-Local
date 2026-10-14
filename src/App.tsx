import { useState, useEffect, useCallback } from 'react'
import { Overlay } from './components/Overlay'
import { SettingsPanel } from './components/Settings'
import { HelpPanel } from './components/HelpPanel'
import { CompactView } from './components/CompactView'
import { Onboarding } from './components/Onboarding'
import { DocumentsPanel } from './components/DocumentsPanel'
import { useGhostAI } from './hooks/useGhostAI'
import { formatAccelerator, isMacPlatform } from './lib/shortcuts'

type View = 'overlay' | 'settings' | 'help' | 'compact' | 'onboarding' | 'documents'

export default function App() {
  const [view, setView] = useState<View>('overlay')
  const ghostAI = useGhostAI()
  const { settingsLoaded, settings, updateSettings } = ghostAI

  useEffect(() => {
    document.documentElement.style.setProperty('--ghost-font-size', `${settings.fontSize}px`)
  }, [settings.fontSize])

  // Apply the saved opacity at startup and whenever it changes. Without this the
  // default (0.9) only took effect after the user touched the Settings slider.
  useEffect(() => {
    window.ghostAPI.setOpacity(settings.opacity)
  }, [settings.opacity])

  // Hide the overlay from screen sharing (Settings > Privacy, on by default)
  useEffect(() => {
    window.ghostAPI.setContentProtection(settings.hideFromScreenShare)
  }, [settings.hideFromScreenShare])

  // First run: guided setup once the stored settings say it hasn't been done
  useEffect(() => {
    if (settingsLoaded && !settings.onboardingCompleted) setView('onboarding')
  }, [settingsLoaded, settings.onboardingCompleted])

  // The window shrinks to the compact card while that view is shown
  const isCompact = view === 'compact'
  useEffect(() => {
    window.ghostAPI.setCompactMode(isCompact)
  }, [isCompact])

  const toggleCompact = useCallback(() => {
    setView(v => (v === 'compact' ? 'overlay' : 'compact'))
  }, [])

  useEffect(() => {
    const removeSettingsListener = window.ghostAPI.onOpenSettings(() => setView('settings'))
    const removeCompactListener = window.ghostAPI.onToggleCompact(toggleCompact)
    return () => {
      removeSettingsListener()
      removeCompactListener()
    }
  }, [toggleCompact])

  const finishOnboarding = useCallback(() => {
    updateSettings({ onboardingCompleted: true })
    setView('overlay')
  }, [updateSettings])

  return (
    <div className="w-full h-full">
      {/* Always mounted (hidden in other views) so recording, Auto and
          Questions keep running in compact mode and Settings */}
      <div className={view === 'overlay' ? 'w-full h-full' : 'hidden'}>
        <Overlay
          {...ghostAI}
          onOpenSettings={() => setView('settings')}
          onOpenHelp={() => setView('help')}
          onCompact={toggleCompact}
          onOpenDocuments={() => setView('documents')}
        />
      </div>
      {view === 'compact' && (
        <CompactView
          messages={ghostAI.messages}
          isStreaming={ghostAI.isStreaming}
          onExpand={toggleCompact}
          shortcutLabel={formatAccelerator(settings.shortcuts.compactMode, isMacPlatform())}
        />
      )}
      {view === 'onboarding' && (
        <Onboarding
          isConnected={ghostAI.isConnected}
          connectionError={ghostAI.connectionError}
          models={ghostAI.models}
          settings={settings}
          updateSettings={updateSettings}
          checkConnection={ghostAI.checkConnection}
          onDone={finishOnboarding}
        />
      )}
      {view === 'documents' && (
        <DocumentsPanel
          settings={settings}
          embeddingModels={ghostAI.embeddingModels}
          isConnected={ghostAI.isConnected}
          updateSettings={updateSettings}
          onBack={() => setView('overlay')}
        />
      )}
      {view === 'settings' && (
        <SettingsPanel
          settings={settings}
          models={ghostAI.models}
          isConnected={ghostAI.isConnected}
          onUpdateSettings={updateSettings}
          onBack={() => setView('overlay')}
          onRefreshModels={ghostAI.fetchModels}
          onCheckConnection={ghostAI.checkConnection}
          shortcutErrors={ghostAI.shortcutErrors}
        />
      )}
      {view === 'help' && (
        <HelpPanel
          onBack={() => setView('overlay')}
          shortcuts={settings.shortcuts}
          onRunSetup={() => setView('onboarding')}
        />
      )}
    </div>
  )
}
