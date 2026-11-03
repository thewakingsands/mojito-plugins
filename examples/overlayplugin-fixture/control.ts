import { connectView } from '@ffcafe/mojito-plugin-sdk/view'

const view = await connectView()
Object.assign(window, {
  fixture: (scenario: string, encounterId = 'matrix', active = true) =>
    view.command('fixture', { scenario, encounterId, active }),
})
document.body.dataset.ready = 'true'
