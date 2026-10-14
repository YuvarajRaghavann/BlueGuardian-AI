import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { DeviceProvider } from './context/DeviceContext'
import { ThreatProvider } from './context/ThreatContext'
import { SecurityProvider } from './context/SecurityContext'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DeviceProvider>
        <ThreatProvider>
          <SecurityProvider>
            <App />
          </SecurityProvider>
        </ThreatProvider>
      </DeviceProvider>
    </BrowserRouter>
  </StrictMode>,
)