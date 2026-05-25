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
    const removeSettingsListener = window.ghostAPI.onOpenSettings(() => {
      setView('settings')
    })

    return () => {
      removeSettingsListener()
    }
  }, [])

  return (
    <div className="w-full h-full p-1">
      {view === 'overlay' && (
        <Overlay
          {...ghostAI}
          onOpenSettings={() => setView('settings')}
          onOpenHelp={() => setView('help')}
        />
      )}
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
