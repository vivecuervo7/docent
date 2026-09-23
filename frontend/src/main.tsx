import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/monaspace-neon/400.css'
import './index.css'
import { BrowserRouter } from 'react-router'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
