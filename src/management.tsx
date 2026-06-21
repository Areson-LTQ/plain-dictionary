import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './ErrorBoundary'
import { ManagementWindow } from './ManagementWindow'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><ManagementWindow /></ErrorBoundary>
  </StrictMode>,
)
