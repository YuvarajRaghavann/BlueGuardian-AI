import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { BackendSessionProvider } from './context/BackendSessionContext'
import { DeviceProvider } from './context/DeviceContext'
import { ThreatProvider } from './context/ThreatContext'
import { SecurityProvider } from './context/SecurityContext'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <BackendSessionProvider>
        <DeviceProvider>
          <ThreatProvider>
            <SecurityProvider>
              <App />
            </SecurityProvider>
          </ThreatProvider>
        </DeviceProvider>
      </BackendSessionProvider>
    </BrowserRouter>
  </StrictMode>,
)