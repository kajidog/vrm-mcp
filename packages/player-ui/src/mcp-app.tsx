import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { VRMPlayer } from './VRMPlayer'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VRMPlayer />
  </StrictMode>
)
