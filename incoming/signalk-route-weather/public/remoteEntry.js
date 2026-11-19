// Signal K loads a federation container and passes its React share scope to init.
(() => {
  'use strict'

  let shareScope
  const senderRelease = 'https://github.com/SignalKuser/LTC_Ocpn_Route_Importer/releases/tag/v.1.1.44'

  window.signalk_route_weather = {
    init(scope) { shareScope = scope },
    async get(moduleName) {
      if (moduleName !== './PluginConfigurationPanel') {
        throw new Error(`Unknown Signal K component: ${moduleName}`)
      }

      const hostReact = globalThis.__SK_REACT__
      let React = hostReact?.default ?? hostReact
      if (!React?.createElement) {
        const entries = Object.values(shareScope?.react ?? {})
        const sharedReact = entries.find((entry) => entry.loaded) ?? entries[0]
        if (!sharedReact) throw new Error('Signal K did not provide React to the configuration panel')
        const module = (await sharedReact.get())()
        React = module.default ?? module
      }
      const { createElement: h, useEffect, useState } = React

      function PluginConfigurationPanel({ configuration, save }) {
        const savedEnabled = configuration?.qtVlmEnabled === true
        const [enabled, setEnabled] = useState(savedEnabled)
        useEffect(() => setEnabled(savedEnabled), [savedEnabled])

        return h('form', {
          onSubmit(event) {
            event.preventDefault()
            save({ ...configuration, qtVlmEnabled: enabled })
          }
        },
        h('p', null,
          'Direct route import from OpenCPN requires the external Signal K Route Sender. ',
          h('a', { href: senderRelease, target: '_blank', rel: 'noopener noreferrer' }, 'Download on GitHub')),
        h('p', null, h('label', null,
          h('input', { type: 'checkbox', checked: enabled, onChange: (event) => setEnabled(event.target.checked) }),
          ' Enable qtVlm receiver (port 5555)')),
        h('button', { type: 'submit', className: 'btn btn-primary' }, 'Save Configuration'))
      }

      return () => ({ default: PluginConfigurationPanel })
    }
  }
})()
