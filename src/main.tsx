import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './ErrorBoundary'
import { MainWindow } from './MainWindow'
import { ManagementWindow } from './ManagementWindow'
import './styles.css'

const isManagement = new URLSearchParams(window.location.search).get('window') === 'management'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{isManagement ? <ManagementWindow /> : <MainWindow />}</ErrorBoundary>
  </StrictMode>,
)
