import type { Value } from '@ffcafe/mojito-plugin-sdk'
import { connectView } from '@ffcafe/mojito-plugin-sdk/view'
import { createRoot } from 'react-dom/client'
import { Bridge } from '../page/bridge.js'
import type { Command } from '../view-model.js'
import { SettingsPage } from './SettingsPage.js'
import '../style.css'

const root = createRoot(document.getElementById('root')!)
try {
  const view = await connectView()
  const command = (input: Command) => view.command('statistics', input as unknown as Value)
  root.render(
    <Bridge.Provider value={{ view, command }}>
      <SettingsPage />
    </Bridge.Provider>,
  )
} catch (error) {
  root.render(<p className="status">{String(error)}</p>)
}
