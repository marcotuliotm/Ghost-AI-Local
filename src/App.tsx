import { useState, useEffect } from 'react'
import { Overlay } from './components/Overlay'
import { SettingsPanel } from './components/Settings'
import { HelpPanel } from './components/HelpPanel'
import { useGhostAI } from './hooks/useGhostAI'

type View = 'overlay' | 'settings' | 'help'

export default function App() {
  const [view, setView] = useState<View>('overlay')
  const ghostAI = useGhostAI()

  useEffect(() => {
    document.documentElement.style.setProperty('--ghost-font-size', `${ghostAI.settings.fontSize}px`)
  }, [ghostAI.settings.fontSize])

  // Apply the saved opacity at startup and whenever it changes. Without this the
  // default (0.9) only took effect after the user touched the Settings slider.
  useEffect(() => {
    window.ghostAPI.setOpacity(ghostAI.settings.opacity)
  }, [ghostAI.settings.opacity])

  useEffect(() => {
    const removeSettingsListener = window.ghostAPI.onOpenSettings(() => {
      setView('settings')
    })

    return () => {
      removeSettingsListener()
    }
  }, [])

  return (
    <div className="w-full h-full">
      <div className={view === 'overlay' ? 'w-full h-full' : 'hidden'}>
        <Overlay
          {...ghostAI}
          onOpenSettings={() => setView('settings')}
          onOpenHelp={() => setView('help')}
        />
      </div>
      {view === 'settings' && (
        <SettingsPanel
          settings={ghostAI.settings}
          models={ghostAI.models}
          isConnected={ghostAI.isConnected}
          onUpdateSettings={ghostAI.updateSettings}
          onBack={() => setView('overlay')}
          onRefreshModels={ghostAI.fetchModels}
          onCheckConnection={ghostAI.checkConnection}
        />
      )}
      {view === 'help' && (
        <HelpPanel onBack={() => setView('overlay')} />
      )}
    </div>
  )
}
